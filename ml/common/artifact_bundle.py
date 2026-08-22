"""Hash-bound snapshots of training artifacts used by export and evaluation."""

from __future__ import annotations

import re
import shutil
import math
from pathlib import Path
from typing import Any

from . import PIPELINE_VERSION
from .io_utils import read_json, sha256_file


ARTIFACT_FILES = (
    "best_model.keras",
    "class_names.json",
    "training_history.json",
    "model_metadata.json",
)
ARTIFACT_MANIFEST = "artifact_manifest.json"
MAX_MODEL_BYTES = 1024 * 1024 * 1024
MAX_JSON_BYTES = 1024 * 1024
MODEL_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
CLASS_LABEL = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")


def validate_artifact_manifest(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict) or set(document) != {
        "schemaVersion",
        "modelVersion",
        "files",
    }:
        raise ValueError("training_artifact_manifest_invalid")
    if document["schemaVersion"] != 1:
        raise ValueError("training_artifact_manifest_schema_unsupported")
    if (
        not isinstance(document["modelVersion"], str)
        or MODEL_VERSION.fullmatch(document["modelVersion"]) is None
    ):
        raise ValueError("training_artifact_model_version_invalid")
    files = document["files"]
    if (
        not isinstance(files, dict)
        or set(files) != set(ARTIFACT_FILES)
        or any(
            not isinstance(digest, str) or SHA256.fullmatch(digest) is None
            for digest in files.values()
        )
    ):
        raise ValueError("training_artifact_hashes_invalid")
    return document


def snapshot_artifacts(source: Path, destination: Path) -> dict[str, Any]:
    """Copy exactly one committed artifact release into an isolated directory."""

    source = source.resolve(strict=True)
    if not source.is_dir():
        raise ValueError("training_artifact_directory_invalid")
    destination.mkdir(parents=True, exist_ok=True)
    manifest_path = source / ARTIFACT_MANIFEST
    manifest = validate_artifact_manifest(
        read_json(manifest_path, maximum_bytes=MAX_JSON_BYTES)
    )
    hashes = manifest["files"]

    for name in ARTIFACT_FILES:
        source_file = source / name
        maximum = MAX_MODEL_BYTES if name == "best_model.keras" else MAX_JSON_BYTES
        if (
            not source_file.is_file()
            or source_file.is_symlink()
            or source_file.stat().st_size <= 0
            or source_file.stat().st_size > maximum
        ):
            raise ValueError(f"training_artifact_unsafe:{name}")
        if sha256_file(source_file) != hashes[name]:
            raise ValueError("training_artifacts_not_committed")
        shutil.copyfile(source_file, destination / name)

    shutil.copyfile(manifest_path, destination / ARTIFACT_MANIFEST)
    if validate_artifact_manifest(
        read_json(manifest_path, maximum_bytes=MAX_JSON_BYTES)
    ) != manifest:
        raise ValueError("training_artifacts_changed_during_snapshot")
    if validate_artifact_manifest(
        read_json(destination / ARTIFACT_MANIFEST, maximum_bytes=MAX_JSON_BYTES)
    ) != manifest:
        raise ValueError("training_artifacts_changed_during_snapshot")
    for name in ARTIFACT_FILES:
        if sha256_file(destination / name) != hashes[name]:
            raise ValueError("training_artifacts_changed_during_snapshot")
    return manifest


def validate_model_documents(
    classes: Any, metadata: Any, history: Any
) -> tuple[list[str], dict[str, Any], dict[str, Any]]:
    """Enforce the shared training/export/evaluation document contract."""

    if (
        not isinstance(classes, list)
        or not classes
        or len(classes) > 10_000
        or any(
            not isinstance(label, str)
            or len(label) > 191
            or CLASS_LABEL.fullmatch(label) is None
            for label in classes
        )
        or len(set(classes)) != len(classes)
    ):
        raise ValueError("class_names_invalid")
    if not isinstance(metadata, dict):
        raise ValueError("model_metadata_invalid")
    required_metadata = {
        "schemaVersion",
        "pipelineVersion",
        "modelVersion",
        "createdAt",
        "datasetVersion",
        "imageWidth",
        "imageHeight",
        "channels",
        "colorSpace",
        "resizeInterpolation",
        "dtype",
        "normalization",
        "output",
        "confidenceThreshold",
        "classes",
        "splitManifestSha256",
    }
    if not required_metadata.issubset(metadata) or metadata["schemaVersion"] != 1:
        raise ValueError("model_metadata_schema_invalid")
    if metadata["classes"] != classes or metadata["pipelineVersion"] != PIPELINE_VERSION:
        raise ValueError("model_metadata_contract_mismatch")
    if (
        not isinstance(metadata["modelVersion"], str)
        or MODEL_VERSION.fullmatch(metadata["modelVersion"]) is None
    ):
        raise ValueError("model_version_invalid")
    maximum_lengths = {"createdAt": 100, "datasetVersion": 200}
    if any(
        not isinstance(metadata[field], str)
        or not metadata[field].strip()
        or metadata[field].strip() != metadata[field]
        or len(metadata[field]) > maximum
        for field, maximum in maximum_lengths.items()
    ):
        raise ValueError("model_metadata_strings_invalid")
    split_digest = metadata["splitManifestSha256"]
    if not isinstance(split_digest, str) or SHA256.fullmatch(split_digest) is None:
        raise ValueError("model_split_digest_invalid")
    width, height = metadata["imageWidth"], metadata["imageHeight"]
    if (
        isinstance(width, bool)
        or isinstance(height, bool)
        or not isinstance(width, int)
        or not isinstance(height, int)
        or not 16 <= width <= 4096
        or not 16 <= height <= 4096
        or width * height > 1_048_576
    ):
        raise ValueError("model_input_dimensions_invalid")
    if metadata["channels"] != 3 or metadata["colorSpace"] != "RGB" or metadata["dtype"] != "float32":
        raise ValueError("model_input_tensor_invalid")
    if metadata["resizeInterpolation"] not in {"nearest", "bilinear", "bicubic", "area", "lanczos4"}:
        raise ValueError("model_resize_invalid")
    normalization = metadata["normalization"]
    if not isinstance(normalization, dict) or normalization.get("type") != "rescale":
        raise ValueError("model_normalization_invalid")
    for field in ("scale", "offset"):
        value = normalization.get(field)
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            or abs(float(value)) > 1000
        ):
            raise ValueError("model_normalization_invalid")
    threshold = metadata["confidenceThreshold"]
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not math.isfinite(float(threshold))
        or not 0 <= float(threshold) <= 1
    ):
        raise ValueError("model_threshold_invalid")
    if metadata["output"] != {"type": "probabilities"}:
        raise ValueError("model_output_invalid")

    if not isinstance(history, dict):
        raise ValueError("training_history_invalid")
    required_history = {
        "schemaVersion",
        "status",
        "modelVersion",
        "epochsCompleted",
        "bestEpochByValidationLoss",
        "history",
    }
    if not required_history.issubset(history) or history["schemaVersion"] != 1:
        raise ValueError("training_history_schema_invalid")
    if history["status"] != "complete" or history["modelVersion"] != metadata["modelVersion"]:
        raise ValueError("training_history_version_mismatch")
    epochs = history["epochsCompleted"]
    best_epoch = history["bestEpochByValidationLoss"]
    measurements = history["history"]
    if (
        isinstance(epochs, bool)
        or not isinstance(epochs, int)
        or not 1 <= epochs <= 10_000
        or isinstance(best_epoch, bool)
        or not isinstance(best_epoch, int)
        or not 1 <= best_epoch <= epochs
        or not isinstance(measurements, dict)
        or "val_loss" not in measurements
        or not measurements
    ):
        raise ValueError("training_history_measurements_invalid")
    for metric, values in measurements.items():
        if (
            not isinstance(metric, str)
            or not metric
            or not isinstance(values, list)
            or len(values) != epochs
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                for value in values
            )
        ):
            raise ValueError("training_history_measurements_invalid")
    return classes, metadata, history
