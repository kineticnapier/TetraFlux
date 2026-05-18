#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any

import torch
from torch import nn


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


def sha12(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def module_to_layers(model: ValueMLP) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in model.net:
        if isinstance(m, nn.Linear):
            out.append({
                "type": "linear",
                "weight": m.weight.detach().cpu().tolist(),
                "bias": m.bias.detach().cpu().tolist(),
            })
        elif isinstance(m, nn.ReLU):
            out.append({"type": "relu"})
        else:
            raise TypeError(f"unsupported layer: {type(m)}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--summary", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model-name", default="selfplay_value")
    args = ap.parse_args()

    ckpt_path = Path(args.checkpoint)
    ckpt = torch.load(ckpt_path, map_location="cpu")
    input_dim = int(ckpt["input_dim"])
    hidden = [int(x) for x in ckpt["hidden"]]
    model = ValueMLP(input_dim, hidden)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    summary = None
    if args.summary and Path(args.summary).exists():
        summary = json.loads(Path(args.summary).read_text(encoding="utf-8"))

    exported_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    model_id = f"{args.model_name}_{exported_at}_{sha12(ckpt_path)}"

    obj = {
        "format": "tetraflux_web_value_json_v1",
        "feature_version": "selfplay_value_v1",
        "model_id": model_id,
        "model_name": args.model_name,
        "exported_at": exported_at,
        "checkpoint_sha256_12": sha12(ckpt_path),
        "training_summary": summary,
        "input_dim": input_dim,
        "layers": module_to_layers(model),
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"out": str(out), "model_id": model_id, "input_dim": input_dim}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
