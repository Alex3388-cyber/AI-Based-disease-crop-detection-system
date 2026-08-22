"""Validate, stage, and publish a hash-manifested inference bundle."""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from common.artifact_bundle import (
    ARTIFACT_FILES,
    MAX_JSON_BYTES,
    snapshot_artifacts,
    validate_model_documents,
)
from common.io_utils import read_json, sha256_file, write_json_atomic


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    source = args.artifacts.resolve(strict=True)
    destination = args.destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".export-", dir=destination))
    try:
        try:
            source_manifest = snapshot_artifacts(source, staging)
            classes = read_json(
                staging / "class_names.json", maximum_bytes=MAX_JSON_BYTES
            )
            metadata = read_json(
                staging / "model_metadata.json", maximum_bytes=MAX_JSON_BYTES
            )
            history = read_json(
                staging / "training_history.json", maximum_bytes=MAX_JSON_BYTES
            )
            _classes, metadata, _history = validate_model_documents(
                classes, metadata, history
            )
        except ValueError as exc:
            raise SystemExit(f"Training artifact snapshot failed: {exc}") from exc
        if metadata["modelVersion"] != source_manifest["modelVersion"]:
            raise SystemExit("Training artifact versions do not match")

        bundle = {
            "schemaVersion": 1,
            "exportedAt": datetime.now(UTC).isoformat(),
            "modelVersion": metadata["modelVersion"],
            "files": {
                name: sha256_file(staging / name) for name in ARTIFACT_FILES
            },
        }
        write_json_atomic(staging / "bundle_manifest.json", bundle)
        # Publish the manifest last. Flask verifies declared hashes both before
        # and after deserialization, so a partial replacement is never ready.
        for name in (*ARTIFACT_FILES, "bundle_manifest.json"):
            os.replace(staging / name, destination / name)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    print(f"Validated model bundle exported to {destination}")


if __name__ == "__main__":
    main()
