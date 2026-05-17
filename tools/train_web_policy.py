#!/usr/bin/env python3
"""
train_web_policy.py

Train a supervised imitation policy from TetraFlux Web FT5 dataset.

Input:
  data/web_human_dataset.jsonl
created by:
  tools/build_web_dataset.py

Usage:
  python tools/train_web_policy.py ^
    --data data/web_human_dataset.jsonl ^
    --out-dir models/web_human_policy ^
    --epochs 50 ^
    --device auto

Output:
  models/web_human_policy/best_policy.pt
  models/web_human_policy/summary.json
  models/web_human_policy/actions.json
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import torch
from torch import nn
from torch.utils.data import Dataset, DataLoader


PIECES = ["I", "J", "L", "O", "S", "T", "Z"]
PIECE_TO_IDX = {p: i for i, p in enumerate(PIECES)}
X_RANGE = list(range(-3, 13))


def build_actions() -> list[str]:
    actions: list[str] = []
    for hold in [False, True]:
        for p in PIECES:
            for x in X_RANGE:
                for rot in range(4):
                    actions.append(f"{'H:' if hold else ''}{p}:{x}:{rot}")
    return actions


ACTIONS = build_actions()
ACTION_TO_IDX = {a: i for i, a in enumerate(ACTIONS)}


def onehot_piece(piece: Any) -> list[float]:
    out = [0.0] * len(PIECES)
    p = str(piece).upper() if piece is not None else ""
    if p in PIECE_TO_IDX:
        out[PIECE_TO_IDX[p]] = 1.0
    return out


def normalize_board(board: Any) -> list[str]:
    if not isinstance(board, list):
        board = []
    rows = [str(r) for r in board]
    rows = rows[-20:]
    if len(rows) < 20:
        rows = ["." * 10 for _ in range(20 - len(rows))] + rows
    return [(r + "." * 10)[:10] for r in rows]


def board_metrics(board_rows: list[str]) -> dict[str, Any]:
    heights = []
    holes = 0
    blocks = 0

    for x in range(10):
        height = 0
        seen = False
        for top_i, row in enumerate(board_rows):
            y = 19 - top_i
            filled = row[x] != "."
            if filled:
                blocks += 1
                seen = True
                height = max(height, y + 1)
            elif seen:
                holes += 1
        heights.append(height)

    bumpiness = sum(abs(a - b) for a, b in zip(heights, heights[1:]))
    total_height = sum(heights)
    max_height = max(heights) if heights else 0

    wells = 0
    for i, h in enumerate(heights):
        left = heights[i - 1] if i > 0 else 20
        right = heights[i + 1] if i < 9 else 20
        wells += max(0, min(left, right) - h)

    return {
        "blocks": blocks,
        "holes": holes,
        "heights": heights,
        "bumpiness": bumpiness,
        "total_height": total_height,
        "max_height": max_height,
        "wells": wells,
    }


def featurize_state(state: dict[str, Any]) -> list[float]:
    board = normalize_board(state.get("board"))
    feats: list[float] = []

    # Board occupancy, top-to-bottom visible 20x10.
    for row in board:
        for c in row:
            feats.append(0.0 if c == "." else 1.0)

    active = state.get("active") if isinstance(state.get("active"), dict) else {}
    feats.extend(onehot_piece(active.get("kind")))

    feats.extend(onehot_piece(state.get("hold")))

    queue = state.get("queue")
    if not isinstance(queue, list):
        queue = []
    for i in range(6):
        feats.extend(onehot_piece(queue[i] if i < len(queue) else None))

    feats.append(1.0 if state.get("canHold", state.get("can_hold", True)) else 0.0)

    metrics = board_metrics(board)
    # Small normalized scalar features.
    feats.append(metrics["holes"] / 200.0)
    feats.append(metrics["total_height"] / 200.0)
    feats.append(metrics["max_height"] / 20.0)
    feats.append(metrics["bumpiness"] / 100.0)
    feats.append(metrics["wells"] / 100.0)

    # Engine state extras if present.
    feats.append(float(state.get("pendingGarbage", state.get("pending_garbage", 0)) or 0) / 20.0)
    feats.append(float(state.get("combo", -1) or -1) / 20.0)
    feats.append(float(state.get("b2b", 0) or 0) / 20.0)

    return feats


def action_key(action: dict[str, Any]) -> str | None:
    try:
        p = str(action["piece"]).upper()
        x = int(action["x"])
        r = int(action["rot"]) % 4
        h = bool(action.get("hold", False))
        key = f"{'H:' if h else ''}{p}:{x}:{r}"
        return key if key in ACTION_TO_IDX else None
    except Exception:
        return None


def parse_action_key(key: str) -> tuple[bool, str, int, int] | None:
    try:
        hold = key.startswith("H:")
        body = key[2:] if hold else key
        p, x, r = body.split(":")
        return hold, p, int(x), int(r) % 4
    except Exception:
        return None


class WebPolicyDataset(Dataset):
    def __init__(self, path: str | Path, split: str):
        self.rows: list[dict[str, Any]] = []
        path = Path(path)
        with path.open("r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("split") != split:
                    continue

                state = row.get("state")
                action = row.get("action")
                if not isinstance(state, dict) or not isinstance(action, dict):
                    continue

                key = action.get("key")
                if not isinstance(key, str):
                    key = action_key(action)
                if key not in ACTION_TO_IDX:
                    continue

                self.rows.append({
                    "x": featurize_state(state),
                    "y": ACTION_TO_IDX[key],
                    "action": key,
                })

        if not self.rows:
            raise ValueError(f"No usable rows for split={split} in {path}")

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int):
        row = self.rows[idx]
        return (
            torch.tensor(row["x"], dtype=torch.float32),
            torch.tensor(int(row["y"]), dtype=torch.long),
        )


class WebPolicyNet(nn.Module):
    def __init__(self, input_dim: int, num_actions: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 512),
            nn.ReLU(),
            nn.LayerNorm(512),
            nn.Dropout(0.10),
            nn.Linear(512, 384),
            nn.ReLU(),
            nn.LayerNorm(384),
            nn.Dropout(0.08),
            nn.Linear(384, 256),
            nn.ReLU(),
            nn.LayerNorm(256),
            nn.Dropout(0.05),
            nn.Linear(256, num_actions),
        )

    def forward(self, x):
        return self.net(x)


def choose_device(device: str) -> str:
    if device == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return device


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, device: str) -> dict[str, Any]:
    model.eval()
    total = 0
    loss_sum = 0.0
    top1 = 0
    top5 = 0
    piece_acc = 0
    rot_acc = 0
    x_acc = 0
    hold_acc = 0
    soft_x1 = 0

    crit = nn.CrossEntropyLoss(reduction="sum")

    for x, y in loader:
        x = x.to(device)
        y = y.to(device)
        logits = model(x)
        loss_sum += float(crit(logits, y).item())

        pred = logits.argmax(dim=1)
        top = logits.topk(k=min(5, logits.shape[1]), dim=1).indices

        top1 += int((pred == y).sum().item())
        top5 += int((top == y[:, None]).any(dim=1).sum().item())
        total += int(y.numel())

        for pi, yi in zip(pred.detach().cpu().tolist(), y.detach().cpu().tolist()):
            pa = parse_action_key(ACTIONS[pi])
            ya = parse_action_key(ACTIONS[yi])
            if pa is None or ya is None:
                continue
            ph, pp, px, pr = pa
            yh, yp, yx, yr = ya
            hold_acc += int(ph == yh)
            piece_acc += int(pp == yp)
            rot_acc += int(pr == yr)
            x_acc += int(px == yx)
            soft_x1 += int(pp == yp and pr == yr and abs(px - yx) <= 1 and ph == yh)

    denom = max(1, total)
    return {
        "loss": loss_sum / denom,
        "top1": top1 / denom,
        "top5": top5 / denom,
        "soft_x1": soft_x1 / denom,
        "piece_acc": piece_acc / denom,
        "x_acc": x_acc / denom,
        "rot_acc": rot_acc / denom,
        "hold_acc": hold_acc / denom,
        "n": total,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Train TetraFlux Web FT5 imitation policy.")
    ap.add_argument("--data", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--batch-size", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--num-workers", type=int, default=0)
    args = ap.parse_args()

    device = choose_device(args.device)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    train_ds = WebPolicyDataset(args.data, "train")
    val_ds = WebPolicyDataset(args.data, "val")
    test_ds = WebPolicyDataset(args.data, "test")

    input_dim = len(train_ds.rows[0]["x"])
    model = WebPolicyNet(input_dim, len(ACTIONS)).to(device)

    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=(device == "cuda"),
    )
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, num_workers=args.num_workers)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size, num_workers=args.num_workers)

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    crit = nn.CrossEntropyLoss()

    best_score = -1.0
    best_epoch = -1
    best_path = out_dir / "best_policy.pt"
    history = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        total = 0

        for x, y in train_loader:
            x = x.to(device)
            y = y.to(device)

            opt.zero_grad(set_to_none=True)
            logits = model(x)
            loss = crit(logits, y)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

            total_loss += float(loss.item()) * int(y.numel())
            total += int(y.numel())

        val = evaluate(model, val_loader, device)
        rec = {
            "epoch": epoch,
            "train_loss": total_loss / max(1, total),
            "val": val,
        }
        history.append(rec)
        print(json.dumps(rec, ensure_ascii=False))

        # soft_x1 is often more useful than exact x for placement training.
        score = val["top1"] + 0.25 * val["soft_x1"]
        if score > best_score:
            best_score = score
            best_epoch = epoch
            torch.save({
                "model_state": model.state_dict(),
                "input_dim": input_dim,
                "num_actions": len(ACTIONS),
                "actions": ACTIONS,
                "x_range": X_RANGE,
                "pieces": PIECES,
                "data": args.data,
                "feature_version": "web_policy_v1",
            }, best_path)

    ckpt = torch.load(best_path, map_location=device)
    best_model = WebPolicyNet(ckpt["input_dim"], ckpt["num_actions"]).to(device)
    best_model.load_state_dict(ckpt["model_state"])
    test = evaluate(best_model, test_loader, device)

    summary = {
        "best_epoch": best_epoch,
        "best_score": best_score,
        "best_checkpoint": str(best_path),
        "test": test,
        "input_dim": input_dim,
        "num_actions": len(ACTIONS),
        "device": device,
        "train_n": len(train_ds),
        "val_n": len(val_ds),
        "test_n": len(test_ds),
        "data": args.data,
    }

    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "history.json").write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "actions.json").write_text(json.dumps(ACTIONS, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
