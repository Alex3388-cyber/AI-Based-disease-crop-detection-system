"""Content-based image validation and deterministic OpenCV preprocessing."""

from __future__ import annotations

import importlib
import struct
from pathlib import PurePath
from typing import Any, BinaryIO, Mapping

import numpy as np

from .errors import ApiError


JPEG = "jpeg"
PNG = "png"
WEBP = "webp"
_EXTENSIONS = {JPEG: {".jpg", ".jpeg"}, PNG: {".png"}, WEBP: {".webp"}}
_MIME_TYPES = {
    JPEG: {"image/jpeg", "image/jpg"},
    PNG: {"image/png"},
    WEBP: {"image/webp"},
}
_INTERPOLATIONS = {
    "nearest": "INTER_NEAREST",
    "bilinear": "INTER_LINEAR",
    "bicubic": "INTER_CUBIC",
    "area": "INTER_AREA",
    "lanczos4": "INTER_LANCZOS4",
}


def _cv2():  # type: ignore[no-untyped-def]
    try:
        return importlib.import_module("cv2")
    except ImportError as exc:
        raise RuntimeError("OpenCV is unavailable") from exc


def read_limited(stream: BinaryIO, maximum_bytes: int) -> bytes:
    """Read at most maximum_bytes + 1 without trusting multipart metadata."""

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = stream.read(min(64 * 1024, maximum_bytes + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > maximum_bytes:
            raise ApiError(
                "FILE_TOO_LARGE", "The uploaded image exceeds the 8 MB limit.", 413
            )
    if total == 0:
        raise ApiError("INVALID_IMAGE", "An image file is required.", 400)
    return b"".join(chunks)


def detect_format(data: bytes) -> str:
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return JPEG
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return PNG
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return WEBP
    raise ApiError(
        "UNSUPPORTED_FILE_TYPE",
        "Only genuine JPEG, PNG, and WEBP images are supported.",
        415,
    )


def _validate_filename(filename: str, detected_format: str) -> None:
    if (
        not filename
        or "\x00" in filename
        or "/" in filename
        or "\\" in filename
        or PurePath(filename).suffix.lower() not in _EXTENSIONS[detected_format]
    ):
        raise ApiError(
            "UNSUPPORTED_FILE_TYPE", "The image filename is not supported.", 415
        )


def _validate_declared_type(mimetype: str, detected_format: str) -> None:
    if mimetype.lower() not in _MIME_TYPES[detected_format]:
        raise ApiError(
            "UNSUPPORTED_FILE_TYPE",
            "The declared image type does not match its content.",
            415,
        )


def _png_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or data[12:16] != b"IHDR":
        raise ValueError("invalid PNG header")
    return struct.unpack(">II", data[16:24])


def _jpeg_dimensions(data: bytes) -> tuple[int, int]:
    # Parse bounded JPEG marker segments until a Start Of Frame marker appears.
    sof_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    position = 2
    while position < len(data):
        if data[position] != 0xFF:
            position += 1
            continue
        while position < len(data) and data[position] == 0xFF:
            position += 1
        if position >= len(data):
            break
        marker = data[position]
        position += 1
        if marker in {0x01, *range(0xD0, 0xDA)}:
            continue
        if marker in {0xD9, 0xDA} or position + 2 > len(data):
            break
        segment_length = int.from_bytes(data[position : position + 2], "big")
        if segment_length < 2 or position + segment_length > len(data):
            raise ValueError("invalid JPEG segment")
        if marker in sof_markers:
            if segment_length < 7:
                raise ValueError("invalid JPEG SOF")
            height = int.from_bytes(data[position + 3 : position + 5], "big")
            width = int.from_bytes(data[position + 5 : position + 7], "big")
            return width, height
        position += segment_length
    raise ValueError("JPEG dimensions not found")


def _webp_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 20:
        raise ValueError("truncated WEBP")
    chunk = data[12:16]
    if chunk == b"VP8X":
        if len(data) < 30:
            raise ValueError("truncated VP8X")
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height
    if chunk == b"VP8 ":
        if len(data) < 30:
            raise ValueError("truncated VP8")
        if data[23:26] != b"\x9d\x01\x2a":
            raise ValueError("invalid VP8 frame")
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
        return width, height
    if chunk == b"VP8L":
        if len(data) < 25 or data[20] != 0x2F:
            raise ValueError("invalid VP8L frame")
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    raise ValueError("unsupported WEBP layout")


def encoded_dimensions(data: bytes, detected_format: str) -> tuple[int, int]:
    try:
        if detected_format == PNG:
            return _png_dimensions(data)
        if detected_format == JPEG:
            return _jpeg_dimensions(data)
        return _webp_dimensions(data)
    except (IndexError, struct.error, ValueError) as exc:
        raise ApiError(
            "INVALID_IMAGE_CONTENT", "The image is malformed or incomplete.", 400
        ) from exc


def validate_dimensions(width: int, height: int, config: Mapping[str, Any]) -> None:
    minimum = int(config["MIN_IMAGE_DIMENSION"])
    if width < minimum or height < minimum:
        raise ApiError(
            "INVALID_IMAGE_CONTENT", "The image dimensions are too small.", 400
        )
    if (
        width > int(config["MAX_IMAGE_WIDTH"])
        or height > int(config["MAX_IMAGE_HEIGHT"])
        or width * height > int(config["MAX_IMAGE_PIXELS"])
    ):
        raise ApiError(
            "INVALID_IMAGE_CONTENT", "The image dimensions exceed safe limits.", 400
        )


def validate_and_decode(
    data: bytes, *, filename: str, mimetype: str, config: Mapping[str, Any]
) -> np.ndarray:
    """Validate independent signals, preflight dimensions, then decode in memory."""

    detected_format = detect_format(data)
    _validate_filename(filename, detected_format)
    _validate_declared_type(mimetype, detected_format)
    header_width, header_height = encoded_dimensions(data, detected_format)
    validate_dimensions(header_width, header_height, config)

    cv2 = _cv2()
    encoded = np.frombuffer(data, dtype=np.uint8)
    flags = int(cv2.IMREAD_COLOR)
    if hasattr(cv2, "IMREAD_IGNORE_ORIENTATION"):
        flags |= int(cv2.IMREAD_IGNORE_ORIENTATION)
    decoded = cv2.imdecode(encoded, flags)
    if decoded is None or decoded.ndim != 3 or decoded.shape[2] != 3:
        raise ApiError(
            "INVALID_IMAGE_CONTENT", "The image could not be safely decoded.", 400
        )
    decoded_height, decoded_width = decoded.shape[:2]
    validate_dimensions(decoded_width, decoded_height, config)
    if (decoded_width, decoded_height) != (header_width, header_height):
        raise ApiError(
            "INVALID_IMAGE_CONTENT", "The encoded image dimensions are inconsistent.", 400
        )
    return decoded


def preprocess_bgr(image: np.ndarray, metadata: Mapping[str, Any]) -> np.ndarray:
    """Apply the exact metadata-defined BGR -> RGB model input pipeline."""

    if metadata.get("pipelineVersion") != "opencv-bgr-rgb-rescale-v1":
        raise ValueError("unsupported preprocessing pipeline")
    if image.ndim != 3 or image.shape[2] != 3 or image.dtype != np.uint8:
        raise ValueError("preprocessing requires an uint8 BGR image")

    cv2 = _cv2()
    width = int(metadata["imageWidth"])
    height = int(metadata["imageHeight"])
    interpolation_name = str(metadata["resizeInterpolation"])
    try:
        interpolation = getattr(cv2, _INTERPOLATIONS[interpolation_name])
    except (KeyError, AttributeError) as exc:
        raise ValueError("unsupported resize interpolation") from exc

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (width, height), interpolation=interpolation)
    batch = resized.astype(np.float32, copy=False)

    normalization = metadata["normalization"]
    if normalization["type"] != "rescale":
        raise ValueError("unsupported normalization")
    batch = batch * np.float32(normalization["scale"])
    batch = batch + np.float32(normalization["offset"])
    if not np.isfinite(batch).all():
        raise ValueError("preprocessing produced non-finite values")
    return np.ascontiguousarray(batch[np.newaxis, ...], dtype=np.float32)
