"""Small JSON logging setup that never serializes request bodies or secrets."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any


_FIELDS = (
    "event",
    "request_id",
    "method",
    "endpoint",
    "status",
    "duration_ms",
    "reason",
    "model_version",
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        document: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
        }
        for field in _FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                document[field] = value
        if record.exc_info:
            document["exceptionType"] = record.exc_info[0].__name__
        return json.dumps(document, separators=(",", ":"), ensure_ascii=True)


def configure_logging(level: str) -> logging.Logger:
    logger = logging.getLogger("crop_ai_service")
    logger.setLevel(getattr(logging, level, logging.INFO))
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
    return logger
