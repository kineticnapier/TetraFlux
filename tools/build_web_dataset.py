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


def board_rows(state):
    if not isinstance(state, dict):
        return ["." * 10 for _ in range(20)]
    board = state.get("board")
    if not isinstance(board, list):
        return ["." * 10 for _ in range(20)]
    rows = [str(r) for r in board][-20:]
    while len(rows) < 20:
        rows.insert(0, "." * 10)
    return [(r + "." * 10)[:10] for r in rows]


def metrics(rows):
    heights = []
    holes = 0

    for x in range(10):
        height = 0
        seen = False
        for top_i, row in enumerate(rows):
            y = 19 - top_i
            filled = row[x] != "."
            if filled:
                seen = True
                height = max(height, y + 1)
            elif seen:
                holes += 1
        heights.append(height)

    bumpiness = sum(abs(a - b) for a, b in zip(heights, heights[1:]))
    center_max = max(heights[4], heights[5])
    side_avg = (heights[0] + heights[1] + heights[8] + heights[9]) / 4
    return {
        "holes": holes,
        "max_height": max(heights),
        "bumpiness": bumpiness,
        "center_tower": max(0.0, center_max - side_avg),
    }


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
    ap.add_argument("--max-holes", type=int, default=20)
    ap.add_argument("--max-height", type=int, default=18)
    ap.add_argument("--max-bumpiness", type=int, default=80)
    ap.add_argument("--max-center-tower", type=float, default=8.0)
    ap.add_argument("--max-pending-garbage", type=int, default=8)
    ap.add_argument("--allow-dirty", action="store_true")
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

            result = rec.get("result") if isinstance(rec.get("result"), dict) else {}
            m = metrics(board_rows(state))
            pending = int(state.get("pendingGarbage", state.get("pending_garbage", 0)) or 0)
            if not args.allow_dirty:
                if bool(result.get("topout")):
                    skipped["topout"] = skipped.get("topout", 0) + 1
                    continue
                if m["holes"] > args.max_holes:
                    skipped["holes"] = skipped.get("holes", 0) + 1
                    continue
                if m["max_height"] > args.max_height:
                    skipped["height"] = skipped.get("height", 0) + 1
                    continue
                if m["bumpiness"] > args.max_bumpiness:
                    skipped["bumpiness"] = skipped.get("bumpiness", 0) + 1
                    continue
                if m["center_tower"] > args.max_center_tower:
                    skipped["center_tower"] = skipped.get("center_tower", 0) + 1
                    continue
                if pending > args.max_pending_garbage:
                    skipped["pending_garbage"] = skipped.get("pending_garbage", 0) + 1
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
        "dirty_filter": {
            "enabled": not args.allow_dirty,
            "max_holes": args.max_holes,
            "max_height": args.max_height,
            "max_bumpiness": args.max_bumpiness,
            "max_center_tower": args.max_center_tower,
            "max_pending_garbage": args.max_pending_garbage,
        },
    }
    out.with_suffix(".meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
