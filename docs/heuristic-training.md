# Heuristic weight training

Benchmarking and training are intentionally separate pages.

- `/` contains the game and AI Battle UI.
- `/benchmark/` compares fixed AI/profile behavior and exports measurements.
- `/training/` changes the 14 `flat-14-v1` heuristic weights with a deterministic cross-entropy method (CEM) loop.

Vite builds all three HTML entry points. Cloudflare Pages serves the nested `benchmark/index.html` and `training/index.html` files as directory pages, so no Function or routing rule is required.

## Web workflow

The normal workflow is entirely browser-based.

1. Open `/training/`.
2. Choose a start mode:
   - **Start New Defaults** creates a new optimizer around the built-in weights.
   - **Start From Learned Profile** creates a new optimizer around the currently saved best profile and resets its exploration deviation from the selected sigma.
   - **Resume Checkpoint** continues the exact saved generation, mean, deviation, RNG state, and optimizer settings.
3. At the end of every generation, the checkpoint and best profile are saved in the browser.
4. Open `/benchmark/` to compare the resulting **Learned Heuristic** against fixed AIs.
5. Start a new game or benchmark to create an AI instance using the latest profile.
6. Use profile/checkpoint Import and Download controls for backups or transfer.

The profile is stored in both `localStorage` and IndexedDB. AI Battle reads the synchronous local copy, while benchmark workers read IndexedDB. All three pages share the same origin and therefore the same saved data.

## Parallel workers

Training uses one coordinator worker plus a pool of candidate workers. Each candidate receives the same generation seed set and evaluates independently.

- `parallel workers = 0` selects **Auto**.
- Auto uses `min(8, logical CPU cores - 1)` with a minimum of one.
- Values from 1 to 16 can be selected manually.
- `1` uses the sequential scheduler and is useful as a compatibility fallback.

Candidate weights are sampled in the coordinator before any evaluation begins. Therefore worker completion order cannot change:

- sampled weights,
- RNG state,
- elite ordering,
- next-generation mean/deviation,
- saved best profile.

The fixture reverses candidate completion order and verifies that the resulting checkpoint is identical. Initial and legacy signed RNG states are normalized to unsigned 32-bit values before sampling.

This is CPU parallelism, not GPU training. The current simulator contains branching, piece movement, board cloning, and variable-length games, which do not map efficiently to a small WebGPU kernel. The scheduler interface allows a future WASM or WebGPU evaluator without changing CEM or the page UI.

Vite bundles the coordinator and candidate workers from `new Worker(new URL(..., import.meta.url), { type: "module" })`. No Cloudflare Pages header or function change is required for this Worker Pool.

## Architecture

```text
benchmark/index.html
training/index.html
src/pages/
├─ benchmarkPage.ts
├─ trainingPage.ts
└─ toolPage.css

src/training/
├─ core/
│  ├─ types.ts
│  ├─ config.ts
│  ├─ random.ts
│  ├─ candidateSampler.ts
│  ├─ checkpoint.ts
│  ├─ cemOptimizer.ts
│  └─ generation.ts
├─ evaluation/
│  ├─ gameSimulator.ts
│  ├─ fitness.ts
│  └─ heuristicEvaluator.ts
├─ scheduler/
│  ├─ types.ts
│  ├─ sequentialScheduler.ts
│  └─ workerPoolScheduler.ts
├─ browser/
│  ├─ candidateWorker.ts
│  └─ trainingController.ts
├─ heuristicTrainer.ts
├─ heuristicTrainingWorker.ts
├─ heuristicWeights.ts
└─ browserHeuristicProfile.ts
```

`heuristicTrainer.ts` remains a compatibility facade for Node tools and fixtures. Browser code supplies a scheduler explicitly. The AI registry receives the learned-profile provider through dependency injection and does not directly own browser storage.

The old benchmark/training scripts still contain their control logic, but they are mounted only by their dedicated page entry points. The game page no longer loads either tool UI or their Workers.

## Browser storage

- profile: `tetraflux:heuristicWeightProfile:v1`
- checkpoint: `tetraflux:heuristicTrainingCheckpoint:v1`
- IndexedDB database: `tetraflux-ai`

Moving between `/`, `/benchmark/`, and `/training/` does not copy or reset these values. Clearing site data removes them, so keep downloaded backups for important runs.

## File formats

- runtime profile format: `tetraflux_heuristic_weights_v1`
- optimizer checkpoint format: `tetraflux_heuristic_training_checkpoint_v1`

The profile and checkpoint use different formats so runtime loading never needs optimizer internals.

## Optional Node workflow

Node training remains available for unattended runs:

```bash
npm run train:heuristic -- --generations 25 --population 16 --games 8 --max-pieces 300 --seed 123456789
```

Resume:

```bash
npm run train:heuristic -- --resume --generations 25
```

Validate the saved profile:

```bash
npm run bench:heuristic-profile -- --games 64 --max-pieces 1000 --seed 987654321
```

Only this optional Node path writes:

- `models/heuristic-flat-v1.json`
- `data/training/heuristic-flat-v1/checkpoint.json`
- `data/training/heuristic-flat-v1/history.jsonl`

## Fitness

Fitness strongly prioritizes survival, especially the worst 10% of seeds, then uses line/attack efficiency and terrain quality as tie-breakers. Every candidate in a generation receives the same seed set. The generation seed set changes deterministically to reduce overfitting.

`holeWeight` is fixed by default to remove the meaningless global scale degree of freedom. The remaining 13 weights are learned.
