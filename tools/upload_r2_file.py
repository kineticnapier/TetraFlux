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
    ap.add_argument("--file", required=True)
    ap.add_argument("--content-type", default="application/octet-stream")
    args = ap.parse_args()

    path = Path(args.file)
    extra = {"ContentType": args.content_type}
    client().upload_file(str(path), args.bucket, args.key, ExtraArgs=extra)
    print(f"uploaded {path} -> r2://{args.bucket}/{args.key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
