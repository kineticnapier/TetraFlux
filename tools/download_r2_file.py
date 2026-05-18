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
    ap.add_argument("--key", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--optional", action="store_true")
    args = ap.parse_args()

    s3 = client()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    try:
        s3.download_file(args.bucket, args.key, str(out))
    except Exception:
        if args.optional:
            print(f"optional object not found or unavailable: {args.key}")
            return 0
        raise

    print(f"downloaded {args.key} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
