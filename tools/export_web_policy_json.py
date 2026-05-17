#!/usr/bin/env python3
"""
export_web_policy_json.py

Export tools/train_web_policy.py checkpoint (.pt) to browser-readable JSON.

Usage:
  python tools/export_web_policy_json.py ^
    --checkpoint models/web_human_policy/best_policy.pt ^
    --out public/models/web_policy.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch


def tensor_to_nested_list(t):
    return t.detach().cpu().tolist()


def require_key(state, key: str):
    if key not in state:
        raise KeyError(f"Missing state_dict key: {key}")
    return state[key]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    state = ckpt["model_state"]

    layers = [
        {"type": "linear", "weight": tensor_to_nested_list(require_key(state, "net.0.weight")), "bias": tensor_to_nested_list(require_key(state, "net.0.bias"))},
        {"type": "relu"},
        {"type": "layernorm", "weight": tensor_to_nested_list(require_key(state, "net.2.weight")), "bias": tensor_to_nested_list(require_key(state, "net.2.bias")), "eps": 1e-5},
        {"type": "linear", "weight": tensor_to_nested_list(require_key(state, "net.4.weight")), "bias": tensor_to_nested_list(require_key(state, "net.4.bias"))},
        {"type": "relu"},
        {"type": "layernorm", "weight": tensor_to_nested_list(require_key(state, "net.6.weight")), "bias": tensor_to_nested_list(require_key(state, "net.6.bias")), "eps": 1e-5},
        {"type": "linear", "weight": tensor_to_nested_list(require_key(state, "net.8.weight")), "bias": tensor_to_nested_list(require_key(state, "net.8.bias"))},
        {"type": "relu"},
        {"type": "layernorm", "weight": tensor_to_nested_list(require_key(state, "net.10.weight")), "bias": tensor_to_nested_list(require_key(state, "net.10.bias")), "eps": 1e-5},
        {"type": "linear", "weight": tensor_to_nested_list(require_key(state, "net.12.weight")), "bias": tensor_to_nested_list(require_key(state, "net.12.bias"))},
    ]

    data = {
        "format": "tetraflux_web_policy_json_v1",
        "feature_version": ckpt.get("feature_version", "web_policy_v1"),
        "input_dim": int(ckpt["input_dim"]),
        "num_actions": int(ckpt["num_actions"]),
        "actions": ckpt["actions"],
        "x_range": ckpt.get("x_range"),
        "pieces": ckpt.get("pieces"),
        "layers": layers,
        "source_checkpoint": args.checkpoint,
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(json.dumps({
        "out": str(out),
        "input_dim": data["input_dim"],
        "num_actions": data["num_actions"],
        "size_mb": round(out.stat().st_size / (1024 * 1024), 3),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
