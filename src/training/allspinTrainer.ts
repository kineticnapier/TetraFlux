import { AllSpinAI } from "../ai/allSpinAI";
import { configureBenchmarkGarbageEnvironment } from "../ai/benchmarkEnvironment";
import { executeBenchmarkAction } from "../ai/benchmarkRunner";
import { allSpinKind, isAllSpinLineClear, violatesStrictAllSpin } from "../ai/allSpinRules";
import { boardMetrics, TetrisEngine } from "../engine/tetris";
import { TrainingRng } from "./core/random";
import {
  ALLSPIN_FEATURE_SET,
  ALLSPIN_WEIGHT_KEYS,
  ALLSPIN_WEIGHT_LIMITS,
  DEFAULT_ALLSPIN_SEARCH,
  DEFAULT_ALLSPIN_WEIGHTS,
  createAllSpinWeightProfile,
  normalizeAllSpinSearch,
  normalizeAllSpinWeights,
  parseAllSpinWeightProfile,
  type AllSpinSearchProfile,
  type AllSpinWeightKey,
  type AllSpinWeightProfileV1,
  type AllSpinWeightVector,
} from "./allspinWeights";
import { parseHeuristicWeightProfile, type HeuristicWeightProfileV1 } from "./heuristicWeights";

export const ALLSPIN_CHECKPOINT_FORMAT = "tetraflux_allspin_training_checkpoint_v1" as const;

export interface AllSpinTrainingConfig {
  population: number;
  eliteCount: number;
  gamesPerCandidate: number;
  maxPieces: number;
  trainingSeedBase: number;
  seedStride: number;
  initialSigma: number;
  minRelativeSigma: number;
  smoothing: number;
  fixedKeys: AllSpinWeightKey[];
}

export interface AllSpinGameResult {
  seed: number;
  pieces: number;
  reachedCap: boolean;
  topout: boolean;
  noLegalAction: boolean;
  ordinaryClearViolations: number;
  allSpinClears: number;
  allSpinLines: number;
  attack: number;
  maxSpinChain: number;
  routeAttempts: number;
  routeFailures: number;
  avgHoles: number;
  avgMaxHeight: number;
  spinKinds: Record<string, number>;
  spinPieces: Record<string, number>;
}

export interface AllSpinEvaluationAggregate {
  games: number;
  maxPieces: number;
  pieces: number;
  survivalRate: number;
  meanSurvivalCubed: number;
  percentile10Survival: number;
  topouts: number;
  noLegalActions: number;
  ordinaryClearViolations: number;
  allSpinClears: number;
  allSpinLines: number;
  attack: number;
  allSpinClearsPerPiece: number;
  allSpinLinesPerPiece: number;
  attackPerPiece: number;
  spinPieceCoverage: number;
  uniqueSpinPieces: number;
  maxSpinChain: number;
  routeAttempts: number;
  routeFailures: number;
  routeFailureRate: number;
  avgHoles: number;
  avgMaxHeight: number;
  spinKinds: Record<string, number>;
  spinPieces: Record<string, number>;
  fitness: number;
}

export interface AllSpinTrainingBest {
  generation: number;
  candidateIndex: number;
  fitness: number;
  weights: AllSpinWeightVector;
  aggregate: AllSpinEvaluationAggregate;
}

export interface AllSpinTrainingCheckpoint {
  format: typeof ALLSPIN_CHECKPOINT_FORMAT;
  schemaVersion: 1;
  featureSet: typeof ALLSPIN_FEATURE_SET;
  algorithm: "cem";
  generation: number;
  rngState: number;
  config: AllSpinTrainingConfig;
  baseHeuristic: HeuristicWeightProfileV1;
  search: AllSpinSearchProfile;
  parentModelId?: string;
  mean: AllSpinWeightVector;
  deviation: AllSpinWeightVector;
  best: AllSpinTrainingBest | null;
  updatedAt: string;
}

export interface AllSpinCandidate {
  index: number;
  weights: AllSpinWeightVector;
  fitness: number;
  aggregate: AllSpinEvaluationAggregate;
}

export interface AllSpinGenerationResult {
  generation: number;
  seedBase: number;
  candidates: AllSpinCandidate[];
  best: AllSpinCandidate;
  checkpoint: AllSpinTrainingCheckpoint;
  profile: AllSpinWeightProfileV1;
}

export interface AllSpinEvaluationRuntime {
  isCanceled?: () => boolean;
  onGame?: (completed: number, total: number, game: AllSpinGameResult) => void;
}

export const DEFAULT_ALLSPIN_TRAINING_CONFIG: AllSpinTrainingConfig = {
  population: 8,
  eliteCount: 2,
  gamesPerCandidate: 2,
  maxPieces: 100,
  trainingSeedBase: 246813579,
  seedStride: 100_003,
  initialSigma: 0.2,
  minRelativeSigma: 0.02,
  smoothing: 0.65,
  fixedKeys: [],
};

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function uint32(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) >>> 0 : fallback >>> 0;
}

function initialRngState(seed: number): number {
  return (seed ^ 0x51F15EED) >>> 0;
}

export function normalizeAllSpinTrainingConfig(input: Partial<AllSpinTrainingConfig> = {}): AllSpinTrainingConfig {
  const defaults = DEFAULT_ALLSPIN_TRAINING_CONFIG;
  const population = intInRange(input.population, defaults.population, 2, 64);
  const eliteCount = intInRange(input.eliteCount, Math.min(defaults.eliteCount, population), 1, Math.max(1, population - 1));
  const fixedKeys = Array.isArray(input.fixedKeys)
    ? input.fixedKeys.filter((key): key is AllSpinWeightKey => ALLSPIN_WEIGHT_KEYS.includes(key as AllSpinWeightKey))
    : [...defaults.fixedKeys];
  return {
    population,
    eliteCount,
    gamesPerCandidate: intInRange(input.gamesPerCandidate, defaults.gamesPerCandidate, 1, 32),
    maxPieces: intInRange(input.maxPieces, defaults.maxPieces, 20, 1000),
    trainingSeedBase: uint32(input.trainingSeedBase, defaults.trainingSeedBase),
    seedStride: intInRange(input.seedStride, defaults.seedStride, 1, 0x7fffffff),
    initialSigma: numberInRange(input.initialSigma, defaults.initialSigma, 0.001, 2),
    minRelativeSigma: numberInRange(input.minRelativeSigma, defaults.minRelativeSigma, 0.0001, 0.5),
    smoothing: numberInRange(input.smoothing, defaults.smoothing, 0.05, 1),
    fixedKeys: [...new Set(fixedKeys)],
  };
}

function initialDeviation(mean: AllSpinWeightVector, config: AllSpinTrainingConfig): AllSpinWeightVector {
  const out = {} as AllSpinWeightVector;
  for (const key of ALLSPIN_WEIGHT_KEYS) {
    out[key] = config.fixedKeys.includes(key) ? 0 : Math.max(0.01, Math.abs(mean[key]) * config.initialSigma);
  }
  return out;
}

export function createInitialAllSpinCheckpoint(input: {
  baseHeuristic: unknown;
  config?: Partial<AllSpinTrainingConfig>;
  weights?: Partial<Record<AllSpinWeightKey, unknown>>;
  search?: Partial<AllSpinSearchProfile>;
  parentModelId?: string;
}): AllSpinTrainingCheckpoint {
  const config = normalizeAllSpinTrainingConfig(input.config);
  const mean = normalizeAllSpinWeights(input.weights, DEFAULT_ALLSPIN_WEIGHTS);
  return {
    format: ALLSPIN_CHECKPOINT_FORMAT,
    schemaVersion: 1,
    featureSet: ALLSPIN_FEATURE_SET,
    algorithm: "cem",
    generation: 0,
    rngState: initialRngState(config.trainingSeedBase),
    config,
    baseHeuristic: parseHeuristicWeightProfile(input.baseHeuristic),
    search: normalizeAllSpinSearch(input.search ?? DEFAULT_ALLSPIN_SEARCH),
    parentModelId: input.parentModelId,
    mean,
    deviation: initialDeviation(mean, config),
    best: null,
    updatedAt: new Date().toISOString(),
  };
}

export function parseAllSpinTrainingCheckpoint(input: unknown): AllSpinTrainingCheckpoint {
  if (!input || typeof input !== "object") throw new Error("All-Spin checkpoint must be an object");
  const raw = input as Record<string, unknown>;
  if (raw.format !== ALLSPIN_CHECKPOINT_FORMAT) throw new Error(`Unsupported All-Spin checkpoint: ${String(raw.format ?? "missing")}`);
  if (raw.featureSet !== ALLSPIN_FEATURE_SET) throw new Error(`Unsupported All-Spin feature set: ${String(raw.featureSet ?? "missing")}`);
  const config = normalizeAllSpinTrainingConfig(raw.config as Partial<AllSpinTrainingConfig> | undefined);
  const mean = normalizeAllSpinWeights(raw.mean as Partial<Record<AllSpinWeightKey, unknown>> | undefined);
  const fallbackDeviation = initialDeviation(mean, config);
  const deviation = {} as AllSpinWeightVector;
  const rawDeviation = raw.deviation && typeof raw.deviation === "object"
    ? raw.deviation as Partial<Record<AllSpinWeightKey, unknown>>
    : {};
  for (const key of ALLSPIN_WEIGHT_KEYS) {
    const n = Number(rawDeviation[key]);
    deviation[key] = config.fixedKeys.includes(key) ? 0 : Math.max(0, Number.isFinite(n) ? n : fallbackDeviation[key]);
  }
  const bestRaw = raw.best && typeof raw.best === "object" ? raw.best as AllSpinTrainingBest : null;
  const best = bestRaw && Number.isFinite(Number(bestRaw.fitness))
    ? { ...bestRaw, weights: normalizeAllSpinWeights(bestRaw.weights) }
    : null;
  return {
    format: ALLSPIN_CHECKPOINT_FORMAT,
    schemaVersion: 1,
    featureSet: ALLSPIN_FEATURE_SET,
    algorithm: "cem",
    generation: intInRange(raw.generation, 0, 0, 1_000_000),
    rngState: uint32(raw.rngState, initialRngState(config.trainingSeedBase)),
    config,
    baseHeuristic: parseHeuristicWeightProfile(raw.baseHeuristic),
    search: normalizeAllSpinSearch(raw.search as Partial<AllSpinSearchProfile> | undefined),
    parentModelId: typeof raw.parentModelId === "string" ? raw.parentModelId : undefined,
    mean,
    deviation,
    best,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

export function sampleAllSpinPopulation(checkpoint: AllSpinTrainingCheckpoint): {
  candidates: Array<{ index: number; weights: AllSpinWeightVector }>;
  nextRngState: number;
} {
  const rng = new TrainingRng(checkpoint.rngState);
  const candidates: Array<{ index: number; weights: AllSpinWeightVector }> = [];
  for (let index = 0; index < checkpoint.config.population; index++) {
    if (index === 0) {
      candidates.push({ index, weights: { ...checkpoint.mean } });
      continue;
    }
    const weights = {} as AllSpinWeightVector;
    for (const key of ALLSPIN_WEIGHT_KEYS) {
      if (checkpoint.config.fixedKeys.includes(key)) {
        weights[key] = checkpoint.mean[key];
        continue;
      }
      const limits = ALLSPIN_WEIGHT_LIMITS[key];
      const value = checkpoint.mean[key] + rng.normal() * checkpoint.deviation[key];
      weights[key] = Math.max(limits.min, Math.min(limits.max, value));
    }
    candidates.push({ index, weights });
  }
  return { candidates, nextRngState: rng.state >>> 0 };
}

function percentile10(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.1))] ?? 0;
}

function addCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value;
}

function simulateAllSpinGame(
  baseHeuristic: HeuristicWeightProfileV1,
  weights: AllSpinWeightVector,
  search: AllSpinSearchProfile,
  seed: number,
  maxPieces: number,
  isCanceled?: () => boolean,
): AllSpinGameResult {
  configureBenchmarkGarbageEnvironment({ enabled: false, linesPerBag: 0, startBag: 1, maxBags: 0, applyAfterResponse: false });
  const engine = new TetrisEngine(seed, (seed + 17) >>> 0);
  const ai = new AllSpinAI({
    strictLineClears: true,
    includeHold: true,
    searchBudgetMode: "nodes",
    timeBudgetMs: 60_000,
    ...search,
    baseHeuristicWeights: baseHeuristic.weights,
    weights,
  });
  let pieces = 0;
  let noLegalAction = false;
  let ordinaryClearViolations = 0;
  let allSpinClears = 0;
  let allSpinLines = 0;
  let attack = 0;
  let chain = 0;
  let maxSpinChain = 0;
  let routeAttempts = 0;
  let routeFailures = 0;
  let holesSum = 0;
  let maxHeightSum = 0;
  const spinKinds: Record<string, number> = {};
  const spinPieces: Record<string, number> = {};

  while (pieces < maxPieces && !engine.dead) {
    if (isCanceled?.()) throw new Error("Training canceled");
    const action = ai.choose(engine);
    if (!action) {
      noLegalAction = true;
      break;
    }
    const execution = executeBenchmarkAction(engine, action);
    const result = execution.result;
    if (!result.ok || result.topout || engine.dead) break;
    pieces++;
    if (execution.metrics.physicalRouteAttempt || execution.metrics.routeUsed) routeAttempts++;
    if (execution.metrics.routeFailed) routeFailures++;
    if (violatesStrictAllSpin(result)) {
      ordinaryClearViolations++;
      break;
    }
    if (isAllSpinLineClear(result)) {
      allSpinClears++;
      allSpinLines += result.linesCleared;
      attack += result.attackSent;
      chain++;
      maxSpinChain = Math.max(maxSpinChain, chain);
      const kind = allSpinKind(result);
      spinKinds[kind] = (spinKinds[kind] ?? 0) + 1;
      const piece = String(result.piece ?? "unknown").toUpperCase();
      spinPieces[piece] = (spinPieces[piece] ?? 0) + 1;
    } else {
      chain = 0;
      attack += result.attackSent;
    }
    const metrics = boardMetrics(engine.stateDict().board);
    holesSum += metrics.holes;
    maxHeightSum += metrics.maxHeight;
  }

  return {
    seed,
    pieces,
    reachedCap: pieces >= maxPieces && !engine.dead,
    topout: engine.dead || (pieces < maxPieces && !noLegalAction),
    noLegalAction,
    ordinaryClearViolations,
    allSpinClears,
    allSpinLines,
    attack,
    maxSpinChain,
    routeAttempts,
    routeFailures,
    avgHoles: pieces > 0 ? holesSum / pieces : 99,
    avgMaxHeight: pieces > 0 ? maxHeightSum / pieces : 99,
    spinKinds,
    spinPieces,
  };
}

function aggregateAllSpinGames(games: AllSpinGameResult[], maxPieces: number): AllSpinEvaluationAggregate {
  const pieces = games.reduce((sum, game) => sum + game.pieces, 0);
  const survivalValues = games.map((game) => Math.min(1, game.pieces / maxPieces));
  const spinKinds: Record<string, number> = {};
  const spinPieces: Record<string, number> = {};
  for (const game of games) {
    addCounts(spinKinds, game.spinKinds);
    addCounts(spinPieces, game.spinPieces);
  }
  const allSpinClears = games.reduce((sum, game) => sum + game.allSpinClears, 0);
  const allSpinLines = games.reduce((sum, game) => sum + game.allSpinLines, 0);
  const attack = games.reduce((sum, game) => sum + game.attack, 0);
  const routeAttempts = games.reduce((sum, game) => sum + game.routeAttempts, 0);
  const routeFailures = games.reduce((sum, game) => sum + game.routeFailures, 0);
  const uniqueSpinPieces = ["T", "I", "J", "L", "S", "Z"].filter((piece) => (spinPieces[piece] ?? 0) > 0).length;
  const meanSurvivalCubed = survivalValues.length > 0
    ? survivalValues.reduce((sum, value) => sum + value ** 3, 0) / survivalValues.length
    : 0;
  const p10 = percentile10(survivalValues);
  const spinRate = pieces > 0 ? allSpinClears / pieces : 0;
  const lineRate = pieces > 0 ? allSpinLines / pieces : 0;
  const attackRate = pieces > 0 ? attack / pieces : 0;
  const noLegalActions = games.filter((game) => game.noLegalAction).length;
  const ordinaryClearViolations = games.reduce((sum, game) => sum + game.ordinaryClearViolations, 0);
  const routeFailureRate = routeAttempts > 0 ? routeFailures / routeAttempts : 0;
  const avgHoles = games.length > 0 ? games.reduce((sum, game) => sum + game.avgHoles, 0) / games.length : 99;
  const avgMaxHeight = games.length > 0 ? games.reduce((sum, game) => sum + game.avgMaxHeight, 0) / games.length : 99;
  const spinPieceCoverage = uniqueSpinPieces / 6;
  const fitness =
    800_000 * meanSurvivalCubed
    + 200_000 * p10
    + 180_000 * Math.min(0.2, spinRate)
    + 80_000 * Math.min(0.4, lineRate)
    + 40_000 * Math.min(0.6, attackRate)
    + 18_000 * spinPieceCoverage
    + 2_000 * Math.max(...games.map((game) => game.maxSpinChain), 0)
    - 220_000 * (games.length > 0 ? noLegalActions / games.length : 1)
    - 300_000 * (games.length > 0 ? ordinaryClearViolations / games.length : 1)
    - 25_000 * routeFailureRate
    - 650 * avgHoles
    - 120 * avgMaxHeight;

  return {
    games: games.length,
    maxPieces,
    pieces,
    survivalRate: survivalValues.length > 0 ? survivalValues.reduce((a, b) => a + b, 0) / survivalValues.length : 0,
    meanSurvivalCubed,
    percentile10Survival: p10,
    topouts: games.filter((game) => game.topout).length,
    noLegalActions,
    ordinaryClearViolations,
    allSpinClears,
    allSpinLines,
    attack,
    allSpinClearsPerPiece: spinRate,
    allSpinLinesPerPiece: lineRate,
    attackPerPiece: attackRate,
    spinPieceCoverage,
    uniqueSpinPieces,
    maxSpinChain: Math.max(...games.map((game) => game.maxSpinChain), 0),
    routeAttempts,
    routeFailures,
    routeFailureRate,
    avgHoles,
    avgMaxHeight,
    spinKinds,
    spinPieces,
    fitness,
  };
}

export async function evaluateAllSpinWeights(input: {
  baseHeuristic: HeuristicWeightProfileV1;
  weights: AllSpinWeightVector;
  search: AllSpinSearchProfile;
  games: number;
  maxPieces: number;
  seedBase: number;
  runtime?: AllSpinEvaluationRuntime;
}): Promise<AllSpinEvaluationAggregate> {
  const games: AllSpinGameResult[] = [];
  for (let index = 0; index < input.games; index++) {
    if (input.runtime?.isCanceled?.()) throw new Error("Training canceled");
    const seed = (input.seedBase + index * 31) >>> 0;
    const game = simulateAllSpinGame(input.baseHeuristic, input.weights, input.search, seed, input.maxPieces, input.runtime?.isCanceled);
    games.push(game);
    input.runtime?.onGame?.(index + 1, input.games, game);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return aggregateAllSpinGames(games, input.maxPieces);
}

export function finalizeAllSpinGeneration(
  checkpoint: AllSpinTrainingCheckpoint,
  candidatesInput: AllSpinCandidate[],
  generation: number,
  seedBase: number,
  nextRngState: number,
): AllSpinGenerationResult {
  const candidates = [...candidatesInput].sort((a, b) => b.fitness - a.fitness || a.index - b.index);
  const best = candidates[0];
  if (!best) throw new Error("All-Spin generation produced no candidates");
  const elite = candidates.slice(0, checkpoint.config.eliteCount);
  const sampleMean = {} as AllSpinWeightVector;
  const sampleDeviation = {} as AllSpinWeightVector;
  const mean = {} as AllSpinWeightVector;
  const deviation = {} as AllSpinWeightVector;
  for (const key of ALLSPIN_WEIGHT_KEYS) {
    sampleMean[key] = elite.reduce((sum, candidate) => sum + candidate.weights[key], 0) / elite.length;
    const variance = elite.reduce((sum, candidate) => sum + (candidate.weights[key] - sampleMean[key]) ** 2, 0) / elite.length;
    sampleDeviation[key] = Math.sqrt(Math.max(0, variance));
    if (checkpoint.config.fixedKeys.includes(key)) {
      mean[key] = checkpoint.mean[key];
      deviation[key] = 0;
      continue;
    }
    const smoothing = checkpoint.config.smoothing;
    mean[key] = checkpoint.mean[key] * (1 - smoothing) + sampleMean[key] * smoothing;
    const minimum = Math.max(0.005, Math.abs(mean[key]) * checkpoint.config.minRelativeSigma);
    deviation[key] = Math.max(
      minimum,
      checkpoint.deviation[key] * (1 - smoothing) + sampleDeviation[key] * smoothing,
    );
  }
  const globalBest = !checkpoint.best || best.fitness > checkpoint.best.fitness
    ? {
      generation,
      candidateIndex: best.index,
      fitness: best.fitness,
      weights: { ...best.weights },
      aggregate: best.aggregate,
    }
    : checkpoint.best;
  const nextCheckpoint: AllSpinTrainingCheckpoint = {
    ...checkpoint,
    generation,
    rngState: nextRngState >>> 0,
    mean: normalizeAllSpinWeights(mean),
    deviation,
    best: globalBest,
    updatedAt: new Date().toISOString(),
  };
  return {
    generation,
    seedBase,
    candidates,
    best,
    checkpoint: nextCheckpoint,
    profile: checkpointBestAllSpinProfile(nextCheckpoint),
  };
}

export function checkpointBestAllSpinProfile(checkpoint: AllSpinTrainingCheckpoint): AllSpinWeightProfileV1 {
  const best = checkpoint.best;
  const aggregate = best?.aggregate;
  return createAllSpinWeightProfile({
    baseHeuristic: checkpoint.baseHeuristic,
    weights: best?.weights ?? checkpoint.mean,
    search: checkpoint.search,
    profileId: `allspin-g${String(best?.generation ?? checkpoint.generation).padStart(4, "0")}`,
    training: {
      algorithm: checkpoint.algorithm,
      generation: best?.generation ?? checkpoint.generation,
      masterSeed: checkpoint.config.trainingSeedBase,
      fitness: best?.fitness,
      parentModelId: checkpoint.parentModelId,
    },
    validation: aggregate ? {
      games: aggregate.games,
      maxPieces: aggregate.maxPieces,
      survivalRate: aggregate.survivalRate,
      topouts: aggregate.topouts,
      allSpinClearsPerPiece: aggregate.allSpinClearsPerPiece,
      attackPerPiece: aggregate.attackPerPiece,
      uniqueSpinPieces: aggregate.uniqueSpinPieces,
      routeFailureRate: aggregate.routeFailureRate,
    } : undefined,
  });
}

export function createAllSpinCheckpointFromProfile(
  profileInput: unknown,
  config?: Partial<AllSpinTrainingConfig>,
): AllSpinTrainingCheckpoint {
  const profile = parseAllSpinWeightProfile(profileInput);
  return createInitialAllSpinCheckpoint({
    baseHeuristic: profile.baseHeuristic,
    weights: profile.weights,
    search: profile.search,
    config,
    parentModelId: profile.training?.parentModelId,
  });
}
