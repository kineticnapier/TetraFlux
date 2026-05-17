#!/usr/bin/env python3
"""
Convert merged TetraFlux web FT5 JSONL logs into a compact supervised dataset.

Recommended flow:

1. Put downloaded logs here:
   collected_logs/*.jsonl

2. Merge:
   python tools/merge_jsonl.py --input collected_logs --out data/merged_web_logs.jsonl

3. Build dataset:
   python tools/build_web_dataset.py --input data/merged_web_logs.jsonl --wins-only --out data/web_human_dataset.jsonl

This script does not train a model yet. It creates:
  {"state": ..., "action": ..., "split": ...}
rows suitable for the next training step.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def split_for(match_id: str, round_index: int, step_index: int, seed: int) -> str:
    raw = f"{match_id}:{round_index}:{step_index}:{seed}"
    h = hashlib.sha1(raw.encode("utf-8")).digest()
    v = int.from_bytes(h[:4], "little") / 2**32
    if v < 0.80:
        return "train"
    if v < 0.90:
        return "val"
    return "test"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--wins-only", action="store_true")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    inp = Path(args.input)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    kept = 0
    skipped = {}

    with inp.open("r", encoding="utf-8") as f, out.open("w", encoding="utf-8") as g:
        for line_no, line in enumerate(f, start=1):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                skipped["bad_json"] = skipped.get("bad_json", 0) + 1
                continue

            if args.wins_only and rec.get("round_winner") != "human":
                skipped["not_human_win"] = skipped.get("not_human_win", 0) + 1
                continue

            state = rec.get("state")
            action = rec.get("human_action")
            if not isinstance(state, dict) or not isinstance(action, dict):
                skipped["missing_state_or_action"] = skipped.get("missing_state_or_action", 0) + 1
                continue

            try:
                key = str(action["key"])
                piece = str(action["piece"])
                x = int(action["x"])
                rot = int(action["rot"]) % 4
                hold = bool(action.get("hold", False))
            except Exception:
                skipped["bad_action"] = skipped.get("bad_action", 0) + 1
                continue

            split = split_for(
                str(rec.get("match_id", "")),
                int(rec.get("round_index", 0)),
                int(rec.get("step_index", line_no)),
                args.seed,
            )

            row = {
                "source": "web_ft5",
                "trainer_version": rec.get("trainer_version"),
                "match_id": rec.get("match_id"),
                "round_index": rec.get("round_index"),
                "step_index": rec.get("step_index"),
                "round_winner": rec.get("round_winner"),
                "split": split,
                "state": state,
                "action": {
                    "key": key,
                    "piece": piece,
                    "x": x,
                    "rot": rot,
                    "hold": hold,
                },
            }
            g.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            kept += 1

    meta = {
        "input": str(inp),
        "out": str(out),
        "kept": kept,
        "skipped": skipped,
        "wins_only": args.wins_only,
    }
    out.with_suffix(".meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
