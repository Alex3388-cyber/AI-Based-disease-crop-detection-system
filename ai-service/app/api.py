"""HTTP contract for health, readiness, and authenticated inference."""

from __future__ import annotations

import hmac
import math
import threading
from typing import Any

from flask import Blueprint, current_app, jsonify, request

from .errors import ApiError
from .image_processing import preprocess_bgr, read_limited, validate_and_decode
from .model_runtime import ModelNotReadyError, PredictionError


api = Blueprint("api", __name__)
_semaphores: dict[int, threading.BoundedSemaphore] = {}
_semaphore_lock = threading.Lock()


def _runtime():  # type: ignore[no-untyped-def]
    return current_app.extensions["model_runtime"]


def _authenticate() -> None:
    expected = str(current_app.config.get("AI_SERVICE_SECRET", ""))
    if not expected:
        raise ApiError(
            "SERVICE_NOT_CONFIGURED",
            "The inference service is not securely configured.",
            503,
        )
    supplied = request.headers.get("X-Service-Secret", "")
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise ApiError(
            "UNAUTHORIZED", "Valid service authentication is required.", 401
        )


def _inference_semaphore() -> threading.BoundedSemaphore:
    app_key = id(current_app._get_current_object())
    with _semaphore_lock:
        if app_key not in _semaphores:
            _semaphores[app_key] = threading.BoundedSemaphore(
                int(current_app.config["MAX_CONCURRENT_INFERENCES"])
            )
        return _semaphores[app_key]


@api.get("/health")
def health():  # type: ignore[no-untyped-def]
    return jsonify({"status": "alive"})


@api.get("/ready")
def ready():  # type: ignore[no-untyped-def]
    _authenticate()
    payload: dict[str, Any] = _runtime().readiness()
    return jsonify(payload), 200 if payload["ready"] else 503


@api.post("/predict")
def predict():  # type: ignore[no-untyped-def]
    _authenticate()
    try:
        metadata = _runtime().preprocessing_metadata()
    except ModelNotReadyError as exc:
        raise ApiError(
            "MODEL_NOT_READY",
            "The disease detection model is currently unavailable.",
            503,
        ) from exc

    if request.mimetype != "multipart/form-data":
        raise ApiError(
            "INVALID_REQUEST", "A multipart image upload is required.", 400
        )
    if set(request.files) != {"image"} or request.form:
        raise ApiError(
            "INVALID_IMAGE", "Exactly one image file is required.", 400
        )
    uploaded = request.files["image"]
    data = read_limited(uploaded.stream, int(current_app.config["MAX_IMAGE_BYTES"]))
    image = validate_and_decode(
        data,
        filename=uploaded.filename or "",
        mimetype=uploaded.mimetype or "",
        config=current_app.config,
    )
    try:
        batch = preprocess_bgr(image, metadata)
    except (KeyError, TypeError, ValueError, RuntimeError) as exc:
        raise ApiError(
            "PREDICTION_FAILED", "The image could not be prepared for inference.", 500
        ) from exc

    semaphore = _inference_semaphore()
    acquired = semaphore.acquire(
        timeout=float(current_app.config["INFERENCE_QUEUE_TIMEOUT_SECONDS"])
    )
    if not acquired:
        raise ApiError(
            "SERVICE_BUSY", "The inference service is busy; please try again.", 429
        )
    try:
        result = _runtime().predict(batch)
    except ModelNotReadyError as exc:
        raise ApiError(
            "MODEL_NOT_READY",
            "The disease detection model is currently unavailable.",
            503,
        ) from exc
    except PredictionError as exc:
        raise ApiError(
            "PREDICTION_FAILED", "The model could not produce a valid prediction.", 500
        ) from exc
    finally:
        semaphore.release()

    required = {"modelLabel", "confidence", "modelVersion", "uncertain"}
    confidence = result.get("confidence")
    if (
        set(result) != required
        or not isinstance(result.get("modelLabel"), str)
        or not result["modelLabel"]
        or len(result["modelLabel"]) > 191
        or not isinstance(result.get("modelVersion"), str)
        or not result["modelVersion"]
        or len(result["modelVersion"]) > 100
        or isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or not math.isfinite(float(confidence))
        or not 0.0 <= float(confidence) <= 1.0
        or not isinstance(result.get("uncertain"), bool)
    ):
        raise ApiError(
            "PREDICTION_FAILED", "The model returned an invalid result.", 500
        )
    return jsonify(result)
