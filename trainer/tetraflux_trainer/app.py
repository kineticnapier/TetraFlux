from __future__ import annotations

from pathlib import Path
from typing import Any
import os
import subprocess
import sys

from tetraflux_engine import BOARD_HEIGHT, BOARD_WIDTH, HIDDEN_ROWS, PIECE_NAMES, VISIBLE_HEIGHT, Game

from .run_store import RunStore
from .simulation import run_random_batch


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def engine_description() -> dict[str, Any]:
    game = Game(seed=1)
    return {
        "engine": "pure-python",
        "board": {
            "width": BOARD_WIDTH,
            "visibleHeight": VISIBLE_HEIGHT,
            "hiddenRows": HIDDEN_ROWS,
            "totalHeight": BOARD_HEIGHT,
        },
        "pieces": list(PIECE_NAMES),
        "randomizer": "7-bag",
        "actions": [
            "left",
            "right",
            "soft_drop",
            "hard_drop",
            "rotate_cw",
            "rotate_ccw",
            "rotate_180",
            "hold",
            "direct placement",
        ],
        "initialQueue": list(game.snapshot().queue),
        "nodeRequired": False,
    }


def launch_pygame(seed: int | float | None, gravity_ms: int | float) -> str:
    command = [
        sys.executable,
        "-m",
        "tetraflux_trainer.game",
        "--gravity-ms",
        str(max(40, int(gravity_ms))),
    ]
    if seed is not None:
        command.extend(["--seed", str(int(seed))])
    try:
        subprocess.Popen(command, cwd=repo_root())
        return "Pygame window started."
    except Exception as error:
        return f"Failed to start Pygame: {error}"


def run_smoke_batch(games: int, max_pieces: int, seed_base: int) -> tuple[str, dict[str, Any]]:
    try:
        config = {
            "policy": "random-direct-placement",
            "games": max(1, int(games)),
            "maxPieces": max(1, int(max_pieces)),
            "seedBase": int(seed_base) & 0xFFFFFFFF,
        }
        store = RunStore(repo_root() / "trainer" / "data" / "runs")
        run = store.create("python-engine-smoke", config)
        result = run_random_batch(
            games=config["games"],
            max_pieces=config["maxPieces"],
            seed_base=config["seedBase"],
        )
        run.save_result(result)
        aggregate = result["aggregate"]
        run.append_metric({"type": "complete", **aggregate})
        return f"Simulation complete. Saved to `{run.path}`.", result
    except Exception as error:
        return f"Simulation failed: {error}", {}


def build_app() -> Any:
    try:
        import gradio as gr
    except ImportError as error:
        raise RuntimeError(
            "Gradio is not installed. Run: python -m pip install -e 'trainer[ui]'"
        ) from error

    with gr.Blocks(title="TetraFlux Python Lab") as app:
        gr.Markdown(
            "# TetraFlux Python Lab\n"
            "Game rules, Pygame rendering, experiment files, and future learning environments now run entirely in Python. Node is not required."
        )

        with gr.Tab("Game"):
            gr.JSON(value=engine_description(), label="Engine")
            with gr.Row():
                game_seed = gr.Number(label="Seed", value=1, precision=0)
                gravity_ms = gr.Number(label="Gravity interval (ms)", value=700, precision=0, minimum=40)
            launch_button = gr.Button("Open Pygame game", variant="primary")
            launch_status = gr.Markdown()
            gr.Markdown(
                "**Controls:** ←/→ move, ↓ soft drop, Z/X rotate, A 180°, C/Shift hold, Space hard drop, P pause, R restart."
            )

        with gr.Tab("Headless smoke simulation"):
            with gr.Row():
                games = gr.Number(label="Games", value=4, precision=0, minimum=1)
                max_pieces = gr.Number(label="Max pieces", value=200, precision=0, minimum=1)
                seed_base = gr.Number(label="Seed base", value=1, precision=0, minimum=0)
            simulate_button = gr.Button("Run pure-Python simulation", variant="primary")
            simulation_status = gr.Markdown()
            simulation_result = gr.JSON(label="Result")

        with gr.Tab("Planned learning"):
            gr.Markdown(
                "The engine already exposes direct legal placements for high-level agents. "
                "Next layers are a hand-written heuristic, Python CEM, Gymnasium action masking, imitation datasets, and neural reinforcement learning."
            )

        launch_button.click(
            launch_pygame,
            inputs=[game_seed, gravity_ms],
            outputs=launch_status,
        )
        simulate_button.click(
            run_smoke_batch,
            inputs=[games, max_pieces, seed_base],
            outputs=[simulation_status, simulation_result],
        )

    return app


def main() -> None:
    app = build_app()
    port = int(os.environ.get("TETRAFLUX_TRAINER_PORT", "7860"))
    app.launch(server_name="127.0.0.1", server_port=port, inbrowser=True, share=False)


if __name__ == "__main__":
    main()
