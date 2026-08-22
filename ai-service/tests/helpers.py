from __future__ import annotations

import hashlib
from typing import Any

import numpy as np

from app.model_runtime import ModelNotReadyError


SECRET = "test-service-secret-at-least-32-characters"


def metadata() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "pipelineVersion": "opencv-bgr-rgb-rescale-v1",
        "modelVersion": "test-1.0.0",
        "createdAt": "2026-01-01T00:00:00+00:00",
        "datasetVersion": "test-dataset",
        "imageWidth": 16,
        "imageHeight": 16,
        "channels": 3,
        "colorSpace": "RGB",
        "resizeInterpolation": "nearest",
        "dtype": "float32",
        "normalization": {
            "type": "rescale",
            "scale": 1.0 / 255.0,
            "offset": 0.0,
        },
        "output": {"type": "probabilities"},
        "confidenceThreshold": 0.7,
        "classes": ["maize_healthy", "maize_leaf_blight"],
        "splitManifestSha256": "a" * 64,
    }


def training_history() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "status": "complete",
        "modelVersion": "test-1.0.0",
        "epochsCompleted": 2,
        "bestEpochByValidationLoss": 2,
        "history": {
            "loss": [0.8, 0.6],
            "val_loss": [0.9, 0.7],
        },
    }


class ReadyRuntime:
    def __init__(self, result: dict[str, Any] | None = None) -> None:
        self.metadata = metadata()
        self.last_batch: np.ndarray | None = None
        self.result = result or {
            "modelLabel": "maize_healthy",
            "confidence": 0.875,
            "modelVersion": "test-1.0.0",
            "uncertain": False,
        }

    def readiness(self) -> dict[str, Any]:
        digest = hashlib.sha256(
            "\n".join(sorted(self.metadata["classes"])).encode("utf-8")
        ).hexdigest()
        return {
            "ready": True,
            "modelVersion": "test-1.0.0",
            "classSetDigest": digest,
        }

    def preprocessing_metadata(self) -> dict[str, Any]:
        return self.metadata

    def predict(self, batch: np.ndarray) -> dict[str, Any]:
        self.last_batch = batch.copy()
        return self.result


class MissingRuntime:
    def readiness(self) -> dict[str, Any]:
        return {"ready": False, "reason": "MODEL_NOT_READY"}

    def preprocessing_metadata(self) -> dict[str, Any]:
        raise ModelNotReadyError("MODEL_NOT_READY")


def app_config(**overrides: Any) -> dict[str, Any]:
    config: dict[str, Any] = {
        "TESTING": True,
        "AI_SERVICE_SECRET": SECRET,
        "MODEL_LOAD_RETRY_SECONDS": 0,
        "MIN_IMAGE_DIMENSION": 1,
        "MAX_IMAGE_WIDTH": 4096,
        "MAX_IMAGE_HEIGHT": 4096,
        "MAX_IMAGE_PIXELS": 16_777_216,
        "INFERENCE_QUEUE_TIMEOUT_SECONDS": 0,
    }
    config.update(overrides)
    return config
