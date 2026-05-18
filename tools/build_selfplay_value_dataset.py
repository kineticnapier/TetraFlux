#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable

PIECES = ["I", "J", "L", "O", "S", "T", "Z"]

def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    files = sorted(path.rglob("*.jsonl")) if path.is_dir() else [path]
    for file in files:
        with file.open("r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as e:
                    raise SystemExit(f"{file}:{line_no}: bad json: {e}") from e

def board_to_bits(rows: list[str]) -> list[int]:
    out: list[int] = []
    rows = (["." * 10] * 20 + rows)[-20:]
    for row in rows:
        out.extend(0 if c == "." else 1 for c in row[:10])
    return out

def onehot(piece: str | None) -> list[int]:
    return [1 if piece == p else 0 for p in PIECES]

def features(state: dict[str, Any], action: dict[str, Any]) -> list[float]:
    board = state.get("board") or ["." * 10] * 20
    active = state.get("active") or {}
    queue = state.get("queue") or []
    feats: list[float] = [float(x) for x in board_to_bits(board)]
    feats += [float(x) for x in onehot(active.get("kind"))]
    feats += [float(x) for x in onehot(state.get("hold"))]
    for i in range(6):
        feats += [float(x) for x in onehot(queue[i] if i < len(queue) else None)]
    feats += [
        1.0 if state.get("canHold") else 0.0,
        float(state.get("pendingGarbage") or 0) / 20.0,
        float(state.get("combo") or -1) / 20.0,
        float(state.get("b2b") or 0) / 20.0,
        float(action.get("x") or 0) / 10.0,
        float(action.get("rot") or 0) / 4.0,
        1.0 if action.get("hold") else 0.0,
    ]
    feats += [float(x) for x in onehot(action.get("piece"))]
    return feats

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--terminal-scale", type=float, default=1.0)
    ap.add_argument("--immediate-scale", type=float, default=1.0)
    ap.add_argument("--max-abs-target", type=float, default=150.0)
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    n = pos = neg = 0
    with out.open("w", encoding="utf-8") as f:
        for rec in iter_jsonl(Path(args.input)):
            if rec.get("source") != "web_ft5_ai_battle":
                continue
            side = rec.get("side")
            winner = rec.get("round_winner")
            terminal = rec.get("terminal_reward")
            if terminal is None:
                terminal = 100.0 if winner == side else -100.0 if winner in ("left", "right") else 0.0
            immediate = float(rec.get("immediate_reward") or 0.0)
            target = immediate * args.immediate_scale + float(terminal) * args.terminal_scale
            target = max(-args.max_abs_target, min(args.max_abs_target, target))
            if target > 0: pos += 1
            elif target < 0: neg += 1
            row = {
                "features": features(rec["state"], rec["action"]),
                "target": target,
                "immediate_reward": immediate,
                "terminal_reward": terminal,
                "side": side,
                "round_winner": winner,
                "action_key": rec.get("action", {}).get("key"),
                "left_ai_name": rec.get("left_ai_name"),
                "right_ai_name": rec.get("right_ai_name"),
                "match_id": rec.get("match_id"),
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            n += 1
    feature_dim = None
    with out.open("r", encoding="utf-8") as f:
        first = f.readline().strip()
        if first:
            feature_dim = len(json.loads(first)["features"])
    meta = {"input": args.input, "out": str(out), "n": n, "positive_targets": pos, "negative_targets": neg, "feature_dim": feature_dim}
    out.with_suffix(out.suffix + ".meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
