from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4
import json


def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, default=_json_default) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


@dataclass(slots=True)
class RunDirectory:
    path: Path

    @property
    def run_id(self) -> str:
        return self.path.name

    def save_config(self, config: Mapping[str, Any]) -> Path:
        target = self.path / "config.json"
        _write_json(target, dict(config))
        return target

    def save_result(self, result: Any, filename: str = "result.json") -> Path:
        target = self.path / filename
        _write_json(target, result)
        return target

    def append_metric(self, metric: Mapping[str, Any]) -> Path:
        target = self.path / "metrics.jsonl"
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **dict(metric),
        }
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, default=_json_default) + "\n")
        return target


class RunStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def create(self, kind: str, config: Mapping[str, Any]) -> RunDirectory:
        safe_kind = "".join(character if character.isalnum() or character in "-_" else "-" for character in kind).strip("-")
        if not safe_kind:
            safe_kind = "run"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        path = self.root / f"{timestamp}-{safe_kind}-{uuid4().hex[:6]}"
        path.mkdir(parents=True, exist_ok=False)
        run = RunDirectory(path)
        run.save_config(config)
        return run
