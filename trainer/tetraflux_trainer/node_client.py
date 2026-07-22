from __future__ import annotations

from pathlib import Path
from subprocess import PIPE, Popen
from threading import Lock
from typing import Any, Mapping, Sequence
from uuid import uuid4
import json
import os

from .protocol import EvaluationConfig, PROTOCOL_VERSION


class NodeTrainerError(RuntimeError):
    """Raised when the headless Node simulator rejects a request or exits."""


def default_repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


class NodeTrainerClient:
    def __init__(
        self,
        repo_root: str | Path | None = None,
        node_executable: str | None = None,
    ) -> None:
        self.repo_root = Path(repo_root or default_repo_root()).resolve()
        self.node_executable = node_executable or os.environ.get("TETRAFLUX_NODE", "node")
        self._process: Popen[str] | None = None
        self._lock = Lock()

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def start(self) -> dict[str, Any]:
        if self.running:
            return self.ping()
        launcher = self.repo_root / "tools" / "run_headless_training_server.mjs"
        if not launcher.is_file():
            raise NodeTrainerError(f"Node simulator launcher not found: {launcher}")
        self._process = Popen(
            [self.node_executable, str(launcher)],
            cwd=self.repo_root,
            stdin=PIPE,
            stdout=PIPE,
            stderr=None,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        result = self.ping()
        version = int(result.get("protocolVersion", -1))
        if version != PROTOCOL_VERSION:
            self.close()
            raise NodeTrainerError(
                f"Protocol mismatch: Python={PROTOCOL_VERSION}, Node={version}"
            )
        return result

    def close(self) -> None:
        process = self._process
        self._process = None
        if process is None:
            return
        if process.poll() is None:
            try:
                self._request_with_process(process, "shutdown", {})
            except Exception:
                process.terminate()
        try:
            process.wait(timeout=5)
        except Exception:
            process.kill()

    def __enter__(self) -> "NodeTrainerClient":
        self.start()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.close()

    def ping(self) -> dict[str, Any]:
        return self.request("ping")

    def describe(self) -> dict[str, Any]:
        return self.request("describe")

    def evaluate_flat(
        self,
        weights: Mapping[str, float],
        config: EvaluationConfig,
    ) -> dict[str, Any]:
        payload = config.to_payload()
        payload["weights"] = dict(weights)
        return self.request("evaluate_flat", payload)

    def evaluate_flat_population(
        self,
        candidates: Sequence[Mapping[str, Any]],
        config: EvaluationConfig,
    ) -> dict[str, Any]:
        payload = config.to_payload()
        payload["candidates"] = [dict(candidate) for candidate in candidates]
        return self.request("evaluate_flat_population", payload)

    def request(self, request_type: str, payload: Mapping[str, Any] | None = None) -> dict[str, Any]:
        if not self.running:
            self.start()
        process = self._process
        if process is None:
            raise NodeTrainerError("Node simulator did not start")
        return self._request_with_process(process, request_type, payload or {})

    def _request_with_process(
        self,
        process: Popen[str],
        request_type: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        with self._lock:
            if process.poll() is not None:
                raise NodeTrainerError(
                    f"Node simulator exited with code {process.returncode}"
                )
            if process.stdin is None or process.stdout is None:
                raise NodeTrainerError("Node simulator pipes are unavailable")
            request_id = uuid4().hex
            request = {"id": request_id, "type": request_type, "payload": dict(payload)}
            try:
                process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
                process.stdin.flush()
                line = process.stdout.readline()
            except (BrokenPipeError, OSError) as error:
                raise NodeTrainerError(f"Node simulator pipe failed: {error}") from error
            if not line:
                code = process.poll()
                raise NodeTrainerError(f"Node simulator closed the protocol pipe (exit={code})")
            try:
                response = json.loads(line)
            except json.JSONDecodeError as error:
                raise NodeTrainerError(f"Invalid JSON from Node simulator: {line[:240]}") from error
            if not isinstance(response, dict):
                raise NodeTrainerError("Node simulator response must be an object")
            if str(response.get("id")) != request_id:
                raise NodeTrainerError("Node simulator response ID did not match the request")
            if not response.get("ok"):
                detail = response.get("error")
                if isinstance(detail, dict):
                    message = str(detail.get("message", "Node simulator request failed"))
                else:
                    message = "Node simulator request failed"
                raise NodeTrainerError(message)
            result = response.get("result")
            if not isinstance(result, dict):
                raise NodeTrainerError("Node simulator result must be an object")
            return result
