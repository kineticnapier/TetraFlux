import { evaluateHeuristicWeights, type HeuristicEvaluationAggregate, type HeuristicEvaluationRuntime } from "./heuristicEvaluation";
import {
  DEFAULT_HEURISTIC_WEIGHTS,
  HEURISTIC_FEATURE_SET,
  HEURISTIC_WEIGHT_KEYS,
  HEURISTIC_WEIGHT_LIMITS,
  createHeuristicWeightProfile,
  normalizeHeuristicWeights,
  type HeuristicWeightKey,
  type HeuristicWeightProfileV1,
  type HeuristicWeightVector,
} from "./heuristicWeights";

export const HEURISTIC_CHECKPOINT_FORMAT = "tetraflux_heuristic_training_checkpoint_v1" as const;

export interface HeuristicTrainingConfig {
  population: number;
  eliteCount: number;
  gamesPerCandidate: number;
  maxPieces: number;
  trainingSeedBase: number;
  seedStride: number;
  initialSigma: number;
  minRelativeSigma: number;
  smoothing: number;
  fixedKeys: HeuristicWeightKey[];
}

export interface HeuristicTrainingBest {
  generation: number;
  candidateIndex: number;
  fitness: number;
  weights: HeuristicWeightVector;
  aggregate: HeuristicEvaluationAggregate;
}

export interface HeuristicTrainingCheckpoint {
  format: typeof HEURISTIC_CHECKPOINT_FORMAT;
  schemaVersion: 1;
  featureSet: typeof HEURISTIC_FEATURE_SET;
  algorithm: "cem";
  generation: number;
  rngState: number;
  config: HeuristicTrainingConfig;
  mean: HeuristicWeightVector;
  deviation: HeuristicWeightVector;
  best: HeuristicTrainingBest | null;
  updatedAt: string;
}

export interface HeuristicGenerationCandidate {
  index: number;
  fitness: number;
  weights: HeuristicWeightVector;
  aggregate: HeuristicEvaluationAggregate;
}

export interface HeuristicGenerationResult {
  generation: number;
  seedBase: number;
  candidates: HeuristicGenerationCandidate[];
  best: HeuristicGenerationCandidate;
  checkpoint: HeuristicTrainingCheckpoint;
  profile: HeuristicWeightProfileV1;
}

export interface HeuristicGenerationRuntime extends HeuristicEvaluationRuntime {
  onCandidate?: (completed: number, total: number, candidate: HeuristicGenerationCandidate) => void;
}

const DEFAULT_CONFIG: HeuristicTrainingConfig = {
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
  const population = intInRange(input.population, DEFAULT_CONFIG.population, 2, 128);
  const eliteCount = intInRange(input.eliteCount, Math.min(DEFAULT_CONFIG.eliteCount, population), 1, Math.max(1, population - 1));
  const fixedKeys = Array.isArray(input.fixedKeys)
    ? input.fixedKeys.filter((key): key is HeuristicWeightKey => HEURISTIC_WEIGHT_KEYS.includes(key as HeuristicWeightKey))
    : [...DEFAULT_CONFIG.fixedKeys];
  return {
    population,
    eliteCount,
    gamesPerCandidate: intInRange(input.gamesPerCandidate, DEFAULT_CONFIG.gamesPerCandidate, 1, 256),
    maxPieces: intInRange(input.maxPieces, DEFAULT_CONFIG.maxPieces, 20, 5000),
    trainingSeedBase: intInRange(input.trainingSeedBase, DEFAULT_CONFIG.trainingSeedBase, 0, 0xFFFFFFFF),
    seedStride: intInRange(input.seedStride, DEFAULT_CONFIG.seedStride, 1, 0x7FFFFFFF),
    initialSigma: numberInRange(input.initialSigma, DEFAULT_CONFIG.initialSigma, 0.001, 2),
    minRelativeSigma: numberInRange(input.minRelativeSigma, DEFAULT_CONFIG.minRelativeSigma, 0.0001, 0.5),
    smoothing: numberInRange(input.smoothing, DEFAULT_CONFIG.smoothing, 0.05, 1),
    fixedKeys: [...new Set(fixedKeys)],
  };
}

class TrainingRng {
  state: number;
  constructor(state: number) { this.state = state >>> 0 || 0x6D2B79F5; }
  next(): number {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  normal(): number {
    const u = Math.max(Number.EPSILON, this.next());
    const v = Math.max(Number.EPSILON, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

function initialDeviation(mean: HeuristicWeightVector, config: HeuristicTrainingConfig): HeuristicWeightVector {
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
    rngState: config.trainingSeedBase ^ 0xA5A5A5A5,
    config,
    mean,
    deviation: initialDeviation(mean, config),
    best: null,
    updatedAt: new Date().toISOString(),
  };
}

export function parseHeuristicTrainingCheckpoint(input: unknown): HeuristicTrainingCheckpoint {
  if (!input || typeof input !== "object") throw new Error("Training checkpoint must be an object");
  const raw = input as Record<string, unknown>;
  if (raw.format !== HEURISTIC_CHECKPOINT_FORMAT) throw new Error(`Unsupported training checkpoint: ${String(raw.format ?? "missing")}`);
  if (raw.featureSet !== HEURISTIC_FEATURE_SET) throw new Error(`Unsupported checkpoint feature set: ${String(raw.featureSet ?? "missing")}`);
  const config = normalizeHeuristicTrainingConfig(raw.config as Partial<HeuristicTrainingConfig> | undefined);
  const mean = normalizeHeuristicWeights(raw.mean as Partial<Record<HeuristicWeightKey, unknown>> | undefined);
  const rawDeviation = raw.deviation && typeof raw.deviation === "object" ? raw.deviation as Partial<Record<HeuristicWeightKey, unknown>> : {};
  const fallbackDeviation = initialDeviation(mean, config);
  const deviation = {} as HeuristicWeightVector;
  for (const key of HEURISTIC_WEIGHT_KEYS) {
    const n = Number(rawDeviation[key]);
    deviation[key] = config.fixedKeys.includes(key) ? 0 : Math.max(0, Number.isFinite(n) ? n : fallbackDeviation[key]);
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
    rngState: intInRange(raw.rngState, config.trainingSeedBase ^ 0xA5A5A5A5, 0, 0xFFFFFFFF),
    config,
    mean,
    deviation,
    best,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function sampleCandidate(checkpoint: HeuristicTrainingCheckpoint, rng: TrainingRng, index: number): HeuristicWeightVector {
  if (index === 0) return { ...checkpoint.mean };
  const sampled = {} as HeuristicWeightVector;
  for (const key of HEURISTIC_WEIGHT_KEYS) {
    if (checkpoint.config.fixedKeys.includes(key)) {
      sampled[key] = checkpoint.mean[key];
      continue;
    }
    const limits = HEURISTIC_WEIGHT_LIMITS[key];
    sampled[key] = Math.max(limits.min, Math.min(limits.max, checkpoint.mean[key] + rng.normal() * checkpoint.deviation[key]));
  }
  return sampled;
}

function updateDistribution(checkpoint: HeuristicTrainingCheckpoint, elites: HeuristicGenerationCandidate[]): { mean: HeuristicWeightVector; deviation: HeuristicWeightVector } {
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
    nextDeviation[key] = Math.max(minDeviation, checkpoint.deviation[key] * (1 - smoothing) + Math.sqrt(Math.max(0, variance)) * smoothing);
  }
  return { mean: normalizeHeuristicWeights(nextMean), deviation: nextDeviation };
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

export async function runHeuristicTrainingGeneration(checkpointInput: HeuristicTrainingCheckpoint, runtime: HeuristicGenerationRuntime = {}): Promise<HeuristicGenerationResult> {
  const checkpoint = parseHeuristicTrainingCheckpoint(checkpointInput);
  const rng = new TrainingRng(checkpoint.rngState);
  const generation = checkpoint.generation + 1;
  const seedBase = (checkpoint.config.trainingSeedBase + (generation - 1) * checkpoint.config.seedStride) >>> 0;
  const candidates: HeuristicGenerationCandidate[] = [];

  for (let index = 0; index < checkpoint.config.population; index++) {
    if (runtime.isCanceled?.()) throw new Error("Training canceled");
    const weights = sampleCandidate(checkpoint, rng, index);
    const evaluation = await evaluateHeuristicWeights(weights, {
      games: checkpoint.config.gamesPerCandidate,
      maxPieces: checkpoint.config.maxPieces,
      seedBase,
    }, runtime);
    const candidate: HeuristicGenerationCandidate = { index, fitness: evaluation.aggregate.fitness, weights, aggregate: evaluation.aggregate };
    candidates.push(candidate);
    runtime.onCandidate?.(index + 1, checkpoint.config.population, candidate);
  }

  candidates.sort((a, b) => b.fitness - a.fitness || a.index - b.index);
  const bestCandidate = candidates[0];
  const elites = candidates.slice(0, checkpoint.config.eliteCount);
  const distribution = updateDistribution(checkpoint, elites);
  const previousBest = checkpoint.best;
  const best: HeuristicTrainingBest = !previousBest || bestCandidate.fitness > previousBest.fitness
    ? { generation, candidateIndex: bestCandidate.index, fitness: bestCandidate.fitness, weights: { ...bestCandidate.weights }, aggregate: { ...bestCandidate.aggregate } }
    : previousBest;
  const next: HeuristicTrainingCheckpoint = {
    ...checkpoint,
    generation,
    rngState: rng.state >>> 0,
    mean: distribution.mean,
    deviation: distribution.deviation,
    best,
    updatedAt: new Date().toISOString(),
  };
  return { generation, seedBase, candidates, best: bestCandidate, checkpoint: next, profile: checkpointBestProfile(next) };
}
