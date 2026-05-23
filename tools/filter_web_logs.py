#!/usr/bin/env python3
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


def is_near_topout(m: dict, threshold: int) -> bool:
    return int(m.get("max_height", 0)) >= threshold


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)

    ap.add_argument("--trainer-version", default="web-ft5-0.2.0")
    ap.add_argument("--winner", choices=["human", "ai", "any"], default="human")

    ap.add_argument("--max-holes", type=int, default=20)
    ap.add_argument("--max-height", type=int, default=18)
    ap.add_argument("--max-bumpiness", type=int, default=55)
    ap.add_argument("--max-total-height", type=int, default=105)
    ap.add_argument("--max-pending-garbage", type=int, default=8)
    ap.add_argument("--min-round-length", type=int, default=8)

    ap.add_argument("--max-avg-holes", type=float, default=-1)
    ap.add_argument("--max-avg-height", type=float, default=-1)
    ap.add_argument("--max-bad-state-ratio", type=float, default=-1)
    ap.add_argument("--reject-topout-nearby", action="store_true")
    ap.add_argument("--near-topout-height", type=int, default=18)

    ap.add_argument("--allow-old-version", action="store_true")
    ap.add_argument("--allow-dirty", action="store_true")
    args = ap.parse_args()

    inp = Path(args.input)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    records, skipped = load_records(inp)

    by_round = defaultdict(list)
    for line_no, rec in records:
        by_round[record_round_key(rec)].append((line_no, rec))

    round_rejections = Counter()
    rejected_rounds = set()

    for rkey, rows in by_round.items():
        if len(rows) < args.min_round_length:
            rejected_rounds.add(rkey)
            round_rejections["round_too_short"] += 1
            continue

        holes_sum = 0.0
        h_sum = 0.0
        bad_states = 0

        for _line_no, rec in rows:
            state = rec.get("state") if isinstance(rec.get("state"), dict) else {}
            m = metrics(board_rows(state))
            holes_sum += m["holes"]
            h_sum += m["max_height"]

            pending = int(state.get("pendingGarbage", state.get("pending_garbage", 0)) or 0)
            if (
                m["holes"] > args.max_holes
                or m["max_height"] > args.max_height
                or m["bumpiness"] > args.max_bumpiness
                or m["total_height"] > args.max_total_height
                or pending > args.max_pending_garbage
            ):
                bad_states += 1

        count = len(rows)
        avg_holes = holes_sum / count if count else 0
        avg_height = h_sum / count if count else 0
        bad_ratio = bad_states / count if count else 0

        if args.max_avg_holes >= 0 and avg_holes > args.max_avg_holes:
            rejected_rounds.add(rkey)
            round_rejections["round_avg_holes"] += 1
            continue
        if args.max_avg_height >= 0 and avg_height > args.max_avg_height:
            rejected_rounds.add(rkey)
            round_rejections["round_avg_height"] += 1
            continue
        if args.max_bad_state_ratio >= 0 and bad_ratio > args.max_bad_state_ratio:
            rejected_rounds.add(rkey)
            round_rejections["round_bad_state_ratio"] += 1
            continue

    kept = 0
    examples_skipped = []
    kept_rounds = set()

    with out.open("w", encoding="utf-8") as g:
        for line_no, rec in records:
            reason = None
            rkey = record_round_key(rec)

            if rkey in rejected_rounds:
                reason = "round_rejected"

            if reason is None and not args.allow_old_version and rec.get("trainer_version") != args.trainer_version:
                reason = "trainer_version"

            if reason is None and args.winner != "any" and rec.get("round_winner") != args.winner:
                reason = "winner"

            state = rec.get("state") if isinstance(rec.get("state"), dict) else {}
            m = metrics(board_rows(state))
            pending = int(state.get("pendingGarbage", state.get("pending_garbage", 0)) or 0)
            result = rec.get("result") if isinstance(rec.get("result"), dict) else {}
            topout = bool(result.get("topout"))

            after_state = rec.get("state_after") if isinstance(rec.get("state_after"), dict) else None
            after_m = metrics(board_rows(after_state)) if after_state is not None else None

            if reason is None and not args.allow_dirty:
                if m["holes"] > args.max_holes:
                    reason = "holes"
                elif m["max_height"] > args.max_height:
                    reason = "height"
                elif m["bumpiness"] > args.max_bumpiness:
                    reason = "bumpiness"
                elif m["total_height"] > args.max_total_height:
                    reason = "total_height"
                elif pending > args.max_pending_garbage:
                    reason = "pending_garbage"
                elif topout:
                    reason = "topout"
                elif args.reject_topout_nearby and is_near_topout(m, args.near_topout_height):
                    reason = "near_topout"

                if reason is None and after_m is not None:
                    if after_m["holes"] > args.max_holes + 1:
                        reason = "after_holes"
                    elif after_m["max_height"] > args.max_height + 1:
                        reason = "after_height"
                    elif after_m["bumpiness"] > args.max_bumpiness + 6:
                        reason = "after_bumpiness"
                    elif after_m["total_height"] > args.max_total_height + 10:
                        reason = "after_total_height"
                    elif args.reject_topout_nearby and is_near_topout(after_m, args.near_topout_height):
                        reason = "after_near_topout"

            if reason is not None:
                skipped[reason] += 1
                if len(examples_skipped) < 30:
                    examples_skipped.append({
                        "line_no": line_no,
                        "reason": reason,
                        "trainer_version": rec.get("trainer_version"),
                        "winner": rec.get("round_winner"),
                        "round_len": len(by_round.get(rkey, [])),
                        "holes": m["holes"],
                        "height": m["max_height"],
                        "total_height": m["total_height"],
                        "bumpiness": m["bumpiness"],
                        "pending": pending,
                    })
                continue

            g.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
            kept += 1
            kept_rounds.add(rkey)

    meta = {
        "input": str(inp),
        "out": str(out),
        "input_rows": len(records),
        "kept_rows": kept,
        "skipped_by_reason": dict(skipped),
        "input_rounds": len(by_round),
        "kept_rounds": len(kept_rounds),
        "rejected_rounds": len(rejected_rounds),
        "rejected_rounds_by_reason": dict(round_rejections),
        "config": {
            "trainer_version": args.trainer_version,
            "winner": args.winner,
            "max_holes": args.max_holes,
            "max_height": args.max_height,
            "max_bumpiness": args.max_bumpiness,
            "max_total_height": args.max_total_height,
            "max_pending_garbage": args.max_pending_garbage,
            "min_round_length": args.min_round_length,
            "max_avg_holes": args.max_avg_holes,
            "max_avg_height": args.max_avg_height,
            "max_bad_state_ratio": args.max_bad_state_ratio,
            "reject_topout_nearby": args.reject_topout_nearby,
            "near_topout_height": args.near_topout_height,
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
