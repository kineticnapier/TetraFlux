#!/usr/bin/env python3
"""
Download TetraFlux JSONL logs from Cloudflare R2 using Wrangler.

This script is intended for GitHub Actions, but also works locally.

Required auth:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID

Example:
  python tools/download_r2_logs.py ^
    --bucket tetraflux-logs ^
    --prefix raw/ ^
    --out-dir collected_logs_r2

It calls:
  npx wrangler@latest r2 object list ...
  npx wrangler@latest r2 object get ...
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


def run(cmd: list[str], *, capture: bool = False) -> str:
    print("+ " + " ".join(cmd), flush=True)
    if capture:
        p = subprocess.run(cmd, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if p.stderr.strip():
            print(p.stderr, file=sys.stderr)
        return p.stdout
    subprocess.run(cmd, check=True)
    return ""


def parse_objects(raw: str) -> list[dict[str, Any]]:
    data = json.loads(raw)

    if isinstance(data, list):
        objects = data
    elif isinstance(data, dict):
        objects = data.get("objects") or data.get("items") or data.get("result") or []
    else:
        objects = []

    out: list[dict[str, Any]] = []
    for item in objects:
        if not isinstance(item, dict):
            continue
        key = item.get("key") or item.get("name")
        if isinstance(key, str):
            out.append(item)
    return out


def safe_relpath(key: str) -> Path:
    key = key.replace("\\", "/")
    parts = []
    for part in key.split("/"):
        if not part or part in {".", ".."}:
            continue
        clean = re.sub(r"[^A-Za-z0-9._-]+", "_", part)
        parts.append(clean)
    return Path(*parts) if parts else Path("unknown.jsonl")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--prefix", default="raw/")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--max-objects", type=int, default=0, help="0 means unlimited")
    ap.add_argument("--wrangler", default="npx wrangler@latest")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    wrangler = args.wrangler.split()

    list_cmd = [
        *wrangler,
        "r2",
        "object",
        "list",
        args.bucket,
        "--prefix",
        args.prefix,
        "--json",
    ]

    raw = run(list_cmd, capture=True)
    objects = parse_objects(raw)

    jsonl_objects = []
    for obj in objects:
        key = obj.get("key") or obj.get("name")
        if not isinstance(key, str):
            continue
        if key.endswith(".jsonl"):
            jsonl_objects.append(obj)

    jsonl_objects.sort(key=lambda x: str(x.get("key") or x.get("name")))

    if args.max_objects > 0:
        jsonl_objects = jsonl_objects[-args.max_objects:]

    downloaded = []
    skipped = []

    for obj in jsonl_objects:
        key = str(obj.get("key") or obj.get("name"))
        rel = safe_relpath(key)
        dest = out_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)

        if dest.exists() and dest.stat().st_size > 0:
            skipped.append({"key": key, "reason": "already_exists", "path": str(dest)})
            continue

        get_cmd = [
            *wrangler,
            "r2",
            "object",
            "get",
            f"{args.bucket}/{key}",
            "--file",
            str(dest),
        ]
        run(get_cmd)
        downloaded.append({"key": key, "path": str(dest), "bytes": dest.stat().st_size if dest.exists() else 0})

    summary = {
        "bucket": args.bucket,
        "prefix": args.prefix,
        "out_dir": str(out_dir),
        "objects_seen": len(objects),
        "jsonl_objects": len(jsonl_objects),
        "downloaded": len(downloaded),
        "skipped": len(skipped),
        "downloaded_files": downloaded[:50],
        "skipped_files": skipped[:50],
    }

    (out_dir / "_download_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
