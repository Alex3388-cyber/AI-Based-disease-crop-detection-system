"""Inspect a class-folder dataset without modifying source images."""

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from common.image_pipeline import decode_bgr_bytes
from common.io_utils import sha256_file, write_json_atomic


CLASS_NAME = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate images, inventory classes, and find exact duplicates."
    )
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dataset-name", required=True)
    parser.add_argument("--dataset-version", required=True)
    parser.add_argument("--source", required=True, help="Dataset URL or source reference")
    parser.add_argument("--license", required=True, dest="dataset_license")
    parser.add_argument("--max-file-mb", type=int, default=32)
    parser.add_argument("--max-width", type=int, default=8192)
    parser.add_argument("--max-height", type=int, default=8192)
    parser.add_argument("--max-pixels", type=int, default=40_000_000)
    return parser.parse_args()


def inspect(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    root = args.dataset.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("--dataset must be a directory")
    class_dirs = sorted(
        (path for path in root.iterdir() if path.is_dir() and not path.name.startswith(".")),
        key=lambda path: path.name.casefold(),
    )
    if not class_dirs:
        raise ValueError("No class directories were found")
    invalid_classes = [
        path.name
        for path in class_dirs
        if len(path.name) > 191 or not CLASS_NAME.fullmatch(path.name)
    ]
    if invalid_classes:
        raise ValueError(
            "Class folders must use normalized crop_disease labels: "
            + ", ".join(invalid_classes)
        )

    records: list[dict[str, Any]] = []
    max_bytes = args.max_file_mb * 1024 * 1024
    for class_dir in class_dirs:
        files = sorted(
            (path for path in class_dir.rglob("*") if path.is_file()),
            key=lambda path: path.relative_to(root).as_posix().casefold(),
        )
        for path in files:
            relative = path.relative_to(root).as_posix()
            size = path.stat().st_size
            record: dict[str, Any] = {
                "path": relative,
                "label": class_dir.name,
                "bytes": size,
                "sha256": sha256_file(path),
                "status": "invalid",
                "error": None,
                "format": None,
                "width": None,
                "height": None,
            }
            try:
                if size <= 0:
                    raise ValueError("empty_file")
                if size > max_bytes:
                    raise ValueError("file_too_large_for_inspection")
                image, image_format = decode_bgr_bytes(
                    path.read_bytes(),
                    extension=path.suffix,
                    max_width=args.max_width,
                    max_height=args.max_height,
                    max_pixels=args.max_pixels,
                )
                record.update(
                    {
                        "status": "valid",
                        "format": image_format,
                        "width": int(image.shape[1]),
                        "height": int(image.shape[0]),
                    }
                )
            except (OSError, RuntimeError, ValueError) as exc:
                record["error"] = str(exc)[:120]
            records.append(record)

    generated_at = datetime.now(UTC).isoformat()
    dataset = {
        "name": args.dataset_name,
        "version": args.dataset_version,
        "source": args.source,
        "license": args.dataset_license,
        "rootDirectoryName": root.name,
    }
    inventory = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "dataset": dataset,
        "records": records,
    }

    valid = [record for record in records if record["status"] == "valid"]
    by_hash: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in valid:
        by_hash[record["sha256"]].append(record)
    duplicate_groups = [
        {
            "sha256": digest,
            "paths": [record["path"] for record in group],
            "labels": sorted({record["label"] for record in group}),
        }
        for digest, group in sorted(by_hash.items())
        if len(group) > 1
    ]
    report = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "status": "complete",
        "dataset": dataset,
        "totalFiles": len(records),
        "validImages": len(valid),
        "invalidImages": len(records) - len(valid),
        "classDistribution": dict(sorted(Counter(r["label"] for r in valid).items())),
        "invalidByReason": dict(
            sorted(Counter(r["error"] for r in records if r["error"]).items())
        ),
        "exactDuplicateGroups": duplicate_groups,
        "exactDuplicateFilesBeyondFirst": sum(
            len(group["paths"]) - 1 for group in duplicate_groups
        ),
        "crossLabelDuplicateGroups": sum(
            len(group["labels"]) > 1 for group in duplicate_groups
        ),
    }
    return inventory, report


def main() -> None:
    args = parse_args()
    if args.max_file_mb <= 0 or min(args.max_width, args.max_height, args.max_pixels) <= 0:
        raise SystemExit("Inspection limits must be positive")
    inventory, report = inspect(args)
    args.output.mkdir(parents=True, exist_ok=True)
    write_json_atomic(args.output / "inventory.json", inventory)
    write_json_atomic(args.output / "inspection_report.json", report)
    with (args.output / "inventory.csv").open(
        "w", encoding="utf-8", newline=""
    ) as handle:
        fields = [
            "path",
            "label",
            "bytes",
            "sha256",
            "status",
            "error",
            "format",
            "width",
            "height",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(inventory["records"])
    print(
        f"Inspected {report['totalFiles']} files: {report['validImages']} valid, "
        f"{report['invalidImages']} invalid. Results: {args.output}"
    )


if __name__ == "__main__":
    main()
