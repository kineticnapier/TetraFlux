#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


class ValueMLP(nn.Module):
    def __init__(self, input_dim: int, hidden: list[int]):
        super().__init__()
        layers: list[nn.Module] = []
        prev = input_dim
        for h in hidden:
            layers.append(nn.Linear(prev, h))
            layers.append(nn.ReLU())
            prev = h
        layers.append(nn.Linear(prev, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


def load_dataset(path: Path) -> tuple[np.ndarray, np.ndarray]:
    xs: list[list[float]] = []
    ys: list[float] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            obj: dict[str, Any] = json.loads(line)
            xs.append([float(v) for v in obj["features"]])
            ys.append(float(obj["target"]))
    if not xs:
        raise SystemExit("empty dataset")
    return np.asarray(xs, dtype=np.float32), np.asarray(ys, dtype=np.float32)


def split_indices(n: int, seed: int) -> tuple[list[int], list[int], list[int]]:
    idx = list(range(n))
    random.Random(seed).shuffle(idx)
    n_test = max(1, int(n * 0.10))
    n_val = max(1, int(n * 0.10))
    test = idx[:n_test]
    val = idx[n_test:n_test + n_val]
    train = idx[n_test + n_val:]
    return train, val, test


def eval_model(model: nn.Module, x: torch.Tensor, y: torch.Tensor, device: str) -> dict[str, float]:
    model.eval()
    with torch.no_grad():
        pred = model(x.to(device)).cpu()
    err = pred - y
    return {
        "mse": float(torch.mean(err * err).item()),
        "mae": float(torch.mean(torch.abs(err)).item()),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch-size", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hidden", default="256,128")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)

    x_np, y_np = load_dataset(Path(args.data))
    input_dim = int(x_np.shape[1])
    hidden = [int(s) for s in args.hidden.split(",") if s.strip()]

    train_idx, val_idx, test_idx = split_indices(len(x_np), args.seed)
    x = torch.tensor(x_np)
    y = torch.tensor(y_np)

    train_ds = TensorDataset(x[train_idx], y[train_idx])
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)

    device = args.device
    model = ValueMLP(input_dim, hidden).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    loss_fn = nn.SmoothL1Loss(beta=10.0)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    best_path = out_dir / "best_value.pt"
    best_val = float("inf")
    best_epoch = -1

    for epoch in range(1, args.epochs + 1):
        model.train()
        total = 0.0
        count = 0
        for xb, yb in train_loader:
            xb = xb.to(device)
            yb = yb.to(device)
            opt.zero_grad(set_to_none=True)
            pred = model(xb)
            loss = loss_fn(pred, yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 3.0)
            opt.step()
            total += float(loss.item()) * len(xb)
            count += len(xb)

        val = eval_model(model, x[val_idx], y[val_idx], device)
        train_loss = total / max(1, count)
        print(json.dumps({"epoch": epoch, "train_loss": train_loss, "val_mae": val["mae"], "val_mse": val["mse"]}))
        if val["mae"] < best_val:
            best_val = val["mae"]
            best_epoch = epoch
            torch.save({
                "model_state": model.state_dict(),
                "input_dim": input_dim,
                "hidden": hidden,
                "seed": args.seed,
            }, best_path)

    ckpt = torch.load(best_path, map_location=device)
    model.load_state_dict(ckpt["model_state"])
    test = eval_model(model, x[test_idx], y[test_idx], device)
    val = eval_model(model, x[val_idx], y[val_idx], device)

    summary = {
        "best_epoch": best_epoch,
        "best_val_mae": best_val,
        "checkpoint": str(best_path),
        "input_dim": input_dim,
        "hidden": hidden,
        "device": device,
        "train_n": len(train_idx),
        "val_n": len(val_idx),
        "test_n": len(test_idx),
        "val_mae": val["mae"],
        "val_mse": val["mse"],
        "test_mae": test["mae"],
        "test_mse": test["mse"],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
