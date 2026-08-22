from __future__ import annotations

import io
from pathlib import Path

import pytest

from app import create_app

from .helpers import MissingRuntime, ReadyRuntime, SECRET, app_config


def test_health_is_alive_even_when_model_is_missing() -> None:
    client = create_app(app_config(), runtime=MissingRuntime()).test_client()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.get_json() == {"status": "alive"}
    assert response.headers["Cache-Control"] == "no-store"


def test_ready_reports_model_not_ready_without_fake_prediction() -> None:
    client = create_app(app_config(), runtime=MissingRuntime()).test_client()

    response = client.get("/ready", headers={"X-Service-Secret": SECRET})

    assert response.status_code == 503
    assert response.get_json() == {"ready": False, "reason": "MODEL_NOT_READY"}


def test_real_runtime_stays_not_ready_when_artifacts_are_absent(tmp_path: Path) -> None:
    config = app_config(
        MODEL_PATH=str(tmp_path / "best_model.keras"),
        CLASS_NAMES_PATH=str(tmp_path / "class_names.json"),
        MODEL_METADATA_PATH=str(tmp_path / "model_metadata.json"),
    )
    client = create_app(config).test_client()

    assert client.get("/ready", headers={"X-Service-Secret": SECRET}).get_json() == {
        "ready": False,
        "reason": "MODEL_NOT_READY",
    }
    prediction = client.post(
        "/predict",
        headers={"X-Service-Secret": SECRET},
        data={"image": (io.BytesIO(b"not-used"), "leaf.jpg", "image/jpeg")},
    )
    assert prediction.status_code == 503
    assert prediction.get_json()["error"]["code"] == "MODEL_NOT_READY"


def test_predict_requires_shared_secret_without_revealing_which_case_failed() -> None:
    client = create_app(app_config(), runtime=ReadyRuntime()).test_client()
    upload = {"image": (io.BytesIO(b"ignored"), "leaf.jpg", "image/jpeg")}

    missing = client.post("/predict", data=upload)
    wrong = client.post(
        "/predict",
        headers={"X-Service-Secret": "wrong"},
        data={"image": (io.BytesIO(b"ignored"), "leaf.jpg", "image/jpeg")},
    )

    assert missing.status_code == wrong.status_code == 401
    assert missing.get_json()["error"] == wrong.get_json()["error"]
    assert missing.get_json()["error"]["code"] == "UNAUTHORIZED"


def test_ready_requires_the_same_service_secret_as_prediction() -> None:
    client = create_app(app_config(), runtime=ReadyRuntime()).test_client()

    missing = client.get("/ready")
    wrong = client.get("/ready", headers={"X-Service-Secret": "wrong"})

    assert missing.status_code == wrong.status_code == 401
    assert missing.get_json()["error"] == wrong.get_json()["error"]


@pytest.mark.parametrize(
    "secret",
    ["", "too-short", "CHANGE_ME_WITH_AT_LEAST_32_RANDOM_CHARACTERS"],
)
def test_non_testing_startup_rejects_weak_or_placeholder_secret(secret: str) -> None:
    with pytest.raises(RuntimeError, match="AI_SERVICE_SECRET"):
        create_app(
            app_config(TESTING=False, AI_SERVICE_SECRET=secret),
            runtime=ReadyRuntime(),
        )


def test_unconfigured_secret_fails_closed() -> None:
    client = create_app(
        app_config(AI_SERVICE_SECRET=""), runtime=ReadyRuntime()
    ).test_client()

    response = client.post("/predict")

    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "SERVICE_NOT_CONFIGURED"


def test_predict_rejects_non_multipart_body() -> None:
    client = create_app(app_config(), runtime=ReadyRuntime()).test_client()

    response = client.post(
        "/predict",
        headers={"X-Service-Secret": SECRET},
        json={"image": "not a multipart upload"},
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "INVALID_REQUEST"
