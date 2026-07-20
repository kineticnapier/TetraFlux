# Experimental AllSpinAI foundation

This branch adds a first strict All-Spin search AI to TetraFlux.

## Rules

- A line-clearing placement is accepted only when it is a scoring spin, or a non-O immobile lock whose last successful action is a rotation.
- Non-clearing placements remain legal because they are needed to build future spin terrain.
- O spins are never counted.

## Engine scoring

All-Spin scoring is enabled per `TetrisEngine` instance. When enabled, an otherwise unscored non-O immobile rotation lock is classified as the generic `spin` type before `lockPiece()` calculates attack and B2B.

This means attack, B2B, garbage cancellation, search evaluation, and benchmark metrics all consume the same result. No post-lock attack recalculation or B2B correction is required.

Normal engines keep the original Guideline T-spin-only scoring behavior.

## Search

`AllSpinAI` combines ordinary legal placements with routed SRS twist candidates, then performs a small beam search. Its current evaluation favors:

- spin clears and attack,
- consecutive spin clears,
- low holes and manageable height,
- B2B preservation,
- physically routed twist placements.

This is intentionally a hand-written baseline. The intended next step is to log candidate afterstates and search values, then train a value model from those samples.

## Important route fix

The twist BFS previously deduplicated states using only piece, position, rotation, hold state, and hold piece. That could merge a state reached by movement with the same geometric state reached by a rotation, discarding the route that actually scores a spin.

The state key now also includes the last transition type and, for rotations, the rotation direction and kick offset.

## Test

```bash
npm run test:allspin-ai
npm run test:twist-generator
npm run build
```

The AI is registered as `allspin` / `AllSpinAI (experimental)` in the built-in AI list.
