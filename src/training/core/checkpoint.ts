import {
  DEFAULT_HEURISTIC_WEIGHTS,
  HEURISTIC_FEATURE_SET,
  HEURISTIC_WEIGHT_KEYS,
  createHeuristicWeightProfile,
  normalizeHeuristicWeights,
  type HeuristicWeightKey,
  type HeuristicWeightProfileV1,
  type HeuristicWeightVector,
} from "../heuristicWeights";
import { normalizeHeuristicTrainingConfig } from "./config";
import type {
  HeuristicTrainingBest,
  HeuristicTrainingCheckpoint,
  HeuristicTrainingConfig,
} from "./types";

export const HEURISTIC_CHECKPOINT_FORMAT = "tetraflux_heuristic_training_checkpoint_v1" as const;

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function initialRngState(seed: number): number {
  return (seed ^ 0xA5A5A5A5) >>> 0;
}

export function initialHeuristicDeviation(
  mean: HeuristicWeightVector,
  config: HeuristicTrainingConfig,
): HeuristicWeightVector {
  const out = {} as HeuristicWeightVector;
  for (const key of HEURISTIC_WEIGHT_KEYS) {
    out[key] = config.fixedKeys.includes(key) ? 0 : Math.max(0.02, Math.abs(mean[key]) * config.initialSigma);
  }
  return out;
}

export function createInitialHeuristicCheckpoint(
  input: Partial<HeuristicTrainingConfig> = {},
  initialWeights: HeuristicWeightVector = DEFAULT_HEURISTIC_WEIGHTS,
): HeuristicTrainingCheckpoint {
  const config = normalizeHeuristicTrainingConfig(input);
  const mean = normalizeHeuristicWeights(initialWeights);
  return {
    format: HEURISTIC_CHECKPOINT_FORMAT,
    schemaVersion: 1,
    featureSet: HEURISTIC_FEATURE_SET,
    algorithm: "cem",
    generation: 0,
    rngState: initialRngState(config.trainingSeedBase),
    config,
    mean,
    deviation: initialHeuristicDeviation(mean, config),
    best: null,
    updatedAt: new Date().toISOString(),
  };
}

export function parseHeuristicTrainingCheckpoint(input: unknown): HeuristicTrainingCheckpoint {
  if (!input || typeof input !== "object") throw new Error("Training checkpoint must be an object");
  const raw = input as Record<string, unknown>;
  if (raw.format !== HEURISTIC_CHECKPOINT_FORMAT) {
    throw new Error(`Unsupported training checkpoint: ${String(raw.format ?? "missing")}`);
  }
  if (raw.featureSet !== HEURISTIC_FEATURE_SET) {
    throw new Error(`Unsupported checkpoint feature set: ${String(raw.featureSet ?? "missing")}`);
  }

  const config = normalizeHeuristicTrainingConfig(raw.config as Partial<HeuristicTrainingConfig> | undefined);
  const mean = normalizeHeuristicWeights(raw.mean as Partial<Record<HeuristicWeightKey, unknown>> | undefined);
  const rawDeviation = raw.deviation && typeof raw.deviation === "object"
    ? raw.deviation as Partial<Record<HeuristicWeightKey, unknown>>
    : {};
  const fallbackDeviation = initialHeuristicDeviation(mean, config);
  const deviation = {} as HeuristicWeightVector;

  for (const key of HEURISTIC_WEIGHT_KEYS) {
    const n = Number(rawDeviation[key]);
    deviation[key] = config.fixedKeys.includes(key)
      ? 0
      : Math.max(0, Number.isFinite(n) ? n : fallbackDeviation[key]);
  }

  const bestRaw = raw.best && typeof raw.best === "object" ? raw.best as HeuristicTrainingBest : null;
  const best = bestRaw && Number.isFinite(Number(bestRaw.fitness))
    ? { ...bestRaw, weights: normalizeHeuristicWeights(bestRaw.weights) }
    : null;

  return {
    format: HEURISTIC_CHECKPOINT_FORMAT,
    schemaVersion: 1,
    featureSet: HEURISTIC_FEATURE_SET,
    algorithm: "cem",
    generation: intInRange(raw.generation, 0, 0, 1_000_000),
    rngState: intInRange(raw.rngState, initialRngState(config.trainingSeedBase), 0, 0xFFFFFFFF) >>> 0,
    config,
    mean,
    deviation,
    best,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

export function checkpointBestProfile(checkpoint: HeuristicTrainingCheckpoint): HeuristicWeightProfileV1 {
  const best = checkpoint.best;
  const weights = best?.weights ?? checkpoint.mean;
  return createHeuristicWeightProfile(weights, {
    profileId: `flat-v1-gen-${String(best?.generation ?? checkpoint.generation).padStart(4, "0")}`,
    training: {
      algorithm: checkpoint.algorithm,
      generation: best?.generation ?? checkpoint.generation,
      masterSeed: checkpoint.config.trainingSeedBase,
      fitness: best?.fitness,
    },
    validation: best ? {
      games: best.aggregate.games,
      maxPieces: best.aggregate.maxPieces,
      survivalRate: best.aggregate.survivalRate,
      topouts: best.aggregate.topouts,
      linesPerPiece: best.aggregate.linesPerPiece,
      attackPerPiece: best.aggregate.attackPerPiece,
      avgHoles: best.aggregate.avgHoles,
      avgMaxHeight: best.aggregate.avgMaxHeight,
    } : undefined,
  });
}
