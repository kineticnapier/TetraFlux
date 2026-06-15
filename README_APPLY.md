# TetraFlux browser benchmark tuning update

This ZIP is a full-file replacement bundle. Copy the files over the repository root.

## What changed

- Adds `src/bench/benchmarkTuning.ts`.
- Adds an **AI tuning overrides** panel inside the existing `Bench AI` screen.
- Keeps the benchmark garbage controls and help screen.
- Sends tuning settings to the Web Worker benchmark and writes them into the JSON payload.
- Applies filled tuning values to every selected AI for that benchmark run.
- Empty tuning fields keep each AI's built-in defaults.

## Browser UI

Open `Bench AI`, then use:

- `Benchmark garbage` for bag-by-bag garbage.
- `AI tuning overrides` for runtime AI parameters.
- `Help` for metric explanations.

The tuning panel supports:

- `garbagePressureSensitivity`
- `garbageHoleSensitivity`
- `b2bPressureSensitivity`
- key heuristic weights such as `holeWeight`, `heightWeight`, `attackBonus`, `lineBonus`
- safety penalties such as `newHolePenaltyWeight`, `maxHeightRisePenaltyWeight`
- lookahead settings such as `depth`, `beamWidth`, `timeBudgetMs`, `includeTwists`, `maxTwistCandidates`

Preset buttons:

- `Balanced garbage`: weaker garbage-hole weight, still pressure-aware.
- `Low-hole`: stronger hole prevention.
- `Fast lookahead`: smaller beam/node budgets.

## Output

Benchmark JSON now includes:

```json
"tuning": {
  "enabled": true,
  "garbageHoleSensitivity": 0.65
}
```

The text summary also prints an `AI tuning overrides:` line so saved results are easier to compare.

## Verify

```powershell
npm install
npm run test:benchmark-tuning
npm run test:garbage-hole
npm run test:b2b-pressure
npm run test:garbage-pressure
npm run test:benchmark-garbage
npm run build
```

