"""Application factory for the private crop-disease inference service."""

from __future__ import annotations

import re
import time
import uuid
from typing import Any, Mapping

from flask import Flask, g, request

from .api import api
from .config import default_config
from .errors import register_error_handlers
from .logging_config import configure_logging
from .model_runtime import ModelRuntime


_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def _is_placeholder_secret(value: str) -> bool:
    normalized = value.lower().replace("-", "_").replace(" ", "_")
    return any(
        marker in normalized
        for marker in ("change_me", "change_to", "changeto", "placeholder")
    )


def create_app(
    config: Mapping[str, Any] | None = None,
    *,
    runtime: ModelRuntime | None = None,
) -> Flask:
    """Create a configured Flask app without eagerly importing TensorFlow."""

    app = Flask(__name__)
    app.config.from_mapping(default_config())
    if config:
        app.config.from_mapping(config)

    service_secret = str(app.config.get("AI_SERVICE_SECRET", "")).strip()
    if not app.config.get("TESTING", False) and (
        len(service_secret) < 32 or _is_placeholder_secret(service_secret)
    ):
        raise RuntimeError(
            "AI_SERVICE_SECRET must be a non-placeholder value of at least 32 characters"
        )

    # MAX_CONTENT_LENGTH covers the image plus bounded multipart framing. The
    # image stream itself is independently capped at exactly MAX_IMAGE_BYTES.
    app.config["MAX_CONTENT_LENGTH"] = (
        int(app.config["MAX_IMAGE_BYTES"])
        + int(app.config["MAX_MULTIPART_OVERHEAD_BYTES"])
    )

    logger = configure_logging(app.config["LOG_LEVEL"])
    app.extensions["service_logger"] = logger
    app.extensions["model_runtime"] = runtime or ModelRuntime.from_config(
        app.config, logger=logger
    )

    @app.before_request
    def begin_request() -> None:
        supplied = request.headers.get("X-Request-ID", "")
        g.request_id = supplied if _REQUEST_ID.fullmatch(supplied) else uuid.uuid4().hex
        g.request_started = time.perf_counter()

    @app.after_request
    def finish_request(response):  # type: ignore[no-untyped-def]
        response.headers["X-Request-ID"] = g.get("request_id", "")
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        duration_ms = round(
            (time.perf_counter() - g.get("request_started", time.perf_counter()))
            * 1000,
            2,
        )
        logger.info(
            "request_completed",
            extra={
                "event": "request_completed",
                "request_id": g.get("request_id"),
                "method": request.method,
                "endpoint": request.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response

    app.register_blueprint(api)
    register_error_handlers(app)
    return app


__all__ = ["create_app"]
