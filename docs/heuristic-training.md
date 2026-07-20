# Heuristic weight training

Benchmarking and training are intentionally separate.

- **AI Benchmark** compares fixed AI/profile behavior and exports measurements.
- **Train AI** changes the 14 `flat-14-v1` heuristic weights with a deterministic cross-entropy method (CEM) loop.

## Files

- `models/heuristic-flat-v1.json`: best runtime profile.
- `data/training/heuristic-flat-v1/checkpoint.json`: resumable optimizer state.
- `data/training/heuristic-flat-v1/history.jsonl`: one record per generation.

The profile and checkpoint use different formats so runtime loading never needs to trust optimizer internals.

## Browser

The toolbar contains separate **Bench AI** and **Train AI** buttons. Browser training runs in its own Web Worker and stores the latest checkpoint/profile in `localStorage`. Both can be downloaded as JSON; checkpoints can also be imported to resume another session.

## Node training

```bash
npm run train:heuristic -- --generations 25 --population 16 --games 8 --max-pieces 300 --seed 123456789
```

Resume:

```bash
npm run train:heuristic -- --resume --generations 25
```

Validate the saved profile on a separate fixed seed set:

```bash
npm run bench:heuristic-profile -- --games 64 --max-pieces 1000 --seed 987654321
```

## Fitness

The initial fitness strongly prioritizes survival, especially the worst 10% of seeds, then uses line/attack efficiency and terrain quality as tie-breakers. Every candidate in a generation receives the same seed set. The generation seed set changes deterministically to reduce overfitting.

`holeWeight` is fixed by default to remove the meaningless global scale degree of freedom. The remaining 13 weights are learned.
