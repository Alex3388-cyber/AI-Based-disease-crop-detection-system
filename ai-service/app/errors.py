"""Sanitized API errors and Flask error handlers."""

from __future__ import annotations

from dataclasses import dataclass

from flask import Flask, g, jsonify
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge


@dataclass(slots=True)
class ApiError(Exception):
    code: str
    message: str
    status: int


def error_payload(code: str, message: str):  # type: ignore[no-untyped-def]
    return jsonify(
        {
            "error": {"code": code, "message": message},
            "requestId": g.get("request_id", ""),
        }
    )


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def handle_api_error(error: ApiError):  # type: ignore[no-untyped-def]
        return error_payload(error.code, error.message), error.status

    @app.errorhandler(RequestEntityTooLarge)
    def handle_too_large(_error: RequestEntityTooLarge):  # type: ignore[no-untyped-def]
        return error_payload(
            "FILE_TOO_LARGE", "The uploaded image exceeds the 8 MB limit."
        ), 413

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):  # type: ignore[no-untyped-def]
        mapping = {
            400: ("INVALID_REQUEST", "The request could not be processed."),
            404: ("NOT_FOUND", "The requested endpoint was not found."),
            405: ("METHOD_NOT_ALLOWED", "The HTTP method is not allowed."),
            415: ("UNSUPPORTED_FILE_TYPE", "The request media type is unsupported."),
        }
        code, message = mapping.get(
            error.code or 500, ("INTERNAL_ERROR", "An internal error occurred.")
        )
        return error_payload(code, message), error.code or 500

    @app.errorhandler(Exception)
    def handle_unexpected(error: Exception):  # type: ignore[no-untyped-def]
        app.extensions["service_logger"].exception(
            "unhandled_exception",
            extra={
                "event": "unhandled_exception",
                "request_id": g.get("request_id"),
                "reason": type(error).__name__,
            },
        )
        return error_payload(
            "INTERNAL_ERROR", "An unexpected internal error occurred."
        ), 500
