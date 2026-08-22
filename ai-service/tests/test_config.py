from __future__ import annotations

from app.config import default_config


def test_native_image_defaults_match_browser_and_node_contract(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    for name in (
        "MIN_IMAGE_DIMENSION",
        "MAX_IMAGE_WIDTH",
        "MAX_IMAGE_HEIGHT",
        "MAX_IMAGE_PIXELS",
    ):
        monkeypatch.delenv(name, raising=False)

    config = default_config()

    assert config["MIN_IMAGE_DIMENSION"] == 32
    assert config["MAX_IMAGE_WIDTH"] == 8192
    assert config["MAX_IMAGE_HEIGHT"] == 8192
    assert config["MAX_IMAGE_PIXELS"] == 25_000_000
