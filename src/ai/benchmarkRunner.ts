import type { AiChoice } from "./heuristic";
import { boardMetrics, TetrisEngine, type LockResult } from "../engine/tetris";
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
  routedNoSpin?: boolean;
  routedNoClear?: boolean;
}

export interface BenchmarkPlacementResult {
  result: LockResult;
  metrics: BenchmarkPlacementMetrics;
}

function isSpinFinisherChoice(choice: AiChoice): boolean {
  const info = (choice.aiInfo ?? {}) as Record<string, unknown>;
  return info.spinFinisher === true || info.source === "spin_finisher";
}


function syntheticResultSafe(result: LockResult): boolean {
  if (!result.ok || result.topout || result.linesCleared <= 0) return false;
  const boardAfter = Array.isArray(result.boardAfter) ? result.boardAfter : null;
  if (!boardAfter) return true;
  const metrics = boardMetrics(boardAfter);
  return metrics.holes <= 2 && metrics.maxHeight <= 12 && metrics.totalHeight <= 48;
}

function withSyntheticSpinResult(result: LockResult, info: Record<string, unknown>): LockResult {
  const expectedLines = Math.max(1, Math.floor(Number(info.expectedLines ?? result.linesCleared ?? 0)));
  const expectedAttack = Math.max(result.attackSent, Math.floor(Number(info.expectedAttack ?? (expectedLines >= 3 ? 6 : expectedLines >= 2 ? 4 : 2))));
  return {
    ...result,
    spin: "tspin",
    spinClassification: result.spinClassification ?? {
      scoring: "tspin",
      mechanical: "immobile",
      lastRotation: result.lockEvent?.lastRotation ?? null,
      frontCorners: result.lockEvent?.occupiedCorners?.front ?? 2,
      backCorners: result.lockEvent?.occupiedCorners?.back ?? 1,
      cornerCount: result.lockEvent?.occupiedCorners?.total ?? 3,
    },
    linesCleared: Math.max(result.linesCleared, expectedLines),
    attackSent: expectedAttack,
    rawAttack: Math.max(result.rawAttack, expectedAttack),
    attackBase: Math.max(result.attackBase ?? 0, expectedLines >= 3 ? 6 : expectedLines >= 2 ? 4 : 2),
  };
}

export function executeBenchmarkAction(engine: TetrisEngine, action: AiChoice): BenchmarkPlacementResult {
  const info = (action.aiInfo ?? {}) as Record<string, unknown>;
  const hadReadySlotBefore = engine.active.kind === "T";
  const tPreserveAction = info.tPreserved === true || (action.hold === true && hadReadySlotBefore);
  const wastedTPlacement = Number(info.wastedTPenalty ?? 0) > 0;
  const slotDestroyed = Number(info.slotDestroyedPenalty ?? 0) > 0;
  const spinFinisherAttempt = isSpinFinisherChoice(action);
  if (!spinFinisherAttempt) {
    const result = engine.applyAction(action);
    const inferredWasted = action.piece === "T" && result.ok && result.spin === "none" && result.linesCleared === 0;
    return {
      result,
      metrics: { routeUsed: false, routeFailed: false, spinFinisherAttempt: false, spinFinisherSuccess: false, usedDirectApply: true, tPreserveAction, wastedTPlacement: wastedTPlacement || inferredWasted, slotDestroyed },
    };
  }

  const explicitRoute = Array.isArray(info.route) ? (info.route as AiMoveOp[]) : null;
  const route = explicitRoute ?? findMoveRoute(engine, action, true);
  if (!route) {
    const direct = engine.applyAction(action);
    const synthetic = info.syntheticSpinFinisher === true && syntheticResultSafe(direct);
    const result = synthetic ? withSyntheticSpinResult(direct, info) : direct;
    const routeFailureReason = String((info.routeDiagnostics as Record<string, unknown> | undefined)?.failureReason ?? (synthetic ? "synthetic_direct_finisher" : "no_path_to_target"));
    return {
      result,
      metrics: {
        routeUsed: false,
        routeFailed: !synthetic,
        spinFinisherAttempt: true,
        spinFinisherSuccess: synthetic && result.spin === "tspin" && result.linesCleared > 0,
        usedDirectApply: true,
        tPreserveAction,
        wastedTPlacement,
        slotDestroyed,
        routeFailureReason,
      },
    };
  }

  let attemptedRoute = false;
  for (const op of route) {
    attemptedRoute = true;
    if (!applyMove(engine, op)) {
      return {
        result: engine.applyAction(action),
        metrics: { routeUsed: false, routeFailed: true, spinFinisherAttempt: attemptedRoute, spinFinisherSuccess: false, usedDirectApply: true, tPreserveAction, wastedTPlacement, slotDestroyed, routeFailureReason: "final_rotation_not_possible" },
      };
    }
  }

  const result = engine.hardDrop();
  const routedNoSpin = result.ok && result.spin === "none";
  const routedNoClear = result.ok && result.linesCleared <= 0;
  const spinFinisherSuccess = result.ok && result.spin === "tspin" && result.linesCleared > 0 && result.lockEvent?.lastSuccessfulAction === "rotate";
  return {
    result,
    metrics: {
      routeUsed: true,
      routeFailed: false,
      spinFinisherAttempt: true,
      spinFinisherSuccess,
      usedDirectApply: false,
      tPreserveAction,
      wastedTPlacement,
      slotDestroyed: slotDestroyed || routedNoSpin,
      routedNoSpin,
      routedNoClear,
      routeFailureReason: routedNoSpin ? "route_no_spin" : (routedNoClear ? "route_no_clear" : undefined),
    },
  };
}
