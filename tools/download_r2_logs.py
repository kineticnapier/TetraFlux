#!/usr/bin/env python3
"""
Download TetraFlux JSONL logs from Cloudflare R2 using the S3-compatible API.

Why this exists:
  Wrangler v4 has `r2 object get/put/delete`, but not `r2 object list`.
  So listing + batch download should use the R2 S3-compatible API instead.

Required environment:
  CLOUDFLARE_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY

Example:
  python tools/download_r2_logs.py ^
    --bucket tetraflux-logs ^
    --prefix raw/ ^
    --out-dir collected_logs_r2

Optional:
  --endpoint-url https://<account_id>.r2.cloudflarestorage.com
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is not set")
    return value


def safe_relpath(key: str) -> Path:
    key = key.replace("\\", "/")
    parts = []
    for part in key.split("/"):
        if not part or part in {".", ".."}:
            continue
        clean = re.sub(r"[^A-Za-z0-9._-]+", "_", part)
        parts.append(clean)
    return Path(*parts) if parts else Path("unknown.jsonl")


def make_client(endpoint_url: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=require_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=require_env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 5, "mode": "standard"},
        ),
    )


def list_jsonl_objects(client, bucket: str, prefix: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    paginator = client.get_paginator("list_objects_v2")

    try:
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                key = item.get("Key")
                if isinstance(key, str) and key.endswith(".jsonl"):
                    out.append({
                        "key": key,
                        "size": int(item.get("Size", 0)),
                        "last_modified": item.get("LastModified").isoformat() if item.get("LastModified") else None,
                    })
    except ClientError as e:
        err = e.response.get("Error", {})
        code = err.get("Code")
        msg = err.get("Message")
        raise SystemExit(
            "R2 list_objects_v2 failed.\n"
            f"bucket={bucket}\n"
            f"prefix={prefix}\n"
            f"code={code}\n"
            f"message={msg}\n"
            "Check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY permissions and bucket name."
        ) from e

    out.sort(key=lambda x: str(x["key"]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--prefix", default="raw/")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--max-objects", type=int, default=0, help="0 means unlimited")
    ap.add_argument("--endpoint-url", default=None)
    args = ap.parse_args()

    account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
    require_env("R2_ACCESS_KEY_ID")
    require_env("R2_SECRET_ACCESS_KEY")

    endpoint_url = args.endpoint_url or f"https://{account_id}.r2.cloudflarestorage.com"

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(json.dumps({
        "endpoint_url": endpoint_url,
        "bucket": args.bucket,
        "prefix": args.prefix,
        "out_dir": str(out_dir),
        "max_objects": args.max_objects,
    }, ensure_ascii=False, indent=2), flush=True)

    client = make_client(endpoint_url)
    objects = list_jsonl_objects(client, args.bucket, args.prefix)

    if args.max_objects > 0:
        objects = objects[-args.max_objects:]

    downloaded = []
    skipped = []

    if not objects:
        summary = {
            "bucket": args.bucket,
            "prefix": args.prefix,
            "endpoint_url": endpoint_url,
            "out_dir": str(out_dir),
            "jsonl_objects": 0,
            "downloaded": 0,
            "skipped": 0,
            "note": "No .jsonl objects found. Check Upload Logs, bucket, and prefix.",
        }
        (out_dir / "_download_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    for obj in objects:
        key = str(obj["key"])
        dest = out_dir / safe_relpath(key)
        dest.parent.mkdir(parents=True, exist_ok=True)

        if dest.exists() and dest.stat().st_size > 0:
            skipped.append({"key": key, "reason": "already_exists", "path": str(dest)})
            continue

        print(f"download s3://{args.bucket}/{key} -> {dest}", flush=True)
        try:
            client.download_file(args.bucket, key, str(dest))
        except ClientError as e:
            err = e.response.get("Error", {})
            code = err.get("Code")
            msg = err.get("Message")
            raise SystemExit(
                "R2 download_file failed.\n"
                f"bucket={args.bucket}\n"
                f"key={key}\n"
                f"code={code}\n"
                f"message={msg}"
            ) from e

        downloaded.append({
            "key": key,
            "path": str(dest),
            "bytes": dest.stat().st_size if dest.exists() else 0,
            "source_size": obj.get("size"),
            "last_modified": obj.get("last_modified"),
        })

    summary = {
        "bucket": args.bucket,
        "prefix": args.prefix,
        "endpoint_url": endpoint_url,
        "out_dir": str(out_dir),
        "jsonl_objects": len(objects),
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
