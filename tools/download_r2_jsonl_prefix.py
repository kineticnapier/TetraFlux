#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path

import boto3


def client():
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--max-objects", type=int, default=0, help="0 = no limit")
    args = ap.parse_args()

    s3 = client()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    token = None
    n = 0
    while True:
        kwargs = {"Bucket": args.bucket, "Prefix": args.prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        res = s3.list_objects_v2(**kwargs)
        for obj in res.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".jsonl"):
                continue
            rel = key[len(args.prefix):].lstrip("/") or Path(key).name
            dst = out_dir / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(args.bucket, key, str(dst))
            n += 1
            print(f"downloaded {key} -> {dst}")
            if args.max_objects and n >= args.max_objects:
                print(f"downloaded_count={n}")
                return 0
        if not res.get("IsTruncated"):
            break
        token = res.get("NextContinuationToken")

    print(f"downloaded_count={n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
