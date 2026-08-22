"""The training/evaluation side of the exact OpenCV inference pipeline."""

from __future__ import annotations

import importlib
import struct
from pathlib import Path
from typing import Any, Mapping

import numpy as np

from . import PIPELINE_VERSION


_SIGNATURES = {
    "jpeg": lambda data: len(data) >= 3 and data[:3] == b"\xff\xd8\xff",
    "png": lambda data: len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n",
    "webp": lambda data: len(data) >= 12
    and data[:4] == b"RIFF"
    and data[8:12] == b"WEBP",
}
_EXPECTED_EXTENSIONS = {
    "jpeg": {".jpg", ".jpeg"},
    "png": {".png"},
    "webp": {".webp"},
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
        raise RuntimeError("OpenCV is required for dataset processing") from exc


def detect_format(data: bytes) -> str:
    for name, matches in _SIGNATURES.items():
        if matches(data):
            return name
    raise ValueError("unsupported_signature")


def encoded_dimensions(data: bytes, image_format: str) -> tuple[int, int]:
    if image_format == "png":
        if len(data) < 24 or data[12:16] != b"IHDR":
            raise ValueError("invalid_png_header")
        return struct.unpack(">II", data[16:24])
    if image_format == "webp":
        if len(data) < 20:
            raise ValueError("truncated_webp")
        chunk = data[12:16]
        if chunk == b"VP8X":
            if len(data) < 30:
                raise ValueError("truncated_vp8x")
            return (
                1 + int.from_bytes(data[24:27], "little"),
                1 + int.from_bytes(data[27:30], "little"),
            )
        if chunk == b"VP8 ":
            if len(data) < 30:
                raise ValueError("truncated_vp8")
            if data[23:26] != b"\x9d\x01\x2a":
                raise ValueError("invalid_vp8_frame")
            return (
                int.from_bytes(data[26:28], "little") & 0x3FFF,
                int.from_bytes(data[28:30], "little") & 0x3FFF,
            )
        if chunk == b"VP8L" and len(data) >= 25 and data[20] == 0x2F:
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        raise ValueError("unsupported_webp_layout")

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
        length = int.from_bytes(data[position : position + 2], "big")
        if length < 2 or position + length > len(data):
            raise ValueError("invalid_jpeg_segment")
        if marker in sof_markers:
            if length < 7:
                raise ValueError("invalid_jpeg_sof")
            return (
                int.from_bytes(data[position + 5 : position + 7], "big"),
                int.from_bytes(data[position + 3 : position + 5], "big"),
            )
        position += length
    raise ValueError("jpeg_dimensions_not_found")


def decode_bgr_bytes(
    data: bytes,
    *,
    extension: str | None = None,
    max_width: int = 8192,
    max_height: int = 8192,
    max_pixels: int = 40_000_000,
) -> tuple[np.ndarray, str]:
    image_format = detect_format(data)
    if extension is not None and extension.lower() not in _EXPECTED_EXTENSIONS[image_format]:
        raise ValueError("extension_content_mismatch")
    width, height = encoded_dimensions(data, image_format)
    if width <= 0 or height <= 0:
        raise ValueError("invalid_dimensions")
    if width > max_width or height > max_height or width * height > max_pixels:
        raise ValueError("unsafe_dimensions")

    cv2 = _cv2()
    flags = int(cv2.IMREAD_COLOR)
    if hasattr(cv2, "IMREAD_IGNORE_ORIENTATION"):
        flags |= int(cv2.IMREAD_IGNORE_ORIENTATION)
    image = cv2.imdecode(np.frombuffer(data, np.uint8), flags)
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("opencv_decode_failed")
    decoded_height, decoded_width = image.shape[:2]
    if (decoded_width, decoded_height) != (width, height):
        raise ValueError("dimension_mismatch")
    return image, image_format


def decode_bgr_file(path: Path, **limits: int) -> tuple[np.ndarray, str]:
    return decode_bgr_bytes(path.read_bytes(), extension=path.suffix, **limits)


def preprocess_bgr(image: np.ndarray, metadata: Mapping[str, Any]) -> np.ndarray:
    if metadata.get("pipelineVersion") != PIPELINE_VERSION:
        raise ValueError("unsupported_pipeline_version")
    if image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("expected_uint8_bgr")
    if metadata.get("colorSpace") != "RGB" or metadata.get("dtype") != "float32":
        raise ValueError("unsupported_input_metadata")

    cv2 = _cv2()
    try:
        interpolation = getattr(
            cv2, _INTERPOLATIONS[str(metadata["resizeInterpolation"])]
        )
    except (KeyError, AttributeError) as exc:
        raise ValueError("unsupported_resize_interpolation") from exc
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(
        rgb,
        (int(metadata["imageWidth"]), int(metadata["imageHeight"])),
        interpolation=interpolation,
    )
    normalization = metadata["normalization"]
    if normalization.get("type") != "rescale":
        raise ValueError("unsupported_normalization")
    result = resized.astype(np.float32, copy=False)
    result = result * np.float32(normalization["scale"])
    result = result + np.float32(normalization["offset"])
    if not np.isfinite(result).all():
        raise ValueError("non_finite_preprocessing_output")
    return np.ascontiguousarray(result, dtype=np.float32)


def load_preprocessed(path: Path, metadata: Mapping[str, Any]) -> np.ndarray:
    image, _format = decode_bgr_file(path)
    return preprocess_bgr(image, metadata)
