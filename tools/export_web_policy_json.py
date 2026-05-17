#!/usr/bin/env python3
"""
export_web_policy_json.py

Export tools/train_web_policy.py checkpoint (.pt) to browser-readable JSON.

The exported JSON includes metadata so the web UI can show exactly which model
is loaded:
- model_id
- model_name
- exported_at
- checkpoint_name
- checkpoint_mtime_utc
- checkpoint_sha256_12
- training_summary, if summary.json exists next to the checkpoint

Usage:
  python tools/export_web_policy_json.py ^
    --checkpoint models/web_human_policy_clean/best_policy.pt ^
    --out public/models/web_policy.json ^
    --model-name clean_v4
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path

import torch


def tensor_to_nested_list(t):
    return t.detach().cpu().tolist()


def require_key(state, key: str):
    if key not in state:
        raise KeyError(f"Missing state_dict key: {key}")
    return state[key]


def utc_iso_from_timestamp(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_id_part(s: str) -> str:
    out = []
    for ch in s:
        out.append(ch if (ch.isalnum() or ch in "-_") else "_")
    return "".join(out).strip("_") or "model"


def sha256_12(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def load_summary(checkpoint: Path):
    summary = checkpoint.parent / "summary.json"
    if not summary.exists():
        return None
    try:
        return json.loads(summary.read_text(encoding="utf-8"))
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model-id", default=None)
    ap.add_argument("--model-name", default=None)
    args = ap.parse_args()

    checkpoint = Path(args.checkpoint)
    ckpt = torch.load(checkpoint, map_location="cpu")
    state = ckpt["model_state"]

    checkpoint_sha = sha256_12(checkpoint)
    checkpoint_mtime_utc = utc_iso_from_timestamp(checkpoint.stat().st_mtime)
    exported_at = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    summary = load_summary(checkpoint)

    model_name = args.model_name or checkpoint.parent.name
    if args.model_id:
        model_id = safe_id_part(args.model_id)
    else:
        stamp = checkpoint_mtime_utc.replace("-", "").replace(":", "").replace("T", "_").replace("Z", "")
        model_id = safe_id_part(f"{model_name}_{stamp}_{checkpoint_sha}")

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
        "model_id": model_id,
        "model_name": model_name,
        "exported_at": exported_at,
        "checkpoint_name": checkpoint.name,
        "checkpoint_path": str(checkpoint),
        "checkpoint_mtime_utc": checkpoint_mtime_utc,
        "checkpoint_size_bytes": checkpoint.stat().st_size,
        "checkpoint_sha256_12": checkpoint_sha,
        "training_summary": summary,
        "input_dim": int(ckpt["input_dim"]),
        "num_actions": int(ckpt["num_actions"]),
        "actions": ckpt["actions"],
        "x_range": ckpt.get("x_range"),
        "pieces": ckpt.get("pieces"),
        "layers": layers,
        "source_checkpoint": str(checkpoint),
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(json.dumps({
        "out": str(out),
        "model_id": model_id,
        "model_name": model_name,
        "exported_at": exported_at,
        "checkpoint_name": checkpoint.name,
        "checkpoint_mtime_utc": checkpoint_mtime_utc,
        "checkpoint_sha256_12": checkpoint_sha,
        "input_dim": data["input_dim"],
        "num_actions": data["num_actions"],
        "size_mb": round(out.stat().st_size / (1024 * 1024), 3),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
