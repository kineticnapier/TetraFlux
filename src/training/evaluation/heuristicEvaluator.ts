import type { HeuristicWeightVector } from "../heuristicWeights";
import type {
  HeuristicEvaluationConfig,
  HeuristicEvaluationResult,
  HeuristicEvaluationRuntime,
} from "../core/types";
import { aggregateHeuristicGames } from "./fitness";
import { OFF_GARBAGE, simulateHeuristicGame } from "./gameSimulator";

export function resolveHeuristicEvaluationSeeds(config: HeuristicEvaluationConfig): number[] {
  if (Array.isArray(config.seeds) && config.seeds.length > 0) {
    return config.seeds.map((seed) => Math.floor(Number(seed)) >>> 0);
  }
  return Array.from({ length: config.games }, (_, i) => (Math.floor(config.seedBase) + i * 31) >>> 0);
}

export async function evaluateHeuristicWeights(
  weights: HeuristicWeightVector,
  config: HeuristicEvaluationConfig,
  runtime: HeuristicEvaluationRuntime = {},
): Promise<HeuristicEvaluationResult> {
  const games = Math.max(1, Math.floor(config.games));
  const maxPieces = Math.max(1, Math.floor(config.maxPieces));
  const seeds = resolveHeuristicEvaluationSeeds({ ...config, games }).slice(0, games);
  const perGame = [];

  for (let gameIndex = 0; gameIndex < seeds.length; gameIndex++) {
    if (runtime.isCanceled?.()) throw new Error("Training canceled");
    const result = simulateHeuristicGame(
      weights,
      seeds[gameIndex],
      maxPieces,
      config.benchmarkGarbage ?? OFF_GARBAGE,
      runtime,
    );
    perGame.push(result);
    runtime.onGame?.(gameIndex + 1, seeds.length, result);
    if (runtime.yieldEveryGame !== false) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return {
    config: { ...config, games: perGame.length, maxPieces, seeds },
    aggregate: aggregateHeuristicGames(perGame, maxPieces),
    perGame,
  };
}
