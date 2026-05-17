#!/usr/bin/env python3
"""
audit_web_logs.py

Audit TetraFlux Web FT5 JSONL logs before training.

Usage:
  python tools/audit_web_logs.py ^
    --input data/merged_web_logs.jsonl ^
    --out data/audit_web_logs.json

This helps detect data contamination:
- old trainer versions
- AI-winning rounds
- very dirty states
- high holes / high board states
- topout-adjacent samples
- strange action distributions
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean


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


def bucket(v, step):
    return int(v // step) * step


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--top", type=int, default=30)
    args = ap.parse_args()

    path = Path(args.input)
    versions = Counter()
    winners = Counter()
    action_counts = Counter()
    piece_counts = Counter()
    hold_counts = Counter()
    match_counts = Counter()
    hole_buckets = Counter()
    height_buckets = Counter()
    garbage_buckets = Counter()
    round_lengths = Counter()
    dirty_examples = []

    holes_list = []
    height_list = []
    garbage_list = []
    total = 0
    bad_json = 0

    # match/round -> count
    per_round = defaultdict(int)

    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                bad_json += 1
                continue

            total += 1
            versions[str(rec.get("trainer_version"))] += 1
            winners[str(rec.get("round_winner"))] += 1
            match_counts[str(rec.get("match_id"))] += 1

            round_key = (str(rec.get("match_id")), int(rec.get("round_index", -1)))
            per_round[round_key] += 1

            action = rec.get("human_action") if isinstance(rec.get("human_action"), dict) else {}
            key = str(action.get("key"))
            action_counts[key] += 1
            piece_counts[str(action.get("piece"))] += 1
            hold_counts[str(bool(action.get("hold", False)))] += 1

            state = rec.get("state") if isinstance(rec.get("state"), dict) else {}
            m = metrics(board_rows(state))
            holes = m["holes"]
            height = m["max_height"]
            garbage = int(state.get("pendingGarbage", state.get("pending_garbage", 0)) or 0)

            holes_list.append(holes)
            height_list.append(height)
            garbage_list.append(garbage)

            hole_buckets[bucket(holes, 5)] += 1
            height_buckets[bucket(height, 2)] += 1
            garbage_buckets[bucket(garbage, 2)] += 1

            if len(dirty_examples) < args.top and (holes >= 30 or height >= 19 or garbage >= 10):
                dirty_examples.append({
                    "line_no": line_no,
                    "trainer_version": rec.get("trainer_version"),
                    "round_winner": rec.get("round_winner"),
                    "match_id": rec.get("match_id"),
                    "round_index": rec.get("round_index"),
                    "step_index": rec.get("step_index"),
                    "action": action.get("key"),
                    "holes": holes,
                    "max_height": height,
                    "pending_garbage": garbage,
                })

    for _rk, n in per_round.items():
        round_lengths[n] += 1

    result = {
        "input": str(path),
        "total_rows": total,
        "bad_json": bad_json,
        "versions": dict(versions),
        "round_winners": dict(winners),
        "matches": len(match_counts),
        "avg_rows_per_match": mean(match_counts.values()) if match_counts else 0,
        "round_length_distribution": dict(sorted(round_lengths.items())),
        "metrics": {
            "avg_holes": mean(holes_list) if holes_list else 0,
            "max_holes": max(holes_list, default=0),
            "avg_height": mean(height_list) if height_list else 0,
            "max_height": max(height_list, default=0),
            "avg_pending_garbage": mean(garbage_list) if garbage_list else 0,
            "max_pending_garbage": max(garbage_list, default=0),
            "hole_buckets": dict(sorted(hole_buckets.items())),
            "height_buckets": dict(sorted(height_buckets.items())),
            "garbage_buckets": dict(sorted(garbage_buckets.items())),
        },
        "top_actions": action_counts.most_common(args.top),
        "piece_counts": dict(piece_counts),
        "hold_counts": dict(hold_counts),
        "dirty_examples": dirty_examples,
    }

    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
