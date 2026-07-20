# Heuristic weight training

Benchmarking and training are intentionally separate.

- **AI Benchmark** compares fixed AI/profile behavior and exports measurements.
- **Train AI** changes the 14 `flat-14-v1` heuristic weights with a deterministic cross-entropy method (CEM) loop.

## Web workflow

The normal workflow is entirely browser-based.

1. Open **Train AI** and run or resume training.
2. At the end of every generation, the checkpoint and best profile are saved in the browser.
3. The best profile immediately appears as **Learned Heuristic** in AI Battle and **Bench AI**.
4. Start a new match or a new benchmark to create an AI instance using the latest profile.
5. Use **Download Best Profile** and **Download Checkpoint** for backups or transfer to another browser.
6. Use **Import Profile** or **Import Checkpoint** to restore those files.

The profile is stored in both `localStorage` and IndexedDB. AI Battle reads the synchronous local copy, while the benchmark Web Worker reads the IndexedDB copy. This avoids requiring a server upload or a repository file.

A web page cannot silently create `models/...` or `data/...` files in the Git repository. Those paths only apply to the optional Node CLI. Browser training instead persists data under the current site origin and exposes explicit JSON download buttons.

## Browser storage

- profile: `tetraflux:heuristicWeightProfile:v1`
- checkpoint: `tetraflux:heuristicTrainingCheckpoint:v1`
- IndexedDB database: `tetraflux-ai`

Clearing site data removes these copies, so keep downloaded backups for important runs.

## File formats

- runtime profile format: `tetraflux_heuristic_weights_v1`
- optimizer checkpoint format: `tetraflux_heuristic_cem_checkpoint_v1`

The profile and checkpoint use different formats so runtime loading never needs to trust optimizer internals.

## Optional Node workflow

Node training remains available for long unattended runs:

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

Only this optional Node path writes:

- `models/heuristic-flat-v1.json`
- `data/training/heuristic-flat-v1/checkpoint.json`
- `data/training/heuristic-flat-v1/history.jsonl`

## Fitness

The initial fitness strongly prioritizes survival, especially the worst 10% of seeds, then uses line/attack efficiency and terrain quality as tie-breakers. Every candidate in a generation receives the same seed set. The generation seed set changes deterministically to reduce overfitting.

`holeWeight` is fixed by default to remove the meaningless global scale degree of freedom. The remaining 13 weights are learned.
