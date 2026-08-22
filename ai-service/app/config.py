"""Environment-backed service configuration with strict numeric parsing."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


SERVICE_ROOT = Path(__file__).resolve().parents[1]


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _env_float(
    name: str, default: float | None, minimum: float, maximum: float
) -> float | None:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be numeric") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def default_config() -> dict[str, Any]:
    model_dir = Path(os.getenv("MODEL_DIR", str(SERVICE_ROOT / "model")))
    max_image_bytes = _env_int(
        "MAX_IMAGE_BYTES", 8 * 1024 * 1024, 1024, 8 * 1024 * 1024
    )
    return {
        "TESTING": False,
        "LOG_LEVEL": os.getenv("LOG_LEVEL", "INFO").upper(),
        "AI_SERVICE_SECRET": os.getenv("AI_SERVICE_SECRET", ""),
        "MODEL_PATH": str(model_dir / "best_model.keras"),
        "CLASS_NAMES_PATH": str(model_dir / "class_names.json"),
        "MODEL_METADATA_PATH": str(model_dir / "model_metadata.json"),
        "TRAINING_HISTORY_PATH": str(model_dir / "training_history.json"),
        "MODEL_BUNDLE_MANIFEST_PATH": str(model_dir / "bundle_manifest.json"),
        "MAX_IMAGE_BYTES": max_image_bytes,
        "MAX_MULTIPART_OVERHEAD_BYTES": _env_int(
            "MAX_MULTIPART_OVERHEAD_BYTES", 64 * 1024, 4096, 1024 * 1024
        ),
        "MIN_IMAGE_DIMENSION": _env_int("MIN_IMAGE_DIMENSION", 32, 1, 1024),
        "MAX_IMAGE_WIDTH": _env_int("MAX_IMAGE_WIDTH", 8192, 64, 32768),
        "MAX_IMAGE_HEIGHT": _env_int("MAX_IMAGE_HEIGHT", 8192, 64, 32768),
        "MAX_IMAGE_PIXELS": _env_int(
            "MAX_IMAGE_PIXELS", 25_000_000, 4096, 100_000_000
        ),
        "MAX_MODEL_BYTES": _env_int(
            "MAX_MODEL_BYTES", 1024 * 1024 * 1024, 1024, 4 * 1024 * 1024 * 1024
        ),
        "MODEL_LOAD_RETRY_SECONDS": _env_float(
            "MODEL_LOAD_RETRY_SECONDS", 10.0, 0.0, 3600.0
        ),
        # None means use the value exported with the model.
        "MODEL_CONFIDENCE_THRESHOLD": _env_float(
            "MODEL_CONFIDENCE_THRESHOLD", None, 0.0, 1.0
        ),
        "MAX_CONCURRENT_INFERENCES": _env_int(
            "MAX_CONCURRENT_INFERENCES", 2, 1, 64
        ),
        "INFERENCE_QUEUE_TIMEOUT_SECONDS": _env_float(
            "INFERENCE_QUEUE_TIMEOUT_SECONDS", 1.0, 0.0, 30.0
        ),
    }
