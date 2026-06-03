import type { AiChoice } from "./heuristic";
import { TetrisEngine, type LockResult } from "../engine/tetris";
import { applyMove, type AiMoveOp, findMoveRoute } from "./spinFinisher";

export interface BenchmarkPlacementMetrics {
  routeUsed: boolean;
  routeFailed: boolean;
  spinFinisherAttempt: boolean;
  spinFinisherSuccess: boolean;
  physicalRouteAttempt: boolean;
  physicalRouteSuccess: boolean;
  syntheticFallbackAttempt: boolean;
  syntheticFallbackSuccess: boolean;
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

function targetYOverride(info: Record<string, unknown>): number | undefined {
  const target = info.target as Record<string, unknown> | undefined;
  const y = Number(target?.y);
  return Number.isFinite(y) ? y : undefined;
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
      metrics: {
        routeUsed: false,
        routeFailed: false,
        spinFinisherAttempt: false,
        spinFinisherSuccess: false,
        physicalRouteAttempt: false,
        physicalRouteSuccess: false,
        syntheticFallbackAttempt: false,
        syntheticFallbackSuccess: false,
        usedDirectApply: true,
        tPreserveAction,
        wastedTPlacement: wastedTPlacement || inferredWasted,
        slotDestroyed,
      },
    };
  }

  const explicitRoute = Array.isArray(info.route) ? (info.route as AiMoveOp[]) : null;
  const syntheticChoice = info.syntheticSpinFinisher === true;
  const route = explicitRoute ?? findMoveRoute(engine, action, true, undefined, undefined, targetYOverride(info));
  const makeSyntheticFallback = (physicalRouteAttempt: boolean, physicalRouteSuccess: boolean, routeFailureReason?: string): BenchmarkPlacementResult => {
    const direct = engine.applyAction(action);
    const synthetic = syntheticChoice && direct.ok && direct.linesCleared > 0;
    const result = synthetic ? withSyntheticSpinResult(direct, info) : direct;
    const syntheticFallbackSuccess = synthetic && result.spin === "tspin" && result.linesCleared > 0;
    return {
      result,
      metrics: {
        routeUsed: false,
        routeFailed: !synthetic && !physicalRouteSuccess,
        spinFinisherAttempt: true,
        spinFinisherSuccess: syntheticFallbackSuccess,
        physicalRouteAttempt,
        physicalRouteSuccess,
        syntheticFallbackAttempt: synthetic,
        syntheticFallbackSuccess,
        usedDirectApply: true,
        tPreserveAction,
        wastedTPlacement,
        slotDestroyed,
        routeFailureReason: synthetic ? routeFailureReason : (routeFailureReason ?? String((info.routeDiagnostics as Record<string, unknown> | undefined)?.failureReason ?? "no_path_to_target")),
      },
    };
  };

  if (!route) {
    const routeFailureReason = String((info.routeDiagnostics as Record<string, unknown> | undefined)?.failureReason ?? (syntheticChoice ? "synthetic_direct_finisher" : "no_path_to_target"));
    return makeSyntheticFallback(false, false, syntheticChoice ? undefined : routeFailureReason);
  }

  if (syntheticChoice) {
    const verify = engine.clone();
    let applyFailed = false;
    for (const op of route) {
      if (!applyMove(verify, op)) {
        applyFailed = true;
        break;
      }
    }
    const routeResult = applyFailed ? null : verify.hardDrop();
    const routeScores = routeResult?.ok === true &&
      routeResult.spin === "tspin" &&
      routeResult.linesCleared > 0 &&
      routeResult.lockEvent?.lastSuccessfulAction === "rotate";
    if (!routeScores) {
      const physicalRouteSuccess = !applyFailed;
      const reason = applyFailed
        ? "final_rotation_not_possible"
        : (routeResult?.spin !== "tspin" ? "route_no_spin" : "route_no_clear");
      return makeSyntheticFallback(true, physicalRouteSuccess, reason);
    }
  }

  let attemptedRoute = false;
  for (const op of route) {
    attemptedRoute = true;
    if (!applyMove(engine, op)) {
      return {
        result: engine.applyAction(action),
        metrics: {
          routeUsed: false,
          routeFailed: true,
          spinFinisherAttempt: attemptedRoute,
          spinFinisherSuccess: false,
          physicalRouteAttempt: attemptedRoute,
          physicalRouteSuccess: false,
          syntheticFallbackAttempt: false,
          syntheticFallbackSuccess: false,
          usedDirectApply: true,
          tPreserveAction,
          wastedTPlacement,
          slotDestroyed,
          routeFailureReason: "final_rotation_not_possible",
        },
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
      physicalRouteAttempt: true,
      physicalRouteSuccess: true,
      syntheticFallbackAttempt: false,
      syntheticFallbackSuccess: false,
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
