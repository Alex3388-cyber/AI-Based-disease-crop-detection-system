"""Evaluate one immutable real model/test snapshot and commit measured evidence."""

from __future__ import annotations

import argparse
import csv
import math
import os
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from common.artifact_bundle import (
    ARTIFACT_MANIFEST,
    MAX_JSON_BYTES,
    snapshot_artifacts,
    validate_model_documents,
)
from common.io_utils import (
    canonical_json_sha256,
    read_json,
    sha256_file,
    write_json_atomic,
)
from common.keras_data import make_sequence
from common.manifest import load_split_manifest, resolve_entry


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=32)
    return parser.parse_args()


def checked_probabilities(raw: Any, expected_rows: int, class_count: int) -> np.ndarray:
    values = np.asarray(raw, dtype=np.float64)
    if values.shape != (expected_rows, class_count) or not np.isfinite(values).all():
        raise ValueError("Model produced an invalid output shape or non-finite values")
    if np.any(values < -1e-6) or np.any(values > 1 + 1e-6):
        raise ValueError("Exported probability model produced out-of-range values")
    totals = values.sum(axis=1)
    if not np.allclose(totals, 1.0, atol=1e-3):
        raise ValueError("Exported probability rows do not sum to one")
    values = np.clip(values, 0.0, 1.0)
    totals = values.sum(axis=1, keepdims=True)
    if np.any(totals <= 0) or not np.isfinite(totals).all():
        raise ValueError("Exported probability rows are invalid")
    return values / totals


def snapshot_test_dataset(
    manifest: dict[str, Any], source_root: Path, snapshot_root: Path
) -> list[dict[str, str]]:
    entries = manifest["splits"]["test"]
    if not entries:
        raise ValueError("The test split is empty; evaluation remains pending")
    snapshot_root.mkdir(parents=True, exist_ok=True)
    root = snapshot_root.resolve()
    for entry in entries:
        source = resolve_entry(source_root, entry["path"])
        expected_hash = entry["sha256"]
        if sha256_file(source) != expected_hash:
            raise ValueError(f"Dataset file changed before evaluation: {entry['path']}")
        target = (root / Path(entry["path"])).resolve()
        if root not in target.parents:
            raise ValueError("Unsafe test-snapshot path")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        if sha256_file(target) != expected_hash:
            raise ValueError(f"Dataset file changed during snapshot: {entry['path']}")
    return entries


def plot_confusion(matrix: np.ndarray, classes: list[str], output: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    size = max(7, min(18, len(classes) * 0.65))
    figure, axis = plt.subplots(figsize=(size, size))
    image = axis.imshow(matrix, interpolation="nearest", cmap="Greens")
    figure.colorbar(image, ax=axis)
    axis.set(
        xticks=np.arange(len(classes)),
        yticks=np.arange(len(classes)),
        xticklabels=classes,
        yticklabels=classes,
        ylabel="True label",
        xlabel="Predicted label",
        title="Test confusion matrix (counts)",
    )
    plt.setp(axis.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")
    threshold = matrix.max() / 2 if matrix.size else 0
    for row in range(matrix.shape[0]):
        for column in range(matrix.shape[1]):
            axis.text(
                column,
                row,
                str(int(matrix[row, column])),
                ha="center",
                va="center",
                color="white" if matrix[row, column] > threshold else "black",
            )
    figure.tight_layout()
    figure.savefig(output, dpi=180)
    plt.close(figure)


def plot_history(history_document: dict[str, Any], output: Path) -> bool:
    history = history_document["history"]
    required = ("accuracy", "val_accuracy", "loss", "val_loss")
    if not all(isinstance(history.get(key), list) and history[key] for key in required):
        return False
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    epochs = np.arange(1, len(history["loss"]) + 1)
    figure, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    axes[0].plot(epochs, history["accuracy"], label="training")
    axes[0].plot(epochs, history["val_accuracy"], label="validation")
    axes[0].set(title="Accuracy", xlabel="Epoch", ylabel="Accuracy")
    axes[0].legend()
    axes[1].plot(epochs, history["loss"], label="training")
    axes[1].plot(epochs, history["val_loss"], label="validation")
    axes[1].set(title="Loss", xlabel="Epoch", ylabel="Loss")
    axes[1].legend()
    figure.tight_layout()
    figure.savefig(output, dpi=180)
    plt.close(figure)
    return True


def require_finite_metrics(document: dict[str, Any]) -> None:
    for key, value in document.items():
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"Non-finite measured metric: {key}")


def main() -> None:
    args = parse_args()
    if args.batch_size <= 0:
        raise SystemExit("Batch size must be positive")
    try:
        import tensorflow as tf
        from sklearn.metrics import confusion_matrix, precision_recall_fscore_support
    except ImportError as exc:
        raise SystemExit("Install ml/requirements.txt before evaluation") from exc

    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    workspace = Path(tempfile.mkdtemp(prefix=".evaluation-", dir=output.parent))
    try:
        artifact_snapshot = workspace / "artifacts"
        dataset_snapshot = workspace / "dataset"
        report_staging = workspace / "report"
        report_staging.mkdir()
        try:
            artifact_manifest = snapshot_artifacts(
                args.artifacts.resolve(strict=True), artifact_snapshot
            )
            classes, metadata, history = validate_model_documents(
                read_json(
                    artifact_snapshot / "class_names.json",
                    maximum_bytes=MAX_JSON_BYTES,
                ),
                read_json(
                    artifact_snapshot / "model_metadata.json",
                    maximum_bytes=MAX_JSON_BYTES,
                ),
                read_json(
                    artifact_snapshot / "training_history.json",
                    maximum_bytes=MAX_JSON_BYTES,
                ),
            )
            manifest = load_split_manifest(args.manifest.resolve(strict=True))
        except ValueError as exc:
            raise SystemExit(f"Evaluation provenance validation failed: {exc}") from exc

        split_digest = canonical_json_sha256(manifest)
        if split_digest != metadata["splitManifestSha256"]:
            raise SystemExit("Evaluation manifest is not the model's recorded split")
        if manifest["classNames"] != classes:
            raise SystemExit("Manifest class order does not match the trained model")
        dataset_version = manifest.get("dataset", {}).get("version")
        if dataset_version != metadata["datasetVersion"]:
            raise SystemExit("Dataset version does not match the trained model")
        if artifact_manifest["modelVersion"] != metadata["modelVersion"]:
            raise SystemExit("Artifact manifest model version does not match metadata")

        try:
            test_entries = snapshot_test_dataset(
                manifest,
                args.dataset.resolve(strict=True),
                dataset_snapshot,
            )
        except ValueError as exc:
            raise SystemExit(f"Test dataset snapshot failed: {exc}") from exc

        sequence = make_sequence(
            tf,
            entries=test_entries,
            classes=classes,
            dataset_root=dataset_snapshot,
            metadata=metadata,
            batch_size=args.batch_size,
            shuffle=False,
            seed=int(manifest["seed"]),
        )
        model = tf.keras.models.load_model(
            artifact_snapshot / "best_model.keras", compile=True, safe_mode=True
        )
        evaluated = model.evaluate(sequence, verbose=1, return_dict=True)
        probabilities = checked_probabilities(
            model.predict(sequence, verbose=1), len(test_entries), len(classes)
        )
        truth = np.asarray([classes.index(entry["label"]) for entry in test_entries])
        predicted = np.argmax(probabilities, axis=1)
        precision, recall, f1, support = precision_recall_fscore_support(
            truth,
            predicted,
            labels=np.arange(len(classes)),
            average=None,
            zero_division=0,
        )
        macro = precision_recall_fscore_support(
            truth, predicted, average="macro", zero_division=0
        )
        weighted = precision_recall_fscore_support(
            truth, predicted, average="weighted", zero_division=0
        )
        matrix = confusion_matrix(truth, predicted, labels=np.arange(len(classes)))
        artifact_manifest_digest = sha256_file(
            artifact_snapshot / ARTIFACT_MANIFEST
        )
        generated_at = datetime.now(UTC).isoformat()
        per_class = {
            name: {
                "precision": float(precision[index]),
                "recall": float(recall[index]),
                "f1": float(f1[index]),
                "support": int(support[index]),
            }
            for index, name in enumerate(classes)
        }
        metrics = {
            "schemaVersion": 1,
            "status": "complete",
            "generatedAt": generated_at,
            "modelVersion": metadata["modelVersion"],
            "artifactManifestSha256": artifact_manifest_digest,
            "splitManifestSha256": split_digest,
            "datasetVersion": dataset_version,
            "testSetSha256": canonical_json_sha256(test_entries),
            "testSamples": len(test_entries),
            "accuracy": float(np.mean(truth == predicted)),
            "loss": float(evaluated["loss"]),
            "precisionMacro": float(macro[0]),
            "recallMacro": float(macro[1]),
            "f1Macro": float(macro[2]),
            "precisionWeighted": float(weighted[0]),
            "recallWeighted": float(weighted[1]),
            "f1Weighted": float(weighted[2]),
            "perClass": per_class,
        }
        require_finite_metrics(metrics)
        for values in per_class.values():
            require_finite_metrics(values)

        write_json_atomic(report_staging / "metrics.json", metrics)
        np.savetxt(
            report_staging / "confusion_matrix.csv", matrix, delimiter=",", fmt="%d"
        )
        with (report_staging / "predictions.csv").open(
            "w", encoding="utf-8", newline=""
        ) as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["path", "true_label", "predicted_label", "confidence"],
            )
            writer.writeheader()
            for index, entry in enumerate(test_entries):
                writer.writerow(
                    {
                        "path": entry["path"],
                        "true_label": entry["label"],
                        "predicted_label": classes[int(predicted[index])],
                        "confidence": float(np.max(probabilities[index])),
                    }
                )
        plot_confusion(matrix, classes, report_staging / "confusion_matrix.png")
        plot_history(history, report_staging / "training_curves.png")

        report_files = sorted(path.name for path in report_staging.iterdir())
        evaluation_manifest = {
            "schemaVersion": 1,
            "status": "complete",
            "publishedAt": generated_at,
            "modelVersion": metadata["modelVersion"],
            "artifactManifestSha256": artifact_manifest_digest,
            "splitManifestSha256": split_digest,
            "datasetVersion": dataset_version,
            "files": {
                name: sha256_file(report_staging / name) for name in report_files
            },
        }
        write_json_atomic(
            report_staging / "evaluation_manifest.json", evaluation_manifest
        )
        output.mkdir(parents=True, exist_ok=True)
        for name in report_files:
            os.replace(report_staging / name, output / name)
        # A prior run may have produced curves while the current measured
        # history cannot. Remove that known optional file so humans do not
        # mistake stale, uncommitted evidence for part of the new report.
        if "training_curves.png" not in report_files:
            (output / "training_curves.png").unlink(missing_ok=True)
        # This final manifest is the only commit marker for a complete report.
        os.replace(
            report_staging / "evaluation_manifest.json",
            output / "evaluation_manifest.json",
        )
    finally:
        shutil.rmtree(workspace, ignore_errors=True)

    print(f"Evaluation complete on {len(test_entries)} real test samples: {output}")


if __name__ == "__main__":
    main()
