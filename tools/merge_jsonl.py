#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import json
import hashlib

def iter_files(paths):
    for raw in paths:
        p = Path(raw)
        if p.is_file() and p.suffix == ".jsonl":
            yield p
        elif p.is_dir():
            yield from sorted(p.rglob("*.jsonl"))

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    seen = set()
    kept = 0
    skipped = 0
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    with out.open("w", encoding="utf-8") as f:
        for path in iter_files(args.input):
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    skipped += 1
                    continue
                key = hashlib.sha1(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
                if key in seen:
                    skipped += 1
                    continue
                seen.add(key)
                f.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
                kept += 1

    print(json.dumps({"out": str(out), "kept": kept, "skipped": skipped}, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
