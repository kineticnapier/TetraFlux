import {
  configureBenchmarkGarbageEnvironment,
  resetBenchmarkGarbageTracking,
  type BenchmarkGarbageEnvironmentConfig,
} from "../../ai/benchmarkEnvironment";
import { executeBenchmarkAction } from "../../ai/benchmarkRunner";
import { HeuristicAI } from "../../ai/heuristic";
import { boardMetrics, TetrisEngine } from "../../engine/tetris";
import { applyHeuristicWeights, type HeuristicWeightVector } from "../heuristicWeights";
import type { HeuristicGameResult } from "../core/types";

export const OFF_GARBAGE: BenchmarkGarbageEnvironmentConfig = {
  enabled: false,
  linesPerBag: 0,
  startBag: 1,
  maxBags: 0,
  applyAfterResponse: true,
};

export interface HeuristicGameRuntime {
  isCanceled?: () => boolean;
}

export function simulateHeuristicGame(
  weights: HeuristicWeightVector,
  seed: number,
  maxPieces: number,
  benchmarkGarbage: Partial<BenchmarkGarbageEnvironmentConfig> = OFF_GARBAGE,
  runtime: HeuristicGameRuntime = {},
): HeuristicGameResult {
  configureBenchmarkGarbageEnvironment(benchmarkGarbage);
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
  return {
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
}
