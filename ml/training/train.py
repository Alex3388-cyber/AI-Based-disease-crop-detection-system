"""Train a practical MobileNetV2 baseline from a verified split manifest."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from common import PIPELINE_VERSION
from common.artifact_bundle import ARTIFACT_FILES, ARTIFACT_MANIFEST
from common.io_utils import canonical_json_sha256, sha256_file, write_json_atomic
from common.keras_data import make_sequence
from common.manifest import (
    class_weights,
    load_split_manifest,
    snapshot_manifest_splits,
    verify_manifest_files,
)


MODEL_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--image-width", type=int, default=224)
    parser.add_argument("--image-height", type=int, default=224)
    parser.add_argument("--interpolation", choices=["area", "bilinear", "bicubic", "nearest", "lanczos4"], default="area")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--freeze-epochs", type=int, default=5)
    parser.add_argument("--fine-tune-layers", type=int, default=30)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--fine-tune-lr-factor", type=float, default=0.1)
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--weights", choices=["imagenet", "none"], default="imagenet")
    parser.add_argument("--confidence-threshold", type=float, default=0.70)
    parser.add_argument("--no-class-weights", action="store_true")
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if MODEL_VERSION.fullmatch(args.model_version) is None:
        raise SystemExit(
            "Model version must be a 1-100 character ASCII release identifier"
        )
    if not 32 <= args.image_width <= 4096 or not 32 <= args.image_height <= 4096:
        raise SystemExit("Image dimensions must be between 32 and 4096")
    if args.image_width * args.image_height > 1_048_576:
        raise SystemExit("Model input dimensions may contain at most 1,048,576 pixels")
    if min(args.batch_size, args.epochs, args.patience) <= 0:
        raise SystemExit("Batch size, epochs, and patience must be positive")
    if not 0 <= args.freeze_epochs <= args.epochs:
        raise SystemExit("Freeze epochs must be between zero and total epochs")
    if args.fine_tune_layers <= 0:
        raise SystemExit("Fine-tune layers must be positive")
    if args.learning_rate <= 0 or not 0 < args.fine_tune_lr_factor <= 1:
        raise SystemExit("Learning rates must be positive and the factor at most one")
    if not 0 <= args.dropout < 1 or not 0 <= args.confidence_threshold <= 1:
        raise SystemExit("Dropout and confidence threshold must be in their valid ranges")


def merge_history(target: dict[str, list[float]], history: Any) -> None:
    for metric, values in history.history.items():
        target.setdefault(metric, []).extend(float(value) for value in values)


def callbacks(tensorflow: Any, checkpoint: Path, patience: int) -> list[Any]:
    return [
        tensorflow.keras.callbacks.ModelCheckpoint(
            checkpoint,
            monitor="val_loss",
            save_best_only=True,
            verbose=1,
        ),
        tensorflow.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=patience,
            restore_best_weights=True,
            verbose=1,
        ),
        tensorflow.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.2,
            patience=max(1, patience // 2),
            min_lr=1e-7,
            verbose=1,
        ),
    ]


def build_model(
    tensorflow: Any, args: argparse.Namespace, class_count: int
) -> tuple[Any, Any]:
    inputs = tensorflow.keras.Input(
        shape=(args.image_height, args.image_width, 3), name="rgb_image"
    )
    augmentation = tensorflow.keras.Sequential(
        [
            tensorflow.keras.layers.RandomFlip("horizontal"),
            tensorflow.keras.layers.RandomRotation(0.08, fill_mode="reflect"),
            tensorflow.keras.layers.RandomZoom(0.10, fill_mode="reflect"),
        ],
        name="training_augmentation",
    )
    base = tensorflow.keras.applications.MobileNetV2(
        include_top=False,
        weights=None if args.weights == "none" else "imagenet",
        input_shape=(args.image_height, args.image_width, 3),
    )
    base.trainable = False
    features = augmentation(inputs)
    features = base(features, training=False)
    features = tensorflow.keras.layers.GlobalAveragePooling2D()(features)
    features = tensorflow.keras.layers.Dropout(args.dropout)(features)
    outputs = tensorflow.keras.layers.Dense(
        class_count, activation="softmax", dtype="float32", name="class_probabilities"
    )(features)
    return tensorflow.keras.Model(inputs, outputs, name="crop_disease_mobilenet_v2"), base


def compile_model(tensorflow: Any, model: Any, learning_rate: float) -> None:
    model.compile(
        optimizer=tensorflow.keras.optimizers.Adam(learning_rate=learning_rate),
        loss=tensorflow.keras.losses.SparseCategoricalCrossentropy(),
        metrics=[tensorflow.keras.metrics.SparseCategoricalAccuracy(name="accuracy")],
    )


def main() -> None:
    args = parse_args()
    validate_args(args)
    # Heavy dependencies are intentionally imported only by an actual training run.
    try:
        import tensorflow as tf
    except ImportError as exc:
        raise SystemExit("TensorFlow is required; install ml/requirements.txt") from exc

    tf.keras.utils.set_random_seed(args.seed)
    try:
        tf.config.experimental.enable_op_determinism()
    except (AttributeError, RuntimeError):
        pass

    manifest = load_split_manifest(args.manifest)
    dataset_root = args.dataset.resolve(strict=True)
    verify_manifest_files(
        manifest, dataset_root, verify_hashes=True
    )
    classes: list[str] = manifest["classNames"]
    train_entries = manifest["splits"]["train"]
    validation_entries = manifest["splits"]["validation"]
    if not train_entries or not validation_entries:
        raise SystemExit("Training and validation splits must both be non-empty")
    dataset_version = manifest.get("dataset", {}).get("version")
    if not isinstance(dataset_version, str) or not dataset_version.strip():
        raise SystemExit("The inspected dataset must include a dataset version")

    preprocessing = {
        "pipelineVersion": PIPELINE_VERSION,
        "imageWidth": args.image_width,
        "imageHeight": args.image_height,
        "channels": 3,
        "colorSpace": "RGB",
        "resizeInterpolation": args.interpolation,
        "dtype": "float32",
        # MobileNetV2's expected numeric range, expressed without a hidden layer.
        "normalization": {
            "type": "rescale",
            "scale": 1.0 / 127.5,
            "offset": -1.0,
        },
    }
    snapshot_workspace = tempfile.TemporaryDirectory(prefix=".crop-training-data-")
    try:
        dataset_snapshot = Path(snapshot_workspace.name) / "dataset"
        snapshot_manifest_splits(
            manifest,
            dataset_root,
            dataset_snapshot,
            splits=("train", "validation"),
        )
        train_sequence = make_sequence(
            tf,
            entries=train_entries,
            classes=classes,
            dataset_root=dataset_snapshot,
            metadata=preprocessing,
            batch_size=args.batch_size,
            shuffle=True,
            seed=args.seed,
        )
        validation_sequence = make_sequence(
            tf,
            entries=validation_entries,
            classes=classes,
            dataset_root=dataset_snapshot,
            metadata=preprocessing,
            batch_size=args.batch_size,
            shuffle=False,
            seed=args.seed,
        )

        artifact_dir = args.artifacts.resolve()
        artifact_dir.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=".training-", dir=artifact_dir))
    except BaseException:
        snapshot_workspace.cleanup()
        raise
    try:
        checkpoint = staging / "best_model.keras"
        history_values: dict[str, list[float]] = {}
        completed_epochs = 0
        weights = (
            None
            if args.no_class_weights
            else class_weights(train_entries, classes)
        )
        model, base = build_model(tf, args, len(classes))
        # Reuse the same ModelCheckpoint instance so its global best val_loss is
        # preserved across the frozen-head and fine-tuning fit phases.
        training_callbacks = callbacks(tf, checkpoint, args.patience)
        if args.freeze_epochs:
            compile_model(tf, model, args.learning_rate)
            phase = model.fit(
                train_sequence,
                validation_data=validation_sequence,
                epochs=args.freeze_epochs,
                callbacks=training_callbacks,
                class_weight=weights,
            )
            merge_history(history_values, phase)
            completed_epochs += len(phase.epoch)

        if completed_epochs < args.epochs:
            base.trainable = True
            for layer in base.layers[:-args.fine_tune_layers]:
                layer.trainable = False
            for layer in base.layers:
                if isinstance(layer, tf.keras.layers.BatchNormalization):
                    layer.trainable = False
            compile_model(tf, model, args.learning_rate * args.fine_tune_lr_factor)
            phase = model.fit(
                train_sequence,
                validation_data=validation_sequence,
                initial_epoch=completed_epochs,
                epochs=args.epochs,
                callbacks=training_callbacks,
                class_weight=weights,
            )
            merge_history(history_values, phase)
            completed_epochs += len(phase.epoch)

        if not checkpoint.is_file():
            raise RuntimeError("Training finished without a model checkpoint")
        # Deserializing the just-written file catches incomplete exports immediately.
        tf.keras.models.load_model(checkpoint, compile=False, safe_mode=True)
        created_at = datetime.now(UTC).isoformat()
        metadata = {
            "schemaVersion": 1,
            "modelVersion": args.model_version,
            "createdAt": created_at,
            "datasetVersion": dataset_version,
            **preprocessing,
            "output": {"type": "probabilities"},
            "confidenceThreshold": args.confidence_threshold,
            "classes": classes,
            "dataset": manifest.get("dataset", {}),
            "splitManifestSha256": canonical_json_sha256(manifest),
            "training": {
                "architecture": "MobileNetV2 transfer learning",
                "initialWeights": args.weights,
                "seed": args.seed,
                "batchSize": args.batch_size,
                "epochsRequested": args.epochs,
                "epochsCompleted": completed_epochs,
                "learningRate": args.learning_rate,
                "fineTuneLearningRate": args.learning_rate
                * args.fine_tune_lr_factor,
                "classWeightsUsed": not args.no_class_weights,
            },
        }
        best_epoch = None
        if history_values.get("val_loss"):
            best_epoch = int(np.argmin(history_values["val_loss"])) + 1
        history_document = {
            "schemaVersion": 1,
            "status": "complete",
            "modelVersion": args.model_version,
            "epochsCompleted": completed_epochs,
            "bestEpochByValidationLoss": best_epoch,
            "history": history_values,
        }
        write_json_atomic(staging / "class_names.json", classes)
        write_json_atomic(staging / "training_history.json", history_document)
        write_json_atomic(staging / "model_metadata.json", metadata)
        artifact_manifest = {
            "schemaVersion": 1,
            "modelVersion": args.model_version,
            "files": {
                name: sha256_file(staging / name) for name in ARTIFACT_FILES
            },
        }
        write_json_atomic(staging / ARTIFACT_MANIFEST, artifact_manifest)
        # The manifest is the commit marker. A crash during the file replacements
        # leaves the previous manifest in place, so export rejects the mixed set.
        for name in (*ARTIFACT_FILES, ARTIFACT_MANIFEST):
            os.replace(staging / name, artifact_dir / name)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
        snapshot_workspace.cleanup()

    print(
        f"Training complete after {completed_epochs} actual epochs. "
        f"Validated artifacts: {artifact_dir}"
    )


if __name__ == "__main__":
    main()
