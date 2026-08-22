"""Report actual class counts from an inventory or split manifest."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from common.io_utils import read_json, write_json_atomic


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    document = read_json(args.input)
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
    }
    if isinstance(document, dict) and isinstance(document.get("records"), list):
        valid = [record for record in document["records"] if record.get("status") == "valid"]
        report.update(
            {
                "sourceType": "inventory",
                "totalValid": len(valid),
                "byClass": dict(sorted(Counter(r["label"] for r in valid).items())),
            }
        )
        report["uniqueContentByClass"] = {
            label: len({r["sha256"] for r in valid if r["label"] == label})
            for label in sorted({r["label"] for r in valid})
        }
    elif isinstance(document, dict) and isinstance(document.get("splits"), dict):
        report["sourceType"] = "split_manifest"
        report["bySplit"] = {
            split: {
                "total": len(entries),
                "byClass": dict(sorted(Counter(r["label"] for r in entries).items())),
            }
            for split, entries in document["splits"].items()
        }
    else:
        raise SystemExit("Input is neither a supported inventory nor split manifest")
    if args.output:
        write_json_atomic(args.output, report)
    print(report)


if __name__ == "__main__":
    main()
