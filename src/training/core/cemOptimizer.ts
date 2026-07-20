import {
  HEURISTIC_WEIGHT_KEYS,
  normalizeHeuristicWeights,
  type HeuristicWeightVector,
} from "../heuristicWeights";
import { checkpointBestProfile } from "./checkpoint";
import type {
  HeuristicGenerationCandidate,
  HeuristicGenerationResult,
  HeuristicTrainingBest,
  HeuristicTrainingCheckpoint,
} from "./types";

function updateDistribution(
  checkpoint: HeuristicTrainingCheckpoint,
  elites: HeuristicGenerationCandidate[],
): { mean: HeuristicWeightVector; deviation: HeuristicWeightVector } {
  const nextMean = {} as HeuristicWeightVector;
  const nextDeviation = {} as HeuristicWeightVector;
  const smoothing = checkpoint.config.smoothing;

  for (const key of HEURISTIC_WEIGHT_KEYS) {
    if (checkpoint.config.fixedKeys.includes(key)) {
      nextMean[key] = checkpoint.mean[key];
      nextDeviation[key] = 0;
      continue;
    }

    const eliteMean = elites.reduce((sum, candidate) => sum + candidate.weights[key], 0) / elites.length;
    const variance = elites.reduce((sum, candidate) => sum + (candidate.weights[key] - eliteMean) ** 2, 0) / elites.length;
    const minDeviation = Math.max(0.005, Math.abs(eliteMean) * checkpoint.config.minRelativeSigma);
    nextMean[key] = checkpoint.mean[key] * (1 - smoothing) + eliteMean * smoothing;
    nextDeviation[key] = Math.max(
      minDeviation,
      checkpoint.deviation[key] * (1 - smoothing) + Math.sqrt(Math.max(0, variance)) * smoothing,
    );
  }

  return { mean: normalizeHeuristicWeights(nextMean), deviation: nextDeviation };
}

export function finalizeHeuristicGeneration(
  checkpoint: HeuristicTrainingCheckpoint,
  evaluatedCandidates: HeuristicGenerationCandidate[],
  generation: number,
  seedBase: number,
  nextRngState: number,
): HeuristicGenerationResult {
  if (evaluatedCandidates.length !== checkpoint.config.population) {
    throw new Error(`Expected ${checkpoint.config.population} candidates, received ${evaluatedCandidates.length}`);
  }

  const candidates = [...evaluatedCandidates].sort((a, b) => b.fitness - a.fitness || a.index - b.index);
  const bestCandidate = candidates[0];
  if (!bestCandidate) throw new Error("Training generation produced no candidates");
  const elites = candidates.slice(0, checkpoint.config.eliteCount);
  const distribution = updateDistribution(checkpoint, elites);
  const previousBest = checkpoint.best;
  const best: HeuristicTrainingBest = !previousBest || bestCandidate.fitness > previousBest.fitness
    ? {
      generation,
      candidateIndex: bestCandidate.index,
      fitness: bestCandidate.fitness,
      weights: { ...bestCandidate.weights },
      aggregate: { ...bestCandidate.aggregate },
    }
    : previousBest;

  const next: HeuristicTrainingCheckpoint = {
    ...checkpoint,
    generation,
    rngState: nextRngState >>> 0,
    mean: distribution.mean,
    deviation: distribution.deviation,
    best,
    updatedAt: new Date().toISOString(),
  };

  return {
    generation,
    seedBase,
    candidates,
    best: bestCandidate,
    checkpoint: next,
    profile: checkpointBestProfile(next),
  };
}
