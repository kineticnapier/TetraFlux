#!/usr/bin/env python3
"""
sync_web_policy_r2.py

Upload/download the latest browser model JSON to/from Cloudflare R2.

Why:
  If normal Cloudflare Pages deploy runs after training, it can redeploy the
  repository's stale public/models/web_policy.json and overwrite the trained one.

Fix:
  - train-from-r2 uploads public/models/web_policy.json to R2.
  - deploy-cloudflare downloads the latest model from R2 before npm run build.
  - if download is not possible, normal deploy removes local stale web_policy.json.

Required env:
  CLOUDFLARE_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY

Examples:
  python tools/sync_web_policy_r2.py upload ^
    --bucket tetraflux-logs ^
    --key models/latest/web_policy.json ^
    --file public/models/web_policy.json

  python tools/sync_web_policy_r2.py download ^
    --bucket tetraflux-logs ^
    --key models/latest/web_policy.json ^
    --file public/models/web_policy.json ^
    --allow-missing
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is not set")
    return value


def make_client(endpoint_url: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=require_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=require_env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )


def read_model_info(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {
            "model_id": data.get("model_id"),
            "model_name": data.get("model_name"),
            "exported_at": data.get("exported_at"),
            "checkpoint_mtime_utc": data.get("checkpoint_mtime_utc"),
            "checkpoint_sha256_12": data.get("checkpoint_sha256_12"),
            "size": path.stat().st_size,
        }
    except Exception as e:
        return {"error": str(e), "size": path.stat().st_size if path.exists() else 0}


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    for sp in [sub.add_parser("upload"), sub.add_parser("download")]:
        sp.add_argument("--bucket", required=True)
        sp.add_argument("--key", default="models/latest/web_policy.json")
        sp.add_argument("--file", required=True)
        sp.add_argument("--endpoint-url", default=None)

    sub.choices["download"].add_argument("--allow-missing", action="store_true")

    args = ap.parse_args()

    account_id = require_env("CLOUDFLARE_ACCOUNT_ID")
    require_env("R2_ACCESS_KEY_ID")
    require_env("R2_SECRET_ACCESS_KEY")

    endpoint_url = args.endpoint_url or f"https://{account_id}.r2.cloudflarestorage.com"
    client = make_client(endpoint_url)
    path = Path(args.file)

    if args.cmd == "upload":
        if not path.exists():
            raise SystemExit(f"file not found: {path}")

        info = read_model_info(path)
        print(json.dumps({"action": "upload", "bucket": args.bucket, "key": args.key, "file": str(path), "info": info}, ensure_ascii=False, indent=2))

        client.upload_file(
            str(path),
            args.bucket,
            args.key,
            ExtraArgs={
                "ContentType": "application/json; charset=utf-8",
                "CacheControl": "no-store, no-cache, must-revalidate, max-age=0",
                "Metadata": {
                    "model_id": str(info.get("model_id") or ""),
                    "model_name": str(info.get("model_name") or ""),
                    "exported_at": str(info.get("exported_at") or ""),
                    "sha12": str(info.get("checkpoint_sha256_12") or ""),
                },
            },
        )
        print("uploaded")
        return 0

    if args.cmd == "download":
        path.parent.mkdir(parents=True, exist_ok=True)

        try:
            head = client.head_object(Bucket=args.bucket, Key=args.key)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code")
            if args.allow_missing and code in {"404", "NoSuchKey", "NotFound"}:
                print(json.dumps({
                    "action": "download",
                    "missing": True,
                    "bucket": args.bucket,
                    "key": args.key,
                    "note": "No latest model in R2. Remove local stale model before build.",
                }, ensure_ascii=False, indent=2))
                if path.exists():
                    path.unlink()
                    print(f"removed stale local file: {path}")
                return 0
            raise

        client.download_file(args.bucket, args.key, str(path))
        info = read_model_info(path)

        print(json.dumps({
            "action": "download",
            "bucket": args.bucket,
            "key": args.key,
            "file": str(path),
            "r2_size": head.get("ContentLength"),
            "info": info,
        }, ensure_ascii=False, indent=2))
        return 0

    raise SystemExit("unreachable")


if __name__ == "__main__":
    raise SystemExit(main())
