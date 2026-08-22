from __future__ import annotations

import io
import struct

import numpy as np
import pytest

from app import create_app

from .helpers import ReadyRuntime, SECRET, app_config


cv2 = pytest.importorskip("cv2")


def encode_image(extension: str, bgr: np.ndarray | None = None) -> bytes:
    image = bgr if bgr is not None else np.full((24, 32, 3), 127, np.uint8)
    supported, encoded = cv2.imencode(extension, image)
    if not supported:
        pytest.skip(f"this OpenCV build cannot encode {extension}")
    return encoded.tobytes()


def post_image(client, data: bytes, filename: str, mimetype: str):  # type: ignore[no-untyped-def]
    return client.post(
        "/predict",
        headers={"X-Service-Secret": SECRET},
        data={"image": (io.BytesIO(data), filename, mimetype)},
    )


@pytest.mark.parametrize(
    ("extension", "filename", "mimetype"),
    [
        (".jpg", "leaf.jpg", "image/jpeg"),
        (".png", "leaf.png", "image/png"),
        (".webp", "leaf.webp", "image/webp"),
    ],
)
def test_supported_formats_and_prediction_schema(
    extension: str, filename: str, mimetype: str
) -> None:
    runtime = ReadyRuntime()
    client = create_app(app_config(), runtime=runtime).test_client()

    response = post_image(client, encode_image(extension), filename, mimetype)

    assert response.status_code == 200
    body = response.get_json()
    assert set(body) == {"modelLabel", "confidence", "modelVersion", "uncertain"}
    assert isinstance(body["modelLabel"], str)
    assert isinstance(body["confidence"], float)
    assert 0.0 <= body["confidence"] <= 1.0
    assert isinstance(body["modelVersion"], str)
    assert isinstance(body["uncertain"], bool)


def test_preprocessing_is_bgr_to_rgb_resized_and_normalized() -> None:
    bgr = np.empty((16, 16, 3), dtype=np.uint8)
    bgr[:, :] = [10, 20, 30]
    runtime = ReadyRuntime()
    client = create_app(app_config(), runtime=runtime).test_client()

    response = post_image(client, encode_image(".png", bgr), "leaf.png", "image/png")

    assert response.status_code == 200
    assert runtime.last_batch is not None
    assert runtime.last_batch.shape == (1, 16, 16, 3)
    assert runtime.last_batch.dtype == np.float32
    np.testing.assert_allclose(
        runtime.last_batch[0, 0, 0],
        np.array([30, 20, 10], dtype=np.float32) / 255.0,
        rtol=0,
        atol=1e-6,
    )


def test_plain_text_with_jpeg_name_and_mime_is_rejected() -> None:
    client = create_app(app_config(), runtime=ReadyRuntime()).test_client()

    response = post_image(client, b"this is not an image", "leaf.jpg", "image/jpeg")

    assert response.status_code == 415
    assert response.get_json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"


def test_jpeg_signature_with_malformed_content_is_rejected() -> None:
    client = create_app(app_config(), runtime=ReadyRuntime()).test_client()

    response = post_image(client, b"\xff\xd8\xffmalformed", "leaf.jpg", "image/jpeg")

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "INVALID_IMAGE_CONTENT"


@pytest.mark.parametrize(
    ("filename", "mimetype"),
    [
        ("leaf.jpg.php", "image/png"),
        ("../leaf.png", "image/png"),
        ("leaf.png", "text/plain"),
        ("leaf.jpg", "image/jpeg"),
    ],
)
def test_filename_mime_and_content_spoofing_is_rejected(
    filename: str, mimetype: str
) -> None:
    client = create_app(app_config(), runtime=ReadyRuntime()).test_client()
    png = encode_image(".png")

    response = post_image(client, png, filename, mimetype)

    assert response.status_code == 415
    assert response.get_json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"


def test_exact_byte_limit_is_enforced_on_file_content() -> None:
    png = encode_image(".png")
    client = create_app(
        app_config(MAX_IMAGE_BYTES=len(png) - 1), runtime=ReadyRuntime()
    ).test_client()

    response = post_image(client, png, "leaf.png", "image/png")

    assert response.status_code == 413
    assert response.get_json()["error"]["code"] == "FILE_TOO_LARGE"


def test_unsafe_dimensions_are_rejected_before_decode() -> None:
    # A syntactically recognizable PNG header with a huge canvas. No decoder is
    # reached because dimensions are checked first.
    header = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR"
    header += struct.pack(">II", 100_000, 100_000) + b"\x08\x02\x00\x00\x00"
    client = create_app(app_config(), runtime=ReadyRuntime()).test_client()

    response = post_image(client, header, "leaf.png", "image/png")

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "INVALID_IMAGE_CONTENT"


def test_extra_file_or_form_fields_are_rejected() -> None:
    client = create_app(app_config(), runtime=ReadyRuntime()).test_client()
    png = encode_image(".png")

    response = client.post(
        "/predict",
        headers={"X-Service-Secret": SECRET},
        data={
            "image": (io.BytesIO(png), "leaf.png", "image/png"),
            "note": "unexpected",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "INVALID_IMAGE"


def test_invalid_runtime_response_schema_is_rejected() -> None:
    runtime = ReadyRuntime(
        {
            "modelLabel": "maize_healthy",
            "confidence": 0.9,
            "modelVersion": "test-1.0.0",
            "uncertain": False,
            "unexpected": "field",
        }
    )
    client = create_app(app_config(), runtime=runtime).test_client()

    response = post_image(client, encode_image(".png"), "leaf.png", "image/png")

    assert response.status_code == 500
    assert response.get_json()["error"]["code"] == "PREDICTION_FAILED"
