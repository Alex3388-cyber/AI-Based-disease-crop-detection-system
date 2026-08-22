from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from common.artifact_bundle import (
    ARTIFACT_FILES,
    snapshot_artifacts,
    validate_model_documents,
)
from common.io_utils import canonical_json_sha256
from common.manifest import load_split_manifest, snapshot_manifest_splits
from evaluation.evaluate import checked_probabilities, snapshot_test_dataset


def model_documents() -> tuple[list[str], dict[str, object], dict[str, object]]:
    classes = ["maize_healthy", "maize_leaf_blight"]
    metadata: dict[str, object] = {
        "schemaVersion": 1,
        "pipelineVersion": "opencv-bgr-rgb-rescale-v1",
        "modelVersion": "test-1.0.0",
        "createdAt": "2026-08-21T00:00:00+00:00",
        "datasetVersion": "dataset-v1",
        "imageWidth": 16,
        "imageHeight": 16,
        "channels": 3,
        "colorSpace": "RGB",
        "resizeInterpolation": "area",
        "dtype": "float32",
        "normalization": {"type": "rescale", "scale": 1 / 255, "offset": 0},
        "output": {"type": "probabilities"},
        "confidenceThreshold": 0.7,
        "classes": classes,
        "splitManifestSha256": "a" * 64,
    }
    history: dict[str, object] = {
        "schemaVersion": 1,
        "status": "complete",
        "modelVersion": "test-1.0.0",
        "epochsCompleted": 2,
        "bestEpochByValidationLoss": 2,
        "history": {"loss": [0.8, 0.6], "val_loss": [0.9, 0.7]},
    }
    return classes, metadata, history


def write_artifacts(root: Path) -> None:
    classes, metadata, history = model_documents()
    (root / "best_model.keras").write_bytes(b"model-bytes")
    (root / "class_names.json").write_text(json.dumps(classes), encoding="utf-8")
    (root / "model_metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    (root / "training_history.json").write_text(json.dumps(history), encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "modelVersion": "test-1.0.0",
        "files": {
            name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in ARTIFACT_FILES
        },
    }
    (root / "artifact_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_artifact_snapshot_rejects_a_mixed_release(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    write_artifacts(source)
    (source / "class_names.json").write_text('["changed_label"]', encoding="utf-8")

    with pytest.raises(ValueError, match="training_artifacts_not_committed"):
        snapshot_artifacts(source, tmp_path / "snapshot")


def test_artifact_snapshot_and_documents_are_version_bound(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    write_artifacts(source)
    destination = tmp_path / "snapshot"

    manifest = snapshot_artifacts(source, destination)
    classes, metadata, history = model_documents()

    assert manifest["modelVersion"] == "test-1.0.0"
    assert validate_model_documents(classes, metadata, history)[1] == metadata
    history["modelVersion"] = "different"
    with pytest.raises(ValueError, match="training_history_version_mismatch"):
        validate_model_documents(classes, metadata, history)


def test_probability_roundoff_is_normalized_to_http_safe_bounds() -> None:
    values = checked_probabilities(
        np.asarray([[-0.0000005, 1.0000005]]), expected_rows=1, class_count=2
    )

    assert values.tolist() == [[0.0, 1.0]]


def test_test_dataset_is_copied_from_manifest_hashes(tmp_path: Path) -> None:
    dataset = tmp_path / "dataset"
    dataset.mkdir()
    image = dataset / "maize_healthy" / "leaf.jpg"
    image.parent.mkdir()
    image.write_bytes(b"immutable-image")
    digest = hashlib.sha256(image.read_bytes()).hexdigest()
    entries = [{"path": "maize_healthy/leaf.jpg", "label": "maize_healthy", "sha256": digest}]
    manifest = {
        "schemaVersion": 1,
        "classNames": ["maize_healthy"],
        "splits": {"train": [], "validation": [], "test": entries},
    }
    snapshot = tmp_path / "snapshot"

    assert snapshot_test_dataset(manifest, dataset, snapshot) == entries
    assert hashlib.sha256((snapshot / "maize_healthy" / "leaf.jpg").read_bytes()).hexdigest() == digest
    assert canonical_json_sha256(entries)


def test_training_splits_are_copied_to_an_isolated_verified_snapshot(
    tmp_path: Path,
) -> None:
    dataset = tmp_path / "dataset"
    train_source = dataset / "maize_healthy" / "train.jpg"
    validation_source = dataset / "maize_healthy" / "validation.jpg"
    test_source = dataset / "maize_healthy" / "test.jpg"
    train_source.parent.mkdir(parents=True)
    train_source.write_bytes(b"train-image")
    validation_source.write_bytes(b"validation-image")
    test_source.write_bytes(b"test-image")

    def entry(path: Path) -> dict[str, str]:
        return {
            "path": path.relative_to(dataset).as_posix(),
            "label": "maize_healthy",
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }

    train_entry = entry(train_source)
    validation_entry = entry(validation_source)
    test_entry = entry(test_source)
    manifest = {
        "classNames": ["maize_healthy"],
        "splits": {
            "train": [train_entry],
            "validation": [validation_entry],
            "test": [test_entry],
        },
    }
    snapshot = tmp_path / "snapshot"

    snapshot_manifest_splits(
        manifest,
        dataset,
        snapshot,
        splits=("train", "validation"),
    )
    train_source.write_bytes(b"source-changed-after-snapshot")

    assert (snapshot / train_entry["path"]).read_bytes() == b"train-image"
    assert (snapshot / validation_entry["path"]).read_bytes() == b"validation-image"
    assert not (snapshot / test_entry["path"]).exists()
    assert manifest["classNames"] == ["maize_healthy"]
    assert manifest["splits"]["train"] == [train_entry]
    assert manifest["splits"]["validation"] == [validation_entry]


def test_training_snapshot_rejects_changed_source_bytes(tmp_path: Path) -> None:
    dataset = tmp_path / "dataset"
    image = dataset / "maize_healthy" / "leaf.jpg"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"changed-image")
    manifest = {
        "splits": {
            "train": [
                {
                    "path": "maize_healthy/leaf.jpg",
                    "label": "maize_healthy",
                    "sha256": hashlib.sha256(b"original-image").hexdigest(),
                }
            ],
            "validation": [],
            "test": [],
        }
    }

    with pytest.raises(ValueError, match="changed during snapshot"):
        snapshot_manifest_splits(
            manifest,
            dataset,
            tmp_path / "snapshot",
            splits=("train", "validation"),
        )


def test_split_manifest_rejects_a_duplicate_path(tmp_path: Path) -> None:
    duplicate = {"path": "maize/leaf.jpg", "label": "maize_healthy", "sha256": "a" * 64}
    document = {
        "schemaVersion": 1,
        "classNames": ["maize_healthy"],
        "splits": {"train": [duplicate, duplicate], "validation": [], "test": []},
    }
    manifest_path = tmp_path / "split.json"
    manifest_path.write_text(json.dumps(document), encoding="utf-8")

    with pytest.raises(ValueError, match="more than once"):
        load_split_manifest(manifest_path)


def test_split_manifest_rejects_a_non_hex_digest(tmp_path: Path) -> None:
    document = {
        "schemaVersion": 1,
        "classNames": ["maize_healthy"],
        "splits": {
            "train": [
                {
                    "path": "maize/leaf.jpg",
                    "label": "maize_healthy",
                    "sha256": "z" * 64,
                }
            ],
            "validation": [],
            "test": [],
        },
    }
    manifest_path = tmp_path / "split.json"
    manifest_path.write_text(json.dumps(document), encoding="utf-8")

    with pytest.raises(ValueError, match="Invalid entry"):
        load_split_manifest(manifest_path)
