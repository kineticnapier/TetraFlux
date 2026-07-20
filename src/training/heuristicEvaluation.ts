import { configureBenchmarkGarbageEnvironment, resetBenchmarkGarbageTracking, type BenchmarkGarbageEnvironmentConfig } from "../ai/benchmarkEnvironment";
import { executeBenchmarkAction } from "../ai/benchmarkRunner";
import { HeuristicAI } from "../ai/heuristic";
import { boardMetrics, TetrisEngine } from "../engine/tetris";
import { applyHeuristicWeights, type HeuristicWeightVector } from "./heuristicWeights";

export interface HeuristicEvaluationConfig {
  games: number;
  maxPieces: number;
  seedBase: number;
  seeds?: number[];
  benchmarkGarbage?: Partial<BenchmarkGarbageEnvironmentConfig>;
}

export interface HeuristicGameResult {
  seed: number;
  pieces: number;
  reachedCap: boolean;
  topout: boolean;
  lines: number;
  attack: number;
  avgHoles: number;
  avgMaxHeight: number;
  avgBumpiness: number;
  avgTotalHeight: number;
  maxObservedHeight: number;
}

export interface HeuristicEvaluationAggregate {
  games: number;
  maxPieces: number;
  pieces: number;
  survivalRate: number;
  meanSurvivalCubed: number;
  percentile10Survival: number;
  topouts: number;
  topoutRate: number;
  lines: number;
  attack: number;
  linesPerPiece: number;
  attackPerPiece: number;
  avgHoles: number;
  avgMaxHeight: number;
  avgBumpiness: number;
  avgTotalHeight: number;
  maxObservedHeight: number;
  fitness: number;
}

export interface HeuristicEvaluationResult {
  config: HeuristicEvaluationConfig;
  aggregate: HeuristicEvaluationAggregate;
  perGame: HeuristicGameResult[];
}

export interface HeuristicEvaluationRuntime {
  isCanceled?: () => boolean;
  onGame?: (completed: number, total: number, result: HeuristicGameResult) => void;
  yieldEveryGame?: boolean;
}

const OFF_GARBAGE: BenchmarkGarbageEnvironmentConfig = {
  enabled: false,
  linesPerBag: 0,
  startBag: 1,
  maxBags: 0,
  applyAfterResponse: true,
};

function percentile10(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.1) - 1)] ?? 0;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function fitnessFor(a: Omit<HeuristicEvaluationAggregate, "fitness">): number {
  return 1_000_000 * a.meanSurvivalCubed
    + 200_000 * a.percentile10Survival
    - 50_000 * a.topoutRate
    + 5_000 * a.linesPerPiece
    + 300 * a.attackPerPiece
    - 100 * a.avgHoles
    - 10 * a.avgMaxHeight
    - 2 * a.avgBumpiness;
}

function resolveSeeds(config: HeuristicEvaluationConfig): number[] {
  if (Array.isArray(config.seeds) && config.seeds.length > 0) return config.seeds.map((seed) => Math.floor(Number(seed)) >>> 0);
  return Array.from({ length: config.games }, (_, i) => (Math.floor(config.seedBase) + i * 31) >>> 0);
}

export async function evaluateHeuristicWeights(
  weights: HeuristicWeightVector,
  config: HeuristicEvaluationConfig,
  runtime: HeuristicEvaluationRuntime = {},
): Promise<HeuristicEvaluationResult> {
  const games = Math.max(1, Math.floor(config.games));
  const maxPieces = Math.max(1, Math.floor(config.maxPieces));
  const seeds = resolveSeeds({ ...config, games }).slice(0, games);
  configureBenchmarkGarbageEnvironment(config.benchmarkGarbage ?? OFF_GARBAGE);
  const perGame: HeuristicGameResult[] = [];

  for (let gameIndex = 0; gameIndex < seeds.length; gameIndex++) {
    if (runtime.isCanceled?.()) throw new Error("Training canceled");
    const seed = seeds[gameIndex];
    const engine = new TetrisEngine(seed, seed + 17);
    resetBenchmarkGarbageTracking(engine);
    const ai = new HeuristicAI();
    applyHeuristicWeights(ai, weights);

    let pieces = 0;
    let lines = 0;
    let attack = 0;
    let topout = false;
    let holesSum = 0;
    let maxHeightSum = 0;
    let bumpinessSum = 0;
    let totalHeightSum = 0;
    let maxObservedHeight = 0;

    for (let step = 0; step < maxPieces && !engine.dead; step++) {
      if (runtime.isCanceled?.()) throw new Error("Training canceled");
      const action = ai.choose(engine);
      if (!action) {
        topout = true;
        break;
      }
      const result = executeBenchmarkAction(engine, action).result;
      if (!result.ok) {
        topout = true;
        break;
      }
      pieces++;
      lines += result.linesCleared;
      attack += result.attackSent;
      const metrics = boardMetrics(engine.stateDict().board);
      holesSum += metrics.holes;
      maxHeightSum += metrics.maxHeight;
      bumpinessSum += metrics.bumpiness;
      totalHeightSum += metrics.totalHeight;
      maxObservedHeight = Math.max(maxObservedHeight, metrics.maxHeight);
      if (result.topout || engine.dead) {
        topout = true;
        break;
      }
    }

    const denominator = Math.max(1, pieces);
    const result: HeuristicGameResult = {
      seed,
      pieces,
      reachedCap: pieces >= maxPieces && !topout,
      topout,
      lines,
      attack,
      avgHoles: holesSum / denominator,
      avgMaxHeight: maxHeightSum / denominator,
      avgBumpiness: bumpinessSum / denominator,
      avgTotalHeight: totalHeightSum / denominator,
      maxObservedHeight,
    };
    perGame.push(result);
    runtime.onGame?.(gameIndex + 1, seeds.length, result);
    if (runtime.yieldEveryGame !== false) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const totalPieces = perGame.reduce((sum, game) => sum + game.pieces, 0);
  const survival = perGame.map((game) => game.pieces / maxPieces);
  const rounds = Math.max(1, totalPieces);
  const aggregateWithoutFitness: Omit<HeuristicEvaluationAggregate, "fitness"> = {
    games: perGame.length,
    maxPieces,
    pieces: totalPieces,
    survivalRate: mean(survival),
    meanSurvivalCubed: mean(survival.map((value) => value ** 3)),
    percentile10Survival: percentile10(survival),
    topouts: perGame.filter((game) => game.topout).length,
    topoutRate: perGame.filter((game) => game.topout).length / Math.max(1, perGame.length),
    lines: perGame.reduce((sum, game) => sum + game.lines, 0),
    attack: perGame.reduce((sum, game) => sum + game.attack, 0),
    linesPerPiece: perGame.reduce((sum, game) => sum + game.lines, 0) / rounds,
    attackPerPiece: perGame.reduce((sum, game) => sum + game.attack, 0) / rounds,
    avgHoles: perGame.reduce((sum, game) => sum + game.avgHoles * game.pieces, 0) / rounds,
    avgMaxHeight: perGame.reduce((sum, game) => sum + game.avgMaxHeight * game.pieces, 0) / rounds,
    avgBumpiness: perGame.reduce((sum, game) => sum + game.avgBumpiness * game.pieces, 0) / rounds,
    avgTotalHeight: perGame.reduce((sum, game) => sum + game.avgTotalHeight * game.pieces, 0) / rounds,
    maxObservedHeight: Math.max(0, ...perGame.map((game) => game.maxObservedHeight)),
  };
  return {
    config: { ...config, games: perGame.length, maxPieces, seeds },
    aggregate: { ...aggregateWithoutFitness, fitness: fitnessFor(aggregateWithoutFitness) },
    perGame,
  };
}
