# Browser AI training

Benchmarking and optimization use separate pages.

- `/` contains the game and AI Battle UI.
- `/benchmark/` compares fixed AI/model behavior.
- `/training/` trains the base Flat Heuristic.
- `/training/allspin/` trains All-Spin scoring derived from the active Flat model.

Vite builds all four HTML entry points. Cloudflare Pages serves the nested directory pages directly.

## Model hierarchy

```text
Flat Heuristic
  format: tetraflux_heuristic_weights_v1
  feature set: flat-14-v1
  learns: board safety, lines, attack and terrain weights
          │
          └── frozen parent evaluator
                    │
                    ▼
Derived All-Spin
  format: tetraflux_allspin_weights_v1
  feature set: allspin-derived-flat14-10-v1
  learns: spin clear, lines, attack, B2B, chain, setup and route weights
```

An All-Spin profile embeds the complete Flat profile used during training. It may also record the immutable Cloudflare `parentModelId`. The derived model therefore remains self-contained even if the parent is later replaced by a newer Flat model.

## Flat training workflow

1. Open `/training/`.
2. Choose a start mode:
   - **Start New Defaults** starts from built-in weights.
   - **Start From Learned Profile** starts a fresh optimizer around the active profile with reset sigma.
   - **Resume Checkpoint** continues the exact optimizer state.
3. Every completed generation saves the checkpoint and global-best profile locally.
4. Use `/benchmark/` for fixed-seed validation.
5. Upload accepted models to Cloudflare from the model registry section.

Flat training changes the 14 `flat-14-v1` weights. `holeWeight` is fixed by default to remove the global score-scale degree of freedom; the other 13 are learned.

## All-Spin training workflow

1. Train, import, or load a Flat model first.
2. Open `/training/allspin/`.
3. The active Learned Heuristic is frozen as the parent board evaluator.
4. Choose:
   - **Start From Learned Heuristic** for the first derived run.
   - **Restart From Learned All-Spin** to reset sigma around the current best All-Spin profile.
   - **Resume Checkpoint** to continue the exact All-Spin optimizer state.
5. Validate the resulting `AllSpinAI (<profileId>)` on `/benchmark/`.
6. Upload accepted All-Spin models to Cloudflare.

Only the following 10 All-Spin-specific weights are optimized:

- `baseHeuristicScale`
- `spinClearBonus`
- `spinLineBonus`
- `spinAttackBonus`
- `mechanicalSetupBonus`
- `b2bBonus`
- `spinChainBonus`
- `routeLengthPenalty`
- `highStackPenalty`
- `heightRisePenalty`

Strict All-Spin legality and the topout penalty are fixed rules, not trainable weights.

## Deterministic All-Spin search

Gameplay uses a millisecond time budget. Training uses a fixed node budget:

```text
searchBudgetMode = nodes
maxExpandedNodes = selected UI value
```

Twist generation is bounded by state, path and candidate counts instead of a deadline. With the same parent profile, weights and seeds, changing CPU load or Worker completion order does not change the evaluated search tree.

The Stage 1 defaults are intentionally small:

```text
population: 8
elite: 2
games/candidate: 2
max pieces: 100
expanded nodes: 160
depth: 2
```

After basic survival and spin frequency improve, increase games, pieces and node budget gradually. All-Spin search is substantially more expensive than Flat evaluation.

## Worker Pool

Both optimizers execute in browser Web Workers.

- `parallel workers = 0` selects Auto.
- Auto uses `min(8, logical CPU cores - 1)` with a minimum of one.
- Values 1–16 can be selected manually.
- `1` is the sequential diagnostic fallback.

The coordinator samples the complete population before evaluation. Candidate completion order therefore cannot change sampled weights, RNG state, elite selection or the next CEM distribution.

The expensive game simulations run on the visitor's CPU, not Cloudflare CPU.

## Local browser storage

Flat:

- profile: `tetraflux:heuristicWeightProfile:v1`
- checkpoint: `tetraflux:heuristicTrainingCheckpoint:v1`

All-Spin:

- profile: `tetraflux:allSpinWeightProfile:v1`
- checkpoint: `tetraflux:allSpinTrainingCheckpoint:v1`

Both profile families are mirrored to IndexedDB database `tetraflux-ai` so benchmark Workers can read them. All pages use the same origin and share the data.

## Cloudflare model registry

Cloudflare stores immutable model envelopes in Workers KV. The envelope format is:

```text
tetraflux_model_envelope_v1
```

Readable IDs follow:

```text
flat-g0008-20260721T143012Z-a1b2
allspin-g0003-20260721T151500Z-c3d4
```

The browser generates the model, then uploads only the final JSON. When no local profile exists, game, benchmark and training pages attempt to cache the latest Cloudflare model for each family.

See [`cloud-model-registry.md`](./cloud-model-registry.md) for the required `MODELS` KV binding and `MODEL_WRITE_TOKEN` secret.

## Architecture

```text
src/models/
├─ modelEnvelope.ts
├─ cloudModelClient.ts
└─ bootstrapCloudModels.ts

src/training/
├─ core/                         Flat CEM core
├─ evaluation/                   Flat simulator and fitness
├─ scheduler/                    Flat sequential / Worker Pool
├─ browser/
│  ├─ candidateWorker.ts
│  ├─ trainingController.ts
│  ├─ allSpinCandidateWorker.ts
│  └─ allSpinTrainingController.ts
├─ heuristicWeights.ts
├─ heuristicTrainingWorker.ts
├─ browserHeuristicProfile.ts
├─ allspinWeights.ts
├─ allspinTrainer.ts
├─ allspinTrainingWorker.ts
└─ browserAllSpinProfile.ts

functions/api/models/                Cloudflare Pages Functions
functions/_lib/modelStore.js         Workers KV helper
```

## Fixtures

```bash
npm run test:heuristic-training
npm run test:allspin-ai
npm run test:allspin-training
```

The All-Spin training fixture verifies deterministic candidate sampling, deterministic node-budget evaluation, strict-clear behavior, derived profile parsing and cloud envelope lineage.

## Optional Node Flat workflow

The previous unattended Flat CLI remains available:

```bash
npm run train:heuristic -- --generations 25 --population 16 --games 8 --max-pieces 300 --seed 123456789
npm run bench:heuristic-profile -- --games 64 --max-pieces 1000 --seed 987654321
```

The normal Flat and All-Spin workflow is browser-based.
