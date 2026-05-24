import type { AiChoice } from "./heuristic";
import { TetrisEngine, type LockResult } from "../engine/tetris";
import { applyMove, type AiMoveOp, findMoveRoute } from "./spinFinisher";

export interface BenchmarkPlacementMetrics {
  routeUsed: boolean;
  routeFailed: boolean;
  spinFinisherAttempt: boolean;
  spinFinisherSuccess: boolean;
  usedDirectApply: boolean;
}

export interface BenchmarkPlacementResult {
  result: LockResult;
  metrics: BenchmarkPlacementMetrics;
}

function isSpinFinisherChoice(choice: AiChoice): boolean {
  const info = (choice.aiInfo ?? {}) as Record<string, unknown>;
  return info.spinFinisher === true || info.source === "spin_finisher";
}

export function executeBenchmarkAction(engine: TetrisEngine, action: AiChoice): BenchmarkPlacementResult {
  const spinFinisherAttempt = isSpinFinisherChoice(action);
  if (!spinFinisherAttempt) {
    return {
      result: engine.applyAction(action),
      metrics: { routeUsed: false, routeFailed: false, spinFinisherAttempt: false, spinFinisherSuccess: false, usedDirectApply: true },
    };
  }

  const info = (action.aiInfo ?? {}) as Record<string, unknown>;
  const explicitRoute = Array.isArray(info.route) ? (info.route as AiMoveOp[]) : null;
  const route = explicitRoute ?? findMoveRoute(engine, action, true);
  if (!route) {
    return {
      result: engine.applyAction(action),
      metrics: { routeUsed: false, routeFailed: true, spinFinisherAttempt: true, spinFinisherSuccess: false, usedDirectApply: true },
    };
  }

  for (const op of route) {
    if (!applyMove(engine, op)) {
      return {
        result: engine.applyAction(action),
        metrics: { routeUsed: false, routeFailed: true, spinFinisherAttempt: true, spinFinisherSuccess: false, usedDirectApply: true },
      };
    }
  }

  const result = engine.hardDrop();
  const spinFinisherSuccess = result.ok && result.spin !== "none" && result.linesCleared > 0;
  return {
    result,
    metrics: { routeUsed: true, routeFailed: false, spinFinisherAttempt: true, spinFinisherSuccess, usedDirectApply: false },
  };
}
