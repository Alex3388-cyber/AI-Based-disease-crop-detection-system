from __future__ import annotations

import copy

import pytest

from app.model_runtime import (
    validate_bundle_manifest,
    validate_class_names,
    validate_metadata,
    validate_training_history,
)

from .helpers import metadata, training_history


def test_class_order_is_preserved_exactly() -> None:
    labels = validate_class_names(["tomato_healthy", "maize_healthy"])

    assert labels == ("tomato_healthy", "maize_healthy")


@pytest.mark.parametrize(
    "document",
    [
        [],
        ["duplicate", "duplicate"],
        [" leading-space"],
        ["Tomato_healthy"],
        ["tomato-healthy"],
        [7],
    ],
)
def test_invalid_class_names_are_rejected(document) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError):
        validate_class_names(document)


def test_metadata_class_order_must_match_class_names() -> None:
    document = copy.deepcopy(metadata())
    document["classes"].reverse()

    with pytest.raises(ValueError, match="metadata_classes_mismatch"):
        validate_metadata(document, ("maize_healthy", "maize_leaf_blight"))


def test_metadata_rejects_unknown_preprocessing() -> None:
    document = copy.deepcopy(metadata())
    document["normalization"] = {"type": "arbitrary-code"}

    with pytest.raises(ValueError, match="metadata_normalization_unsupported"):
        validate_metadata(document, ("maize_healthy", "maize_leaf_blight"))


def test_metadata_rejects_non_ascii_release_identifier() -> None:
    document = copy.deepcopy(metadata())
    document["modelVersion"] = "rélease-1"

    with pytest.raises(ValueError, match="metadata_model_version_invalid"):
        validate_metadata(document, ("maize_healthy", "maize_leaf_blight"))


def test_metadata_requires_training_split_provenance() -> None:
    document = copy.deepcopy(metadata())
    document.pop("splitManifestSha256")

    with pytest.raises(ValueError, match="metadata_fields_missing"):
        validate_metadata(document, ("maize_healthy", "maize_leaf_blight"))


def test_metadata_rejects_logits_outside_supported_training_contract() -> None:
    document = copy.deepcopy(metadata())
    document["output"] = {"type": "logits"}

    with pytest.raises(ValueError, match="metadata_output_invalid"):
        validate_metadata(document, ("maize_healthy", "maize_leaf_blight"))


def test_training_history_is_measured_and_version_bound() -> None:
    document = training_history()

    assert validate_training_history(document, "test-1.0.0") == document
    document["modelVersion"] = "other-release"
    with pytest.raises(ValueError, match="training_history_version_mismatch"):
        validate_training_history(document, "test-1.0.0")


def test_bundle_manifest_accepts_required_hashes() -> None:
    document = {
        "schemaVersion": 1,
        "exportedAt": "2026-08-21T00:00:00+00:00",
        "modelVersion": "crop-v1",
        "files": {
            "best_model.keras": "a" * 64,
            "class_names.json": "b" * 64,
            "model_metadata.json": "c" * 64,
            "training_history.json": "d" * 64,
        },
    }

    assert validate_bundle_manifest(document) == document


@pytest.mark.parametrize(
    "mutation, expected",
    [
        (lambda value: value.update(schemaVersion=2), "bundle_manifest_schema_unsupported"),
        (
            lambda value: value["files"].pop("class_names.json"),
            "bundle_manifest_files_missing",
        ),
        (
            lambda value: value["files"].update({"best_model.keras": "not-a-digest"}),
            "bundle_manifest_hash_invalid",
        ),
    ],
)
def test_bundle_manifest_rejects_invalid_contract(mutation, expected) -> None:  # type: ignore[no-untyped-def]
    document = {
        "schemaVersion": 1,
        "exportedAt": "2026-08-21T00:00:00+00:00",
        "modelVersion": "crop-v1",
        "files": {
            "best_model.keras": "a" * 64,
            "class_names.json": "b" * 64,
            "model_metadata.json": "c" * 64,
            "training_history.json": "d" * 64,
        },
    }
    mutation(document)

    with pytest.raises(ValueError, match=expected):
        validate_bundle_manifest(document)
