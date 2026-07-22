# TetraFlux Python

This directory is a standalone Python game and learning lab. It does not require Node or the TypeScript engine at runtime.

## Included

- dependency-free game engine
- 10 x 20 visible board with four hidden rows
- seven tetrominoes and deterministic 7-bag randomizer
- movement, soft/hard drop, hold, CW/CCW/180 rotation
- simple wall/floor kicks
- line clear, combo, B2B, attack, approximate spin detection
- direct legal-placement actions for search and reinforcement learning
- Pygame game client
- Gradio experiment dashboard
- local run folders and JSON results

The rules are intentionally Tetris-like rather than a strict Guideline clone. The important invariant is that gameplay, headless simulation, and future learning code use the same Python engine.

## Windows start

From the repository root:

```text
start-python-game.bat
start-python-trainer.bat
```

`start-python-game.bat` opens the Pygame client.

`start-python-trainer.bat` opens the Gradio lab at `http://127.0.0.1:7860/` and can launch the game from the browser UI.

## Manual setup

```powershell
py -3 -m venv trainer/.venv
trainer/.venv/Scripts/python -m pip install -e "trainer[ui]"
trainer/.venv/Scripts/python -m tetraflux_trainer.game
```

Headless tools:

```powershell
trainer/.venv/Scripts/python -m tetraflux_trainer info
trainer/.venv/Scripts/python -m tetraflux_trainer smoke --games 4 --max-pieces 200
```

## Controls

```text
Left / Right     move
Down             soft drop
Z                rotate counter-clockwise
X / Up           rotate clockwise
A                rotate 180 degrees
C / Shift        hold
Space            hard drop
P                pause
R                restart
Esc              quit
```

## Python API

```python
from tetraflux_engine import Game

game = Game(seed=1234)
game.move_left()
game.rotate_cw()
result = game.hard_drop()

placements = game.legal_placements()
result = game.place(placements[0])
```

The engine has no Pygame, Gradio, NumPy, Gymnasium, or PyTorch dependency.

## Data

Experiment outputs are local-only:

```text
trainer/data/
├─ models/
├─ runs/
├─ replays/
└─ datasets/
```

A smoke run creates:

```text
trainer/data/runs/<timestamp>-python-engine-smoke-<suffix>/
├─ config.json
├─ metrics.jsonl
└─ result.json
```

## Next learning layers

1. Add board features and a hand-written placement heuristic.
2. Rebuild CEM entirely in Python.
3. Add vectorized placement environments and action masks.
4. Export imitation datasets from heuristic or search agents.
5. Add neural value models and reinforcement learning.
