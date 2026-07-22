from __future__ import annotations

from pathlib import Path
from threading import Lock
from typing import Any
import atexit
import os

from .node_client import NodeTrainerClient, NodeTrainerError, default_repo_root
from .protocol import EvaluationConfig, extract_flat_weights, read_json_file
from .run_store import RunStore

_CLIENT: NodeTrainerClient | None = None
_CLIENT_LOCK = Lock()


def _client() -> NodeTrainerClient:
    global _CLIENT
    with _CLIENT_LOCK:
        if _CLIENT is None:
            _CLIENT = NodeTrainerClient()
        _CLIENT.start()
        return _CLIENT


def _close_client() -> None:
    global _CLIENT
    with _CLIENT_LOCK:
        if _CLIENT is not None:
            _CLIENT.close()
            _CLIENT = None


atexit.register(_close_client)


def connect_simulator() -> tuple[str, dict[str, Any]]:
    try:
        client = _client()
        description = client.describe()
        return "Connected to the local Node simulator.", description
    except Exception as error:
        return f"Connection failed: {error}", {}


def disconnect_simulator() -> tuple[str, dict[str, Any]]:
    _close_client()
    return "Simulator stopped.", {}


def evaluate_flat_profile(
    profile_path: str | None,
    use_defaults: bool,
    games: int,
    max_pieces: int,
    seed_base: int,
) -> tuple[str, dict[str, Any]]:
    try:
        client = _client()
        if use_defaults:
            description = client.describe()
            flat = description.get("flat")
            if not isinstance(flat, dict) or not isinstance(flat.get("defaultWeights"), dict):
                raise NodeTrainerError("Simulator did not provide default Flat weights")
            weights = {str(key): float(value) for key, value in flat["defaultWeights"].items()}
            source = "built-in Flat defaults"
        else:
            if not profile_path:
                raise ValueError("Select a Flat profile JSON file or enable built-in defaults")
            weights = extract_flat_weights(read_json_file(profile_path))
            source = str(Path(profile_path).name)

        config = EvaluationConfig(
            games=max(1, int(games)),
            max_pieces=max(1, int(max_pieces)),
            seed_base=int(seed_base) & 0xFFFFFFFF,
        )
        run_store = RunStore(default_repo_root() / "trainer" / "data" / "runs")
        run = run_store.create(
            "flat-evaluation",
            {
                "source": source,
                "evaluation": config.to_payload(),
                "weights": weights,
            },
        )
        result = client.evaluate_flat(weights, config)
        run.save_result(result)
        aggregate = result.get("aggregate", {}) if isinstance(result, dict) else {}
        run.append_metric(
            {
                "type": "evaluation_complete",
                "fitness": aggregate.get("fitness"),
                "survivalRate": aggregate.get("survivalRate"),
                "attackPerPiece": aggregate.get("attackPerPiece"),
            }
        )
        return f"Evaluation complete. Saved to `{run.path}`.", result
    except Exception as error:
        return f"Evaluation failed: {error}", {}


def build_app() -> Any:
    try:
        import gradio as gr
    except ImportError as error:
        raise RuntimeError(
            "Gradio is not installed. Run: python -m pip install -e 'trainer[ui]'"
        ) from error

    with gr.Blocks(title="TetraFlux Python Trainer") as app:
        gr.Markdown(
            "# TetraFlux Python Trainer\n"
            "The game engine remains in TypeScript. Python controls experiments, files, and future learning algorithms through a local JSONL simulator process."
        )

        with gr.Row():
            connect_button = gr.Button("Connect simulator", variant="primary")
            disconnect_button = gr.Button("Stop simulator")
        connection_status = gr.Markdown("Simulator not started.")
        simulator_description = gr.JSON(label="Simulator capabilities")

        with gr.Tab("Flat evaluation"):
            profile_file = gr.File(
                label="Flat profile or local model envelope",
                file_types=[".json"],
                type="filepath",
            )
            use_defaults = gr.Checkbox(label="Use built-in Flat weights", value=True)
            with gr.Row():
                games = gr.Number(label="Games", value=4, precision=0, minimum=1)
                max_pieces = gr.Number(label="Max pieces", value=200, precision=0, minimum=1)
                seed_base = gr.Number(label="Seed base", value=1, precision=0, minimum=0)
            evaluate_button = gr.Button("Evaluate", variant="primary")
            evaluation_status = gr.Markdown()
            evaluation_result = gr.JSON(label="Evaluation result")

        with gr.Tab("Next algorithms"):
            gr.Markdown(
                "The protocol boundary is ready for Python CEM, imitation datasets, Gymnasium environments, action masking, neural value models, and reinforcement learning. "
                "Those algorithms will be added without moving the browser game UI into Python."
            )

        connect_button.click(
            connect_simulator,
            outputs=[connection_status, simulator_description],
        )
        disconnect_button.click(
            disconnect_simulator,
            outputs=[connection_status, simulator_description],
        )
        evaluate_button.click(
            evaluate_flat_profile,
            inputs=[profile_file, use_defaults, games, max_pieces, seed_base],
            outputs=[evaluation_status, evaluation_result],
        )

    return app


def main() -> None:
    app = build_app()
    port = int(os.environ.get("TETRAFLUX_TRAINER_PORT", "7860"))
    app.launch(server_name="127.0.0.1", server_port=port, inbrowser=True, share=False)


if __name__ == "__main__":
    main()
