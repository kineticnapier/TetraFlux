#!/usr/bin/env python3
"""
Inspect a browser-side TetraFlux web_policy.json.

This intentionally avoids bash heredocs in GitHub Actions.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


FIELDS = [
    "model_id",
    "model_name",
    "exported_at",
    "checkpoint_name",
    "checkpoint_mtime_utc",
    "checkpoint_sha256_12",
    "input_dim",
    "num_actions",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--label", default="MODEL")
    ap.add_argument("--allow-missing", action="store_true")
    args = ap.parse_args()

    path = Path(args.file)

    if not path.exists():
        msg = f"{args.label}: {path} does not exist"
        if args.allow_missing:
            print(msg)
            return 0
        raise SystemExit(msg)

    data = json.loads(path.read_text(encoding="utf-8"))

    print(f"{args.label}:")
    print(f"  file: {path}")
    print(f"  size: {path.stat().st_size}")
    for key in FIELDS:
        print(f"  {key}: {data.get(key)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
