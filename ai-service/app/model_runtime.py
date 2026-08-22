"""Thread-safe, lazy loading and strict validation of Keras artifacts."""

from __future__ import annotations

import hashlib
import importlib
import json
import logging
import math
import re
import threading
import time
from pathlib import Path
from typing import Any, Mapping

import numpy as np


_CLASS_LABEL = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")
_MODEL_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
_MAX_MODEL_INPUT_PIXELS = 1_048_576


class ModelNotReadyError(RuntimeError):
    pass


class PredictionError(RuntimeError):
    pass


_SHA256 = re.compile(r"^[a-f0-9]{64}$")


def _shape_tuple(shape: Any) -> tuple[int | None, ...]:
    if isinstance(shape, list):
        raise ValueError("multiple model inputs or outputs are unsupported")
    return tuple(None if value is None else int(value) for value in shape)


def _load_json(path: Path, maximum_bytes: int = 1024 * 1024) -> Any:
    if not path.is_file() or path.is_symlink():
        raise ValueError("artifact_missing")
    size = path.stat().st_size
    if size <= 0 or size > maximum_bytes:
        raise ValueError("artifact_size_invalid")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("artifact_json_invalid") from exc


def _sha256_file(path: Path, maximum_bytes: int) -> str:
    if not path.is_file() or path.is_symlink():
        raise ValueError("artifact_missing")
    size = path.stat().st_size
    if size <= 0 or size > maximum_bytes:
        raise ValueError("artifact_size_invalid")
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ValueError("artifact_read_failed") from exc
    return digest.hexdigest()


def validate_bundle_manifest(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict) or set(document) != {
        "schemaVersion",
        "exportedAt",
        "modelVersion",
        "files",
    }:
        raise ValueError("bundle_manifest_invalid")
    if document["schemaVersion"] != 1:
        raise ValueError("bundle_manifest_schema_unsupported")
    if not isinstance(document["exportedAt"], str) or not document["exportedAt"].strip():
        raise ValueError("bundle_manifest_invalid")
    if (
        not isinstance(document["modelVersion"], str)
        or _MODEL_VERSION.fullmatch(document["modelVersion"]) is None
    ):
        raise ValueError("bundle_manifest_invalid")
    files = document["files"]
    required = {
        "best_model.keras",
        "class_names.json",
        "model_metadata.json",
        "training_history.json",
    }
    if not isinstance(files, dict) or set(files) != required:
        raise ValueError("bundle_manifest_files_missing")
    if any(
        not isinstance(name, str)
        or not isinstance(digest, str)
        or _SHA256.fullmatch(digest) is None
        for name, digest in files.items()
    ):
        raise ValueError("bundle_manifest_hash_invalid")
    return document


def validate_class_names(document: Any) -> tuple[str, ...]:
    if not isinstance(document, list) or not document or len(document) > 10_000:
        raise ValueError("class_names_invalid")
    labels: list[str] = []
    for value in document:
        if (
            not isinstance(value, str)
            or not value
            or len(value) > 191
            or value.strip() != value
            or _CLASS_LABEL.fullmatch(value) is None
        ):
            raise ValueError("class_names_invalid")
        labels.append(value)
    if len(set(labels)) != len(labels):
        raise ValueError("class_names_not_unique")
    return tuple(labels)


def validate_metadata(document: Any, labels: tuple[str, ...]) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise ValueError("metadata_invalid")
    required = {
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
    if not required.issubset(document):
        raise ValueError("metadata_fields_missing")
    if document["schemaVersion"] != 1:
        raise ValueError("metadata_schema_unsupported")
    if document["pipelineVersion"] != "opencv-bgr-rgb-rescale-v1":
        raise ValueError("metadata_pipeline_unsupported")
    if (
        not isinstance(document["modelVersion"], str)
        or _MODEL_VERSION.fullmatch(document["modelVersion"]) is None
    ):
        raise ValueError("metadata_model_version_invalid")
    maximum_lengths = {"modelVersion": 100, "createdAt": 100, "datasetVersion": 200}
    for field, maximum_length in maximum_lengths.items():
        if (
            not isinstance(document[field], str)
            or not document[field].strip()
            or document[field].strip() != document[field]
            or len(document[field]) > maximum_length
        ):
            raise ValueError("metadata_string_invalid")
    for field in ("imageWidth", "imageHeight"):
        value = document[field]
        if isinstance(value, bool) or not isinstance(value, int) or not 16 <= value <= 4096:
            raise ValueError("metadata_dimensions_invalid")
    if document["imageWidth"] * document["imageHeight"] > _MAX_MODEL_INPUT_PIXELS:
        raise ValueError("metadata_dimensions_invalid")
    if document["channels"] != 3 or document["colorSpace"] != "RGB":
        raise ValueError("metadata_color_invalid")
    if document["dtype"] != "float32":
        raise ValueError("metadata_dtype_unsupported")
    if document["resizeInterpolation"] not in {
        "nearest",
        "bilinear",
        "bicubic",
        "area",
        "lanczos4",
    }:
        raise ValueError("metadata_resize_unsupported")
    normalization = document["normalization"]
    if not isinstance(normalization, dict) or normalization.get("type") != "rescale":
        raise ValueError("metadata_normalization_unsupported")
    for field in ("scale", "offset"):
        value = normalization.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("metadata_normalization_invalid")
        if not math.isfinite(float(value)) or abs(float(value)) > 1000:
            raise ValueError("metadata_normalization_invalid")
    split_manifest_digest = document["splitManifestSha256"]
    if (
        not isinstance(split_manifest_digest, str)
        or _SHA256.fullmatch(split_manifest_digest) is None
    ):
        raise ValueError("metadata_split_manifest_digest_invalid")
    output = document["output"]
    if output != {"type": "probabilities"}:
        raise ValueError("metadata_output_invalid")
    threshold = document["confidenceThreshold"]
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not 0.0 <= float(threshold) <= 1.0
    ):
        raise ValueError("metadata_threshold_invalid")
    if document["classes"] != list(labels):
        raise ValueError("metadata_classes_mismatch")
    return document


def validate_training_history(document: Any, model_version: str) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise ValueError("training_history_invalid")
    required = {
        "schemaVersion",
        "status",
        "modelVersion",
        "epochsCompleted",
        "bestEpochByValidationLoss",
        "history",
    }
    if not required.issubset(document) or document["schemaVersion"] != 1:
        raise ValueError("training_history_invalid")
    if document["status"] != "complete" or document["modelVersion"] != model_version:
        raise ValueError("training_history_version_mismatch")
    epochs = document["epochsCompleted"]
    best_epoch = document["bestEpochByValidationLoss"]
    history = document["history"]
    if (
        isinstance(epochs, bool)
        or not isinstance(epochs, int)
        or not 1 <= epochs <= 10_000
        or isinstance(best_epoch, bool)
        or not isinstance(best_epoch, int)
        or not 1 <= best_epoch <= epochs
        or not isinstance(history, dict)
        or "val_loss" not in history
        or not history
    ):
        raise ValueError("training_history_invalid")
    for metric, values in history.items():
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
            raise ValueError("training_history_invalid")
    return document


class ModelRuntime:
    def __init__(
        self,
        *,
        model_path: Path,
        class_names_path: Path,
        metadata_path: Path,
        training_history_path: Path,
        bundle_manifest_path: Path,
        max_model_bytes: int,
        retry_seconds: float,
        threshold_override: float | None,
        logger: logging.Logger,
    ) -> None:
        self._model_path = model_path
        self._class_names_path = class_names_path
        self._metadata_path = metadata_path
        self._training_history_path = training_history_path
        self._bundle_manifest_path = bundle_manifest_path
        self._max_model_bytes = max_model_bytes
        self._retry_seconds = retry_seconds
        self._threshold_override = threshold_override
        self._logger = logger
        self._model: Any | None = None
        self._labels: tuple[str, ...] = ()
        self._metadata: dict[str, Any] | None = None
        self._last_attempt = -math.inf
        self._load_lock = threading.Lock()
        self._predict_lock = threading.Lock()

    @classmethod
    def from_config(
        cls, config: Mapping[str, Any], *, logger: logging.Logger
    ) -> "ModelRuntime":
        return cls(
            model_path=Path(config["MODEL_PATH"]),
            class_names_path=Path(config["CLASS_NAMES_PATH"]),
            metadata_path=Path(config["MODEL_METADATA_PATH"]),
            training_history_path=Path(config["TRAINING_HISTORY_PATH"]),
            bundle_manifest_path=Path(config["MODEL_BUNDLE_MANIFEST_PATH"]),
            max_model_bytes=int(config["MAX_MODEL_BYTES"]),
            retry_seconds=float(config["MODEL_LOAD_RETRY_SECONDS"]),
            threshold_override=config["MODEL_CONFIDENCE_THRESHOLD"],
            logger=logger,
        )

    def _load(self) -> None:
        if self._model_path.suffix != ".keras":
            raise ValueError("model_format_unsupported")
        if not self._model_path.is_file() or self._model_path.is_symlink():
            raise ValueError("model_missing")
        manifest = validate_bundle_manifest(_load_json(self._bundle_manifest_path))
        artifact_paths = {
            "best_model.keras": (self._model_path, self._max_model_bytes),
            "class_names.json": (self._class_names_path, 1024 * 1024),
            "model_metadata.json": (self._metadata_path, 1024 * 1024),
            "training_history.json": (self._training_history_path, 1024 * 1024),
        }
        for name, (path, maximum_bytes) in artifact_paths.items():
            if _sha256_file(path, maximum_bytes) != manifest["files"][name]:
                raise ValueError("bundle_hash_mismatch")

        labels = validate_class_names(_load_json(self._class_names_path))
        metadata = validate_metadata(_load_json(self._metadata_path), labels)
        validate_training_history(
            _load_json(self._training_history_path), metadata["modelVersion"]
        )
        if metadata["modelVersion"] != manifest["modelVersion"]:
            raise ValueError("bundle_model_version_mismatch")

        try:
            tensorflow = importlib.import_module("tensorflow")
        except ImportError as exc:
            raise ValueError("tensorflow_unavailable") from exc
        # safe_mode prevents deserializing arbitrary Python objects from a .keras file.
        model = tensorflow.keras.models.load_model(
            self._model_path, compile=False, safe_mode=True
        )
        input_shape = _shape_tuple(model.input_shape)
        output_shape = _shape_tuple(model.output_shape)
        expected_input = (
            None,
            int(metadata["imageHeight"]),
            int(metadata["imageWidth"]),
            3,
        )
        if len(input_shape) != 4 or any(
            actual not in {None, expected}
            for actual, expected in zip(input_shape, expected_input, strict=True)
        ):
            raise ValueError("model_input_shape_mismatch")
        if len(output_shape) != 2 or output_shape[-1] != len(labels):
            raise ValueError("model_output_shape_mismatch")
        model_inputs = getattr(model, "inputs", ())
        if len(model_inputs) != 1:
            raise ValueError("model_input_dtype_mismatch")
        input_dtype = getattr(model_inputs[0], "dtype", None)
        dtype_name = getattr(input_dtype, "name", str(input_dtype))
        if dtype_name != "float32":
            raise ValueError("model_input_dtype_mismatch")

        smoke_batch = np.zeros(
            (
                1,
                int(metadata["imageHeight"]),
                int(metadata["imageWidth"]),
                3,
            ),
            dtype=np.float32,
        )
        smoke_output = np.asarray(model.predict(smoke_batch, verbose=0), dtype=np.float64)
        if smoke_output.shape != (1, len(labels)) or not np.isfinite(smoke_output).all():
            raise ValueError("model_smoke_inference_failed")
        if (
            np.any(smoke_output < -1e-6)
            or np.any(smoke_output > 1.0 + 1e-6)
            or not np.isclose(np.sum(smoke_output[0]), 1.0, atol=1e-3)
        ):
            raise ValueError("model_smoke_inference_failed")

        # The exporter publishes the manifest last. Rechecking the manifest and
        # hashes after deserialization rejects every partial/live replacement
        # window. An already-loaded process keeps its coherent old in-memory
        # bundle until it is intentionally restarted.
        final_manifest = validate_bundle_manifest(_load_json(self._bundle_manifest_path))
        if final_manifest != manifest:
            raise ValueError("bundle_changed_during_load")
        for name, (path, maximum_bytes) in artifact_paths.items():
            if _sha256_file(path, maximum_bytes) != manifest["files"][name]:
                raise ValueError("bundle_changed_during_load")

        self._model = model
        self._labels = labels
        self._metadata = metadata
        self._logger.info(
            "model_loaded",
            extra={
                "event": "model_loaded",
                "model_version": metadata["modelVersion"],
            },
        )

    def ensure_loaded(self) -> bool:
        if self._model is not None:
            return True
        now = time.monotonic()
        if now - self._last_attempt < self._retry_seconds:
            return False
        with self._load_lock:
            if self._model is not None:
                return True
            now = time.monotonic()
            if now - self._last_attempt < self._retry_seconds:
                return False
            self._last_attempt = now
            try:
                self._load()
            except Exception as exc:
                # Only a bounded reason identifier is logged; artifact paths and
                # deserializer details never enter an HTTP response.
                self._logger.warning(
                    "model_not_ready",
                    extra={
                        "event": "model_not_ready",
                        "reason": str(exc)[:80] if isinstance(exc, ValueError) else type(exc).__name__,
                    },
                )
                self._model = None
                self._labels = ()
                self._metadata = None
                return False
            return True

    def readiness(self) -> dict[str, Any]:
        if not self.ensure_loaded() or self._metadata is None:
            return {"ready": False, "reason": "MODEL_NOT_READY"}
        class_set_digest = hashlib.sha256(
            "\n".join(sorted(self._labels)).encode("utf-8")
        ).hexdigest()
        return {
            "ready": True,
            "modelVersion": self._metadata["modelVersion"],
            "classSetDigest": class_set_digest,
        }

    def preprocessing_metadata(self) -> Mapping[str, Any]:
        if not self.ensure_loaded() or self._metadata is None:
            raise ModelNotReadyError("MODEL_NOT_READY")
        return self._metadata

    def predict(self, batch: np.ndarray) -> dict[str, Any]:
        if not self.ensure_loaded() or self._model is None or self._metadata is None:
            raise ModelNotReadyError("MODEL_NOT_READY")
        expected_shape = (
            1,
            int(self._metadata["imageHeight"]),
            int(self._metadata["imageWidth"]),
            3,
        )
        if batch.shape != expected_shape or batch.dtype != np.float32:
            raise PredictionError("invalid model input")
        try:
            with self._predict_lock:
                raw = self._model.predict(batch, verbose=0)
            values = np.asarray(raw, dtype=np.float64)
        except Exception as exc:
            raise PredictionError("model inference failed") from exc
        if values.shape != (1, len(self._labels)) or not np.isfinite(values).all():
            raise PredictionError("invalid model output")

        scores = values[0]
        if (
            np.any(scores < -1e-6)
            or np.any(scores > 1.0 + 1e-6)
            or not np.isclose(np.sum(scores), 1.0, atol=1e-3)
        ):
            raise PredictionError("invalid probability output")
        scores = np.clip(scores, 0.0, 1.0)
        score_total = float(np.sum(scores))
        if not math.isfinite(score_total) or score_total <= 0:
            raise PredictionError("invalid probability output")
        scores = scores / score_total

        index = int(np.argmax(scores))
        confidence = float(scores[index])
        threshold = (
            float(self._threshold_override)
            if self._threshold_override is not None
            else float(self._metadata["confidenceThreshold"])
        )
        return {
            "modelLabel": self._labels[index],
            "confidence": confidence,
            "modelVersion": self._metadata["modelVersion"],
            "uncertain": confidence < threshold,
        }
