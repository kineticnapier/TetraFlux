import { HEURISTIC_WEIGHT_KEYS, type HeuristicWeightKey } from "../heuristicWeights";
import type { HeuristicTrainingConfig } from "./types";

export const DEFAULT_HEURISTIC_TRAINING_CONFIG: HeuristicTrainingConfig = {
  population: 16,
  eliteCount: 4,
  gamesPerCandidate: 8,
  maxPieces: 300,
  trainingSeedBase: 123456789,
  seedStride: 100_003,
  initialSigma: 0.18,
  minRelativeSigma: 0.015,
  smoothing: 0.65,
  fixedKeys: ["holeWeight"],
};

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function normalizeHeuristicTrainingConfig(input: Partial<HeuristicTrainingConfig> = {}): HeuristicTrainingConfig {
  const defaults = DEFAULT_HEURISTIC_TRAINING_CONFIG;
  const population = intInRange(input.population, defaults.population, 2, 128);
  const eliteCount = intInRange(input.eliteCount, Math.min(defaults.eliteCount, population), 1, Math.max(1, population - 1));
  const fixedKeys = Array.isArray(input.fixedKeys)
    ? input.fixedKeys.filter((key): key is HeuristicWeightKey => HEURISTIC_WEIGHT_KEYS.includes(key as HeuristicWeightKey))
    : [...defaults.fixedKeys];

  return {
    population,
    eliteCount,
    gamesPerCandidate: intInRange(input.gamesPerCandidate, defaults.gamesPerCandidate, 1, 256),
    maxPieces: intInRange(input.maxPieces, defaults.maxPieces, 20, 5000),
    trainingSeedBase: intInRange(input.trainingSeedBase, defaults.trainingSeedBase, 0, 0xFFFFFFFF),
    seedStride: intInRange(input.seedStride, defaults.seedStride, 1, 0x7FFFFFFF),
    initialSigma: numberInRange(input.initialSigma, defaults.initialSigma, 0.001, 2),
    minRelativeSigma: numberInRange(input.minRelativeSigma, defaults.minRelativeSigma, 0.0001, 0.5),
    smoothing: numberInRange(input.smoothing, defaults.smoothing, 0.05, 1),
    fixedKeys: [...new Set(fixedKeys)],
  };
}
