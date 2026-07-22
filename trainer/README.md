# TetraFlux Python Trainer

This directory contains the local Python-side experiment manager. The browser game and canonical simulation rules remain in TypeScript.

## Architecture

```text
Python / Gradio
  ├─ experiment configuration
  ├─ run folders and JSON files
  ├─ future CEM / imitation / RL algorithms
  └─ JSONL requests
          ↓ stdin/stdout
Persistent Node process
          ↓
Existing TypeScript TetrisEngine and evaluators
```

The first protocol version supports:

- `ping`
- `describe`
- `evaluate_flat`
- `evaluate_flat_population`
- `shutdown`

## Install and run

From the repository root on Windows:

```text
start-python-trainer.bat
```

Manual setup:

```powershell
py -3 -m venv trainer/.venv
trainer/.venv/Scripts/python -m pip install -e "trainer[ui]"
trainer/.venv/Scripts/python -m tetraflux_trainer.app
```

The Gradio UI opens on `http://127.0.0.1:7860/`.

## CLI checks

```powershell
trainer/.venv/Scripts/python -m tetraflux_trainer ping
trainer/.venv/Scripts/python -m tetraflux_trainer describe
trainer/.venv/Scripts/python -m tetraflux_trainer evaluate-flat path/to/profile.json --games 4 --max-pieces 200
```

The Node service can also be run directly:

```powershell
npm run trainer:server
```

It reads one JSON request per line from stdin and writes one JSON response per line to stdout. Diagnostic output must go to stderr so the protocol stream remains machine-readable.

## Files

Evaluation runs are written under:

```text
trainer/data/runs/<timestamp>-flat-evaluation-<suffix>/
├─ config.json
├─ metrics.jsonl
└─ result.json
```

`trainer/data/` is local-only and ignored by Git.

## Planned layers

1. Reproduce the existing Flat CEM loop in Python.
2. Add batch experiment comparison and plotting.
3. Export imitation-learning datasets from the TypeScript simulator.
4. Add a Gymnasium environment with candidate-action masking.
5. Add neural value models and reinforcement learning without changing the browser game UI.
