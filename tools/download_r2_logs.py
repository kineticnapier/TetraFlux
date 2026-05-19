#!/usr/bin/env python3
"""
Download TetraFlux JSONL logs from Cloudflare R2 using the S3-compatible API.

Required environment:
  CLOUDFLARE_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY

Important defaults:
  - Use --recent-days to avoid listing the whole bucket forever.
  - Use --max-objects and --max-total-mb to cap download size.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timedelta, timezone
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
            connect_timeout=20,
            read_timeout=120,
        ),
    )


def dated_prefixes(base_prefix: str, recent_days: int) -> list[str]:
    if recent_days <= 0:
        return [base_prefix]

    prefix = base_prefix if base_prefix.endswith("/") else f"{base_prefix}/"
    today = datetime.now(timezone.utc).date()

    # R2 keys are like raw/YYYY-MM-DD/... or selfplay/YYYY-MM-DD/...
    # Listing these narrow prefixes is much faster than listing raw/ forever.
    prefixes = []
    for i in range(recent_days):
        day = today - timedelta(days=i)
        prefixes.append(f"{prefix}{day.isoformat()}/")
    return prefixes


def list_jsonl_objects(client, bucket: str, prefixes: list[str], max_list_pages: int = 0) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    paginator = client.get_paginator("list_objects_v2")
    page_count = 0

    try:
        for prefix in prefixes:
            print(f"list prefix: s3://{bucket}/{prefix}", flush=True)
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                page_count += 1

                for item in page.get("Contents", []):
                    key = item.get("Key")
                    if isinstance(key, str) and key.endswith(".jsonl"):
                        last_modified = item.get("LastModified")
                        out.append({
                            "key": key,
                            "size": int(item.get("Size", 0)),
                            "last_modified": last_modified.isoformat() if last_modified else None,
                            "last_modified_ts": last_modified.timestamp() if last_modified else 0.0,
                        })

                if page_count % 10 == 0:
                    print(f"listed pages={page_count} jsonl_objects={len(out)}", flush=True)

                if max_list_pages > 0 and page_count >= max_list_pages:
                    print(f"stop listing: max_list_pages={max_list_pages}", flush=True)
                    out.sort(key=lambda x: (float(x.get("last_modified_ts", 0.0)), str(x["key"])), reverse=True)
                    return out

    except ClientError as e:
        err = e.response.get("Error", {})
        code = err.get("Code")
        msg = err.get("Message")
        raise SystemExit(
            "R2 list_objects_v2 failed.\n"
            f"bucket={bucket}\n"
            f"prefixes={prefixes}\n"
            f"code={code}\n"
            f"message={msg}\n"
            "Check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY permissions and bucket name."
        ) from e

    # Newest first.
    out.sort(key=lambda x: (float(x.get("last_modified_ts", 0.0)), str(x["key"])), reverse=True)
    print(f"listed total pages={page_count} jsonl_objects={len(out)}", flush=True)
    return out


def select_objects(objects: list[dict[str, Any]], max_objects: int, max_total_bytes: int) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    total = 0

    for obj in objects:
        size = int(obj.get("size", 0))

        if max_objects > 0 and len(selected) >= max_objects:
            break

        if max_total_bytes > 0 and selected and total + size > max_total_bytes:
            break

        if max_total_bytes > 0 and not selected and size > max_total_bytes:
            # Allow one large object rather than selecting nothing.
            selected.append(obj)
            total += size
            break

        selected.append(obj)
        total += size

    return selected


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--prefix", default="raw/")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--max-objects", type=int, default=500, help="0 means unlimited")
    ap.add_argument("--max-total-mb", type=float, default=96.0, help="0 means unlimited")
    ap.add_argument("--recent-days", type=int, default=14, help="0 means list the whole prefix")
    ap.add_argument("--max-list-pages", type=int, default=0, help="0 means unlimited")
    ap.add_argument("--endpoint-url", default=None)
    args = ap.parse_args()

    account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
    require_env("R2_ACCESS_KEY_ID")
    require_env("R2_SECRET_ACCESS_KEY")

    endpoint_url = args.endpoint_url or f"https://{account_id}.r2.cloudflarestorage.com"

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    max_total_bytes = int(args.max_total_mb * 1024 * 1024) if args.max_total_mb > 0 else 0
    prefixes = dated_prefixes(args.prefix, args.recent_days)

    print(json.dumps({
        "endpoint_url": endpoint_url,
        "bucket": args.bucket,
        "prefix": args.prefix,
        "prefixes": prefixes,
        "out_dir": str(out_dir),
        "max_objects": args.max_objects,
        "max_total_mb": args.max_total_mb,
        "recent_days": args.recent_days,
        "max_list_pages": args.max_list_pages,
    }, ensure_ascii=False, indent=2), flush=True)

    client = make_client(endpoint_url)
    objects = list_jsonl_objects(client, args.bucket, prefixes, max_list_pages=args.max_list_pages)
    selected = select_objects(objects, args.max_objects, max_total_bytes)

    downloaded = []
    skipped = []

    if not selected:
        summary = {
            "bucket": args.bucket,
            "prefix": args.prefix,
            "prefixes": prefixes,
            "endpoint_url": endpoint_url,
            "out_dir": str(out_dir),
            "jsonl_objects_listed": len(objects),
            "jsonl_objects_selected": 0,
            "downloaded": 0,
            "skipped": 0,
            "note": "No .jsonl objects selected. Check Upload Logs, bucket, prefix, recent_days, and caps.",
        }
        (out_dir / "_download_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    selected_bytes = sum(int(x.get("size", 0)) for x in selected)
    print(json.dumps({
        "jsonl_objects_listed": len(objects),
        "jsonl_objects_selected": len(selected),
        "selected_total_mb": round(selected_bytes / 1024 / 1024, 3),
        "oldest_selected": selected[-1].get("last_modified") if selected else None,
        "newest_selected": selected[0].get("last_modified") if selected else None,
    }, ensure_ascii=False, indent=2), flush=True)

    for i, obj in enumerate(selected, 1):
        key = str(obj["key"])
        dest = out_dir / safe_relpath(key)
        dest.parent.mkdir(parents=True, exist_ok=True)

        if dest.exists() and dest.stat().st_size > 0:
            skipped.append({"key": key, "reason": "already_exists", "path": str(dest)})
            continue

        print(
            f"download {i}/{len(selected)} "
            f"{round(int(obj.get('size', 0)) / 1024 / 1024, 3)}MB "
            f"s3://{args.bucket}/{key} -> {dest}",
            flush=True,
        )

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
        "prefixes": prefixes,
        "endpoint_url": endpoint_url,
        "out_dir": str(out_dir),
        "jsonl_objects_listed": len(objects),
        "jsonl_objects_selected": len(selected),
        "selected_total_mb": round(selected_bytes / 1024 / 1024, 3),
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
