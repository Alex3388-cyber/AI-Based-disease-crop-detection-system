from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Callable

import numpy as np
import pytest

import app.model_runtime as runtime_module
from app.model_runtime import ModelRuntime

from .helpers import metadata, training_history


class FakeModel:
    input_shape = (None, 16, 16, 3)
    output_shape = (None, 2)

    def __init__(
        self,
        *,
        dtype: str = "float32",
        outputs: list[np.ndarray] | None = None,
        on_predict: Callable[[], None] | None = None,
    ) -> None:
        self.inputs = [SimpleNamespace(dtype=SimpleNamespace(name=dtype))]
        self._outputs = outputs or [np.array([[0.5, 0.5]], dtype=np.float32)]
        self._on_predict = on_predict
        self._calls = 0

    def predict(self, _batch: np.ndarray, *, verbose: int) -> np.ndarray:
        assert verbose == 0
        if self._on_predict is not None:
            self._on_predict()
        output = self._outputs[min(self._calls, len(self._outputs) - 1)]
        self._calls += 1
        return output


def write_bundle(directory: Path) -> dict[str, Path]:
    paths = {
        "best_model.keras": directory / "best_model.keras",
        "class_names.json": directory / "class_names.json",
        "model_metadata.json": directory / "model_metadata.json",
        "training_history.json": directory / "training_history.json",
    }
    paths["best_model.keras"].write_bytes(b"safe-keras-placeholder")
    paths["class_names.json"].write_text(
        json.dumps(["maize_healthy", "maize_leaf_blight"]), encoding="utf-8"
    )
    paths["model_metadata.json"].write_text(json.dumps(metadata()), encoding="utf-8")
    paths["training_history.json"].write_text(
        json.dumps(training_history()), encoding="utf-8"
    )
    manifest = {
        "schemaVersion": 1,
        "exportedAt": "2026-08-21T00:00:00+00:00",
        "modelVersion": "test-1.0.0",
        "files": {
            name: hashlib.sha256(path.read_bytes()).hexdigest()
            for name, path in paths.items()
        },
    }
    manifest_path = directory / "bundle_manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    paths["bundle_manifest.json"] = manifest_path
    return paths


def make_runtime(paths: dict[str, Path]) -> ModelRuntime:
    return ModelRuntime(
        model_path=paths["best_model.keras"],
        class_names_path=paths["class_names.json"],
        metadata_path=paths["model_metadata.json"],
        training_history_path=paths["training_history.json"],
        bundle_manifest_path=paths["bundle_manifest.json"],
        max_model_bytes=1024,
        retry_seconds=0,
        threshold_override=None,
        logger=logging.getLogger("model-runtime-test"),
    )


def install_fake_tensorflow(monkeypatch: pytest.MonkeyPatch, model: FakeModel) -> None:
    fake_tensorflow = SimpleNamespace(
        keras=SimpleNamespace(
            models=SimpleNamespace(
                load_model=lambda _path, *, compile, safe_mode: model
                if compile is False and safe_mode is True
                else None
            )
        )
    )
    monkeypatch.setattr(
        runtime_module.importlib,
        "import_module",
        lambda name: fake_tensorflow if name == "tensorflow" else None,
    )


def test_loader_accepts_only_a_coherent_hash_verified_bundle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = write_bundle(tmp_path)
    install_fake_tensorflow(monkeypatch, FakeModel())
    runtime = make_runtime(paths)

    assert runtime.ensure_loaded() is True
    assert runtime.readiness()["ready"] is True


def test_loader_rejects_model_input_dtype_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = write_bundle(tmp_path)
    install_fake_tensorflow(monkeypatch, FakeModel(dtype="uint8"))

    with pytest.raises(ValueError, match="model_input_dtype_mismatch"):
        make_runtime(paths)._load()


def test_loader_rejects_failed_smoke_inference(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = write_bundle(tmp_path)
    invalid = np.array([[np.nan, 0.5]], dtype=np.float32)
    install_fake_tensorflow(monkeypatch, FakeModel(outputs=[invalid]))

    with pytest.raises(ValueError, match="model_smoke_inference_failed"):
        make_runtime(paths)._load()


def test_loader_rejects_artifact_changed_during_deserialization(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = write_bundle(tmp_path)
    model = FakeModel(
        on_predict=lambda: paths["model_metadata.json"].write_text(
            json.dumps({**metadata(), "datasetVersion": "changed"}), encoding="utf-8"
        )
    )
    install_fake_tensorflow(monkeypatch, model)

    with pytest.raises(ValueError, match="bundle_changed_during_load"):
        make_runtime(paths)._load()


def test_tolerated_probability_roundoff_is_bounded_before_response(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = write_bundle(tmp_path)
    outputs = [
        np.array([[0.5, 0.5]], dtype=np.float32),
        np.array([[-0.0000005, 1.0000005]], dtype=np.float64),
    ]
    install_fake_tensorflow(monkeypatch, FakeModel(outputs=outputs))
    runtime = make_runtime(paths)
    assert runtime.ensure_loaded() is True

    result = runtime.predict(np.zeros((1, 16, 16, 3), dtype=np.float32))

    assert 0.0 <= result["confidence"] <= 1.0
    assert result["confidence"] == 1.0
