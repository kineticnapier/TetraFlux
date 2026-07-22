from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
import json

PROTOCOL_VERSION = 1
FLAT_PROFILE_FORMAT = "tetraflux_heuristic_weights_v1"
MODEL_ENVELOPE_FORMAT = "tetraflux_model_envelope_v1"


@dataclass(frozen=True, slots=True)
class EvaluationConfig:
    games: int = 4
    max_pieces: int = 200
    seed_base: int = 1
    seeds: tuple[int, ...] | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "games": max(1, int(self.games)),
            "maxPieces": max(1, int(self.max_pieces)),
            "seedBase": int(self.seed_base) & 0xFFFFFFFF,
        }
        if self.seeds:
            payload["seeds"] = [int(seed) & 0xFFFFFFFF for seed in self.seeds]
            payload["games"] = len(self.seeds)
        return payload


def read_json_file(path: str | Path) -> Any:
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def extract_flat_profile(document: Any) -> dict[str, Any]:
    if not isinstance(document, Mapping):
        raise ValueError("Profile JSON must contain an object")

    raw: Mapping[str, Any] = document
    if raw.get("format") == MODEL_ENVELOPE_FORMAT:
        if raw.get("family") != "flat":
            raise ValueError("Selected model envelope is not a Flat model")
        payload = raw.get("payload")
        if not isinstance(payload, Mapping):
            raise ValueError("Model envelope payload is missing")
        raw = payload

    if raw.get("format") != FLAT_PROFILE_FORMAT:
        raise ValueError(f"Unsupported Flat profile format: {raw.get('format', 'missing')}")
    weights = raw.get("weights")
    if not isinstance(weights, Mapping):
        raise ValueError("Flat profile weights are missing")
    return dict(raw)


def extract_flat_weights(document: Any) -> dict[str, float]:
    profile = extract_flat_profile(document)
    weights = profile["weights"]
    return {str(key): float(value) for key, value in weights.items()}
