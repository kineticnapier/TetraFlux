import type { AiChoice } from "./heuristic";
import { TetrisEngine, type LockResult } from "../engine/tetris";
import { applyMove, type AiMoveOp, findMoveRoute } from "./spinFinisher";

export interface BenchmarkPlacementMetrics {
  routeUsed: boolean;
  routeFailed: boolean;
  spinFinisherAttempt: boolean;
  spinFinisherSuccess: boolean;
  usedDirectApply: boolean;
  tPreserveAction: boolean;
  wastedTPlacement: boolean;
  slotDestroyed: boolean;
  routeFailureReason?: string;
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
  const info = (action.aiInfo ?? {}) as Record<string, unknown>;
  const tPreserveAction = info.tPreserved === true;
  const wastedTPlacement = Number(info.wastedTPenalty ?? 0) > 0;
  const slotDestroyed = Number(info.slotDestroyedPenalty ?? 0) > 0;
  const spinFinisherAttempt = isSpinFinisherChoice(action);
  if (!spinFinisherAttempt) {
    return {
      result: engine.applyAction(action),
      metrics: { routeUsed: false, routeFailed: false, spinFinisherAttempt: false, spinFinisherSuccess: false, usedDirectApply: true, tPreserveAction, wastedTPlacement, slotDestroyed },
    };
  }

  const explicitRoute = Array.isArray(info.route) ? (info.route as AiMoveOp[]) : null;
  const route = explicitRoute ?? findMoveRoute(engine, action, true);
  if (!route) {
    const routeFailureReason = String((info.routeDiagnostics as Record<string, unknown> | undefined)?.failureReason ?? "no_path_to_target");
    return {
      result: engine.applyAction(action),
      metrics: { routeUsed: false, routeFailed: true, spinFinisherAttempt: true, spinFinisherSuccess: false, usedDirectApply: true, tPreserveAction, wastedTPlacement, slotDestroyed, routeFailureReason },
    };
  }

  for (const op of route) {
    if (!applyMove(engine, op)) {
      return {
        result: engine.applyAction(action),
        metrics: { routeUsed: false, routeFailed: true, spinFinisherAttempt: true, spinFinisherSuccess: false, usedDirectApply: true, tPreserveAction, wastedTPlacement, slotDestroyed, routeFailureReason: "final_rotation_not_possible" },
      };
    }
  }

  const result = engine.hardDrop();
  const spinFinisherSuccess = result.ok && result.spin !== "none" && result.linesCleared > 0;
  return {
    result,
    metrics: { routeUsed: true, routeFailed: false, spinFinisherAttempt: true, spinFinisherSuccess, usedDirectApply: false, tPreserveAction, wastedTPlacement, slotDestroyed },
  };
}
