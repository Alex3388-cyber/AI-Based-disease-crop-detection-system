"""Create reproducible, class-aware splits with content-hash leakage prevention."""

from __future__ import annotations

import argparse
import csv
import hashlib
import random
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from common.io_utils import canonical_json_sha256, read_json, write_json_atomic


SPLITS = ("train", "validation", "test")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--train", type=float, default=0.70)
    parser.add_argument("--validation", type=float, default=0.15)
    parser.add_argument("--test", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument(
        "--keep-duplicates",
        action="store_true",
        help="Keep exact duplicates, but force every hash group into one split.",
    )
    return parser.parse_args()


def target_counts(total: int, ratios: tuple[float, float, float]) -> dict[str, int]:
    raw = [total * ratio for ratio in ratios]
    counts = [int(value) for value in raw]
    remainder = total - sum(counts)
    order = sorted(range(3), key=lambda index: (raw[index] - counts[index], -index), reverse=True)
    for index in order[:remainder]:
        counts[index] += 1
    # When possible, make each requested holdout non-empty for every class.
    if total >= sum(ratio > 0 for ratio in ratios):
        for index, ratio in enumerate(ratios):
            if ratio > 0 and counts[index] == 0:
                donor = max(range(3), key=lambda candidate: counts[candidate])
                counts[donor] -= 1
                counts[index] += 1
    return dict(zip(SPLITS, counts, strict=True))


def build_manifest(args: argparse.Namespace) -> dict[str, Any]:
    inventory = read_json(args.inventory)
    if not isinstance(inventory, dict) or inventory.get("schemaVersion") != 1:
        raise ValueError("Unsupported inventory schema")
    records = inventory.get("records")
    if not isinstance(records, list):
        raise ValueError("Inventory records are missing")
    valid = [record for record in records if record.get("status") == "valid"]
    if not valid:
        raise ValueError("Inventory has no valid images")

    hashes: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in valid:
        if not isinstance(record.get("sha256"), str) or len(record["sha256"]) != 64:
            raise ValueError("Inventory contains an invalid SHA-256 value")
        hashes[record["sha256"]].append(record)
    conflicts = [
        digest
        for digest, group in hashes.items()
        if len({record["label"] for record in group}) > 1
    ]
    if conflicts:
        raise ValueError(
            "Exact duplicate content has conflicting labels; resolve it before splitting"
        )

    groups_by_class: dict[str, list[list[dict[str, Any]]]] = defaultdict(list)
    excluded_duplicates: list[str] = []
    for group in hashes.values():
        ordered = sorted(group, key=lambda record: record["path"])
        if not args.keep_duplicates:
            excluded_duplicates.extend(record["path"] for record in ordered[1:])
            ordered = ordered[:1]
        groups_by_class[ordered[0]["label"]].append(ordered)

    ratios = (args.train, args.validation, args.test)
    output: dict[str, list[dict[str, str]]] = {name: [] for name in SPLITS}
    notes: list[str] = []
    for label in sorted(groups_by_class):
        groups = groups_by_class[label]
        stable_seed = int.from_bytes(
            hashlib.sha256(f"{args.seed}:{label}".encode()).digest()[:8], "big"
        )
        random.Random(stable_seed).shuffle(groups)
        groups.sort(key=len, reverse=True)
        total = sum(len(group) for group in groups)
        targets = target_counts(total, ratios)
        current = Counter()
        for group in groups:
            split = max(
                SPLITS,
                key=lambda name: (
                    targets[name] - current[name],
                    -SPLITS.index(name),
                ),
            )
            for record in group:
                output[split].append(
                    {
                        "path": record["path"],
                        "label": record["label"],
                        "sha256": record["sha256"],
                    }
                )
            current[split] += len(group)
        if total < 3:
            notes.append(
                f"Class {label!r} has fewer than three unique images; not every split can contain it."
            )

    for entries in output.values():
        entries.sort(key=lambda entry: entry["path"])
    owners: dict[str, set[str]] = defaultdict(set)
    for split, entries in output.items():
        for entry in entries:
            owners[entry["sha256"]].add(split)
    if any(len(splits) > 1 for splits in owners.values()):
        raise AssertionError("Internal error: a content hash leaked between splits")

    distribution = {
        split: dict(sorted(Counter(entry["label"] for entry in entries).items()))
        for split, entries in output.items()
    }
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "dataset": inventory.get("dataset", {}),
        "sourceInventorySha256": canonical_json_sha256(inventory),
        "seed": args.seed,
        "ratios": dict(zip(SPLITS, ratios, strict=True)),
        "duplicatePolicy": "keep_grouped" if args.keep_duplicates else "deduplicate",
        "excludedDuplicatePaths": sorted(excluded_duplicates),
        "classNames": sorted(groups_by_class),
        "distribution": distribution,
        "notes": notes,
        "splits": output,
    }


def main() -> None:
    args = parse_args()
    ratios = (args.train, args.validation, args.test)
    if any(ratio < 0 for ratio in ratios) or abs(sum(ratios) - 1.0) > 1e-9:
        raise SystemExit("Train, validation, and test ratios must be non-negative and sum to 1")
    if args.train <= 0 or args.validation <= 0:
        raise SystemExit("Training and validation ratios must be greater than zero")
    manifest = build_manifest(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(args.output, manifest)
    csv_path = args.output.with_suffix(".csv")
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["split", "path", "label", "sha256"])
        writer.writeheader()
        for split in SPLITS:
            for entry in manifest["splits"][split]:
                writer.writerow({"split": split, **entry})
    counts = {name: len(manifest["splits"][name]) for name in SPLITS}
    print(f"Wrote leakage-safe split manifest to {args.output}: {counts}")


if __name__ == "__main__":
    main()
