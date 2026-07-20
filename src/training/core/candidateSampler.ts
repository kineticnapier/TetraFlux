import {
  HEURISTIC_WEIGHT_KEYS,
  HEURISTIC_WEIGHT_LIMITS,
  type HeuristicWeightVector,
} from "../heuristicWeights";
import { TrainingRng } from "./random";
import type { HeuristicTrainingCheckpoint, SampledHeuristicCandidate } from "./types";

export interface SampledPopulation {
  candidates: SampledHeuristicCandidate[];
  nextRngState: number;
}

export function sampleHeuristicPopulation(checkpoint: HeuristicTrainingCheckpoint): SampledPopulation {
  const rng = new TrainingRng(checkpoint.rngState);
  const candidates: SampledHeuristicCandidate[] = [];

  for (let index = 0; index < checkpoint.config.population; index++) {
    if (index === 0) {
      candidates.push({ index, weights: { ...checkpoint.mean } });
      continue;
    }

    const weights = {} as HeuristicWeightVector;
    for (const key of HEURISTIC_WEIGHT_KEYS) {
      if (checkpoint.config.fixedKeys.includes(key)) {
        weights[key] = checkpoint.mean[key];
        continue;
      }
      const limits = HEURISTIC_WEIGHT_LIMITS[key];
      const sampled = checkpoint.mean[key] + rng.normal() * checkpoint.deviation[key];
      weights[key] = Math.max(limits.min, Math.min(limits.max, sampled));
    }
    candidates.push({ index, weights });
  }

  return { candidates, nextRngState: rng.state >>> 0 };
}
