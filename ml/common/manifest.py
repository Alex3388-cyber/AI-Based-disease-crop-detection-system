from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import shutil
from typing import Any

from .io_utils import read_json, sha256_file


CLASS_LABEL = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")


def load_split_manifest(path: Path) -> dict[str, Any]:
    document = read_json(path)
    if not isinstance(document, dict) or document.get("schemaVersion") != 1:
        raise ValueError("Unsupported split manifest schema")
    classes = document.get("classNames")
    splits = document.get("splits")
    if (
        not isinstance(classes, list)
        or not classes
        or any(
            not isinstance(label, str)
            or len(label) > 191
            or CLASS_LABEL.fullmatch(label) is None
            for label in classes
        )
        or len(set(classes)) != len(classes)
        or not isinstance(splits, dict)
        or set(splits) != {"train", "validation", "test"}
    ):
        raise ValueError("Invalid split manifest")
    seen_paths: set[str] = set()
    for split in ("train", "validation", "test"):
        entries = splits.get(split)
        if not isinstance(entries, list):
            raise ValueError(f"Missing split: {split}")
        for entry in entries:
            if (
                not isinstance(entry, dict)
                or not isinstance(entry.get("path"), str)
                or entry.get("label") not in classes
                or not isinstance(entry.get("sha256"), str)
                or SHA256.fullmatch(entry["sha256"]) is None
            ):
                raise ValueError(f"Invalid entry in {split} split")
            if entry["path"] in seen_paths:
                raise ValueError("A dataset path appears more than once in the split manifest")
            seen_paths.add(entry["path"])
    hash_splits: dict[str, set[str]] = {}
    for split, entries in splits.items():
        for entry in entries:
            hash_splits.setdefault(entry["sha256"], set()).add(split)
    if any(len(owners) > 1 for owners in hash_splits.values()):
        raise ValueError("Content leakage detected between splits")
    return document


def resolve_entry(dataset_root: Path, relative_path: str) -> Path:
    root = dataset_root.resolve(strict=True)
    candidate = (root / Path(relative_path)).resolve(strict=True)
    if not candidate.is_file() or root not in candidate.parents:
        raise ValueError(f"Unsafe or missing dataset path: {relative_path}")
    return candidate


def verify_manifest_files(
    manifest: dict[str, Any], dataset_root: Path, verify_hashes: bool
) -> None:
    for split in ("train", "validation", "test"):
        for entry in manifest["splits"][split]:
            path = resolve_entry(dataset_root, entry["path"])
            if verify_hashes and sha256_file(path) != entry["sha256"]:
                raise ValueError(f"Dataset file changed after inspection: {entry['path']}")


def snapshot_manifest_splits(
    manifest: dict[str, Any],
    source_root: Path,
    snapshot_root: Path,
    *,
    splits: tuple[str, ...],
) -> None:
    """Copy selected splits into a new hash-verified private working tree."""

    allowed_splits = ("train", "validation", "test")
    if (
        not splits
        or len(set(splits)) != len(splits)
        or any(split not in allowed_splits for split in splits)
    ):
        raise ValueError("Invalid dataset snapshot split selection")

    snapshot_root.mkdir(parents=True, mode=0o700, exist_ok=False)
    destination_root = snapshot_root.resolve(strict=True)
    for split in splits:
        for entry in manifest["splits"][split]:
            source = resolve_entry(source_root, entry["path"])
            target = (destination_root / Path(entry["path"])).resolve()
            if destination_root not in target.parents:
                raise ValueError(f"Unsafe dataset snapshot path: {entry['path']}")
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                # Exclusive creation also catches distinct manifest paths that
                # alias the same destination on a case-insensitive filesystem.
                with source.open("rb") as source_handle, target.open("xb") as target_handle:
                    shutil.copyfileobj(source_handle, target_handle)
            except OSError as exc:
                raise ValueError(
                    f"Dataset snapshot copy failed: {entry['path']}"
                ) from exc
            if sha256_file(target) != entry["sha256"]:
                raise ValueError(
                    f"Dataset file changed during snapshot: {entry['path']}"
                )


def class_weights(entries: list[dict[str, str]], classes: list[str]) -> dict[int, float]:
    counts = Counter(entry["label"] for entry in entries)
    if any(counts[name] == 0 for name in classes):
        raise ValueError("Every class must have a training sample")
    total = len(entries)
    return {index: total / (len(classes) * counts[name]) for index, name in enumerate(classes)}
