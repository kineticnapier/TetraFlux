#!/usr/bin/env python3
"""
filter_web_logs.py

Filter TetraFlux Web FT5 raw/merged logs before dataset building.

Recommended first clean dataset:
  python tools/filter_web_logs.py ^
    --input data/merged_web_logs.jsonl ^
    --out data/merged_web_logs_clean.jsonl ^
    --trainer-version web-ft5-0.2.0 ^
    --winner human ^
    --max-holes 20 ^
    --max-height 18 ^
    --max-pending-garbage 8 ^
    --min-round-length 8

Then:
  python tools/build_web_dataset.py ^
    --input data/merged_web_logs_clean.jsonl ^
    --out data/web_human_dataset_clean.jsonl

Do not use --wins-only again if you already used --winner human;
it is harmless, but redundant.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
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
    blocks = 0

    for x in range(10):
        height = 0
        seen = False
        for top_i, row in enumerate(rows):
            y = 19 - top_i
            filled = row[x] != "."
            if filled:
                blocks += 1
                seen = True
                height = max(height, y + 1)
            elif seen:
                holes += 1
        heights.append(height)

    bump = sum(abs(a - b) for a, b in zip(heights, heights[1:]))
    return {
        "blocks": blocks,
        "holes": holes,
        "max_height": max(heights) if heights else 0,
        "total_height": sum(heights),
        "bumpiness": bump,
    }


def record_round_key(rec):
    return (str(rec.get("match_id")), int(rec.get("round_index", -1)))


def load_records(path: Path):
    records = []
    skipped = Counter()
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                skipped["bad_json"] += 1
                continue
            records.append((line_no, rec))
    return records, skipped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)

    ap.add_argument("--trainer-version", default="web-ft5-0.2.0")
    ap.add_argument("--winner", choices=["human", "ai", "any"], default="human")

    ap.add_argument("--max-holes", type=int, default=20)
    ap.add_argument("--max-height", type=int, default=18)
    ap.add_argument("--max-pending-garbage", type=int, default=8)
    ap.add_argument("--max-bumpiness", type=int, default=80)
    ap.add_argument("--min-round-length", type=int, default=8)

    ap.add_argument("--allow-old-version", action="store_true")
    ap.add_argument("--allow-dirty", action="store_true")
    args = ap.parse_args()

    inp = Path(args.input)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    records, skipped = load_records(inp)

    round_lengths = defaultdict(int)
    for _line_no, rec in records:
        round_lengths[record_round_key(rec)] += 1

    kept = 0
    examples_skipped = []

    with out.open("w", encoding="utf-8") as g:
        for line_no, rec in records:
            reason = None

            if not args.allow_old_version and rec.get("trainer_version") != args.trainer_version:
                reason = "trainer_version"

            if reason is None and args.winner != "any" and rec.get("round_winner") != args.winner:
                reason = "winner"

            if reason is None and round_lengths[record_round_key(rec)] < args.min_round_length:
                reason = "round_too_short"

            state = rec.get("state") if isinstance(rec.get("state"), dict) else {}
            m = metrics(board_rows(state))
            pending = int(state.get("pendingGarbage", state.get("pending_garbage", 0)) or 0)

            if reason is None and not args.allow_dirty:
                if m["holes"] > args.max_holes:
                    reason = "holes"
                elif m["max_height"] > args.max_height:
                    reason = "height"
                elif m["bumpiness"] > args.max_bumpiness:
                    reason = "bumpiness"
                elif pending > args.max_pending_garbage:
                    reason = "pending_garbage"

            if reason is not None:
                skipped[reason] += 1
                if len(examples_skipped) < 30:
                    examples_skipped.append({
                        "line_no": line_no,
                        "reason": reason,
                        "trainer_version": rec.get("trainer_version"),
                        "winner": rec.get("round_winner"),
                        "round_len": round_lengths[record_round_key(rec)],
                        "holes": m["holes"],
                        "height": m["max_height"],
                        "bumpiness": m["bumpiness"],
                        "pending": pending,
                        "action": (rec.get("human_action") or {}).get("key") if isinstance(rec.get("human_action"), dict) else None,
                    })
                continue

            g.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
            kept += 1

    meta = {
        "input": str(inp),
        "out": str(out),
        "kept": kept,
        "skipped": dict(skipped),
        "config": {
            "trainer_version": args.trainer_version,
            "winner": args.winner,
            "max_holes": args.max_holes,
            "max_height": args.max_height,
            "max_pending_garbage": args.max_pending_garbage,
            "max_bumpiness": args.max_bumpiness,
            "min_round_length": args.min_round_length,
            "allow_old_version": args.allow_old_version,
            "allow_dirty": args.allow_dirty,
        },
        "examples_skipped": examples_skipped,
    }

    out.with_suffix(".meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
