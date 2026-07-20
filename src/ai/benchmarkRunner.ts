import type { AiChoice } from "./heuristic";
import { boardMetrics, TetrisEngine, type LockResult } from "../engine/tetris";
import { setAllSpinScoring } from "../engine/allSpinScoring";
import { applyMove, type AiMoveOp, findMoveRoute } from "./spinFinisher";
import { applyBenchmarkGarbageEnvironmentAfterLock, flattenBenchmarkGarbageMetrics, type BenchmarkGarbageStepMetrics } from "./benchmarkEnvironment";

export interface BenchmarkPlacementMetrics {
  routeUsed: boolean;
  routeFailed: boolean;
  spinFinisherAttempt: boolean;
  spinFinisherSuccess: boolean;
  physicalRouteAttempt?: boolean;
  physicalRouteSuccess?: boolean;
  syntheticFallbackAttempt?: boolean;
  syntheticFallbackSuccess?: boolean;
  garbageHoleColumn?: number | null;
  garbageHoleProgress?: number;
  garbageHoleAccessDelta?: number;
  garbageHolePenalty?: number;
  garbageHoleBeforeBlocks?: number;
  garbageHoleAfterBlocks?: number;
  garbageHoleFoundBefore?: boolean;
  garbageHoleFoundAfter?: boolean;
  usedDirectApply: boolean;
  tPreserveAction: boolean;
  wastedTPlacement: boolean;
  slotDestroyed: boolean;
  routeFailureReason?: string;
  routedNoSpin?: boolean;
  routedNoClear?: boolean;
  benchmarkGarbage?: BenchmarkGarbageStepMetrics;
  benchmarkGarbageEnabled?: boolean;
  benchmarkGarbageMode?: string;
  benchmarkGarbageLinesPerBag?: number;
  benchmarkGarbageStartBag?: number;
  benchmarkGarbageMaxBags?: number;
  benchmarkGarbageApplyAfterResponse?: boolean;
  benchmarkGarbagePiecesLocked?: number;
  benchmarkGarbageBagProgress?: number;
  benchmarkGarbagePendingBefore?: number;
  benchmarkGarbagePendingAfter?: number;
  benchmarkGarbageAttackSent?: number;
  benchmarkGarbageCancelled?: number;
  benchmarkGarbageApplied?: number;
  benchmarkGarbageQueued?: number;
  benchmarkGarbageBagIndex?: number;
  benchmarkGarbageBagsQueued?: number;
  benchmarkGarbageRemainingConfiguredBags?: number;
}

export interface BenchmarkPlacementResult {
  result: LockResult;
  metrics: BenchmarkPlacementMetrics;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function garbageHoleBenchmarkMetricsFromInfo(info: Record<string, unknown>): Partial<BenchmarkPlacementMetrics> {
  const rawHole = info.garbageHole as Record<string, unknown> | null | undefined;
  const columnRaw = info.garbageHoleColumn ?? rawHole?.column;
  const columnNumber = numberOrUndefined(columnRaw);
  return {
    garbageHoleColumn: columnNumber === undefined ? null : Math.floor(columnNumber),
    garbageHoleProgress: numberOrUndefined(info.garbageHoleProgress ?? rawHole?.progress),
    garbageHoleAccessDelta: numberOrUndefined(info.garbageHoleAccessDelta ?? rawHole?.accessDelta),
    garbageHolePenalty: numberOrUndefined(info.garbageHolePenalty ?? rawHole?.penalty),
    garbageHoleBeforeBlocks: numberOrUndefined(info.garbageHoleBeforeBlocks ?? (rawHole?.before as Record<string, unknown> | undefined)?.blocksAboveTarget),
    garbageHoleAfterBlocks: numberOrUndefined(info.garbageHoleAfterBlocks ?? (rawHole?.after as Record<string, unknown> | undefined)?.blocksAboveTarget),
    garbageHoleFoundBefore: Boolean(rawHole?.foundBefore ?? (rawHole?.before as Record<string, unknown> | undefined)?.found ?? false),
    garbageHoleFoundAfter: Boolean(rawHole?.foundAfter ?? (rawHole?.after as Record<string, unknown> | undefined)?.found ?? false),
  };
}

function isSpinFinisherChoice(choice: AiChoice): boolean {
  const info = (choice.aiInfo ?? {}) as Record<string, unknown>;
  return info.spinFinisher === true || info.source === "spin_finisher";
}

function withBenchmarkGarbage(engine: TetrisEngine, result: LockResult, metrics: BenchmarkPlacementMetrics): BenchmarkPlacementResult {
  const benchmarkGarbage = applyBenchmarkGarbageEnvironmentAfterLock(engine, result);
  return { result, metrics: { ...metrics, benchmarkGarbage, ...flattenBenchmarkGarbageMetrics(benchmarkGarbage) } };
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
  const explicitRoute = Array.isArray(info.route) ? (info.route as AiMoveOp[]) : null;
  const garbageHoleMetrics = garbageHoleBenchmarkMetricsFromInfo(info);
  const allSpinScoring = info.strictAllSpin === true || info.allSpinScoring === true;
  setAllSpinScoring(engine, allSpinScoring);

  if (!spinFinisherAttempt) {
    if (explicitRoute && explicitRoute.length > 0) {
      let attemptedRoute = false;
      for (const op of explicitRoute) {
        attemptedRoute = true;
        if (!applyMove(engine, op)) {
          const fallback = engine.applyAction(action);
          const inferredWasted = action.piece === "T" && fallback.ok && fallback.spin === "none" && fallback.linesCleared === 0;
          return withBenchmarkGarbage(engine, fallback, {
            ...garbageHoleMetrics,
            routeUsed: false,
            routeFailed: true,
            spinFinisherAttempt: false,
            spinFinisherSuccess: false,
            physicalRouteAttempt: true,
            physicalRouteSuccess: false,
            usedDirectApply: true,
            tPreserveAction,
            wastedTPlacement: wastedTPlacement || inferredWasted,
            slotDestroyed,
            routeFailureReason: attemptedRoute ? "route_op_failed" : "empty_route",
          });
        }
      }

      const result = engine.hardDrop();
      const routedNoSpin = result.ok && result.spin === "none";
      const routedNoClear = result.ok && result.linesCleared <= 0;
      const inferredWasted = action.piece === "T" && result.ok && result.spin === "none" && result.linesCleared === 0;
      return withBenchmarkGarbage(engine, result, {
        ...garbageHoleMetrics,
        routeUsed: true,
        routeFailed: false,
        spinFinisherAttempt: false,
        spinFinisherSuccess: false,
        physicalRouteAttempt: true,
        physicalRouteSuccess: true,
        usedDirectApply: false,
        tPreserveAction,
        wastedTPlacement: wastedTPlacement || inferredWasted,
        slotDestroyed: slotDestroyed || routedNoSpin,
        routedNoSpin,
        routedNoClear,
        routeFailureReason: routedNoSpin ? "route_no_spin" : (routedNoClear ? "route_no_clear" : undefined),
      });
    }

    const result = engine.applyAction(action);
    const inferredWasted = action.piece === "T" && result.ok && result.spin === "none" && result.linesCleared === 0;
    return withBenchmarkGarbage(engine, result, {
      ...garbageHoleMetrics,
      routeUsed: false,
      routeFailed: false,
      spinFinisherAttempt: false,
      spinFinisherSuccess: false,
      usedDirectApply: true,
      tPreserveAction,
      wastedTPlacement: wastedTPlacement || inferredWasted,
      slotDestroyed,
    });
  }

  const route = explicitRoute ?? findMoveRoute(engine, action, true);
  if (!route) {
    const direct = engine.applyAction(action);
    const synthetic = info.syntheticSpinFinisher === true && syntheticResultSafe(direct);
    const result = synthetic ? withSyntheticSpinResult(direct, info) : direct;
    const routeFailureReason = String((info.routeDiagnostics as Record<string, unknown> | undefined)?.failureReason ?? (synthetic ? "synthetic_direct_finisher" : "no_path_to_target"));
    return withBenchmarkGarbage(engine, result, {
      ...garbageHoleMetrics,
      routeUsed: false,
      routeFailed: !synthetic,
      spinFinisherAttempt: true,
      spinFinisherSuccess: synthetic && result.spin === "tspin" && result.linesCleared > 0,
      syntheticFallbackAttempt: info.syntheticSpinFinisher === true,
      syntheticFallbackSuccess: synthetic && result.spin === "tspin" && result.linesCleared > 0,
      usedDirectApply: true,
      tPreserveAction,
      wastedTPlacement,
      slotDestroyed,
      routeFailureReason,
    });
  }

  let attemptedRoute = false;
  for (const op of route) {
    attemptedRoute = true;
    if (!applyMove(engine, op)) {
      const fallback = engine.applyAction(action);
      return withBenchmarkGarbage(engine, fallback, {
        ...garbageHoleMetrics,
        routeUsed: false,
        routeFailed: true,
        spinFinisherAttempt: attemptedRoute,
        spinFinisherSuccess: false,
        physicalRouteAttempt: attemptedRoute,
        physicalRouteSuccess: false,
        usedDirectApply: true,
        tPreserveAction,
        wastedTPlacement,
        slotDestroyed,
        routeFailureReason: "final_rotation_not_possible",
      });
    }
  }

  const result = engine.hardDrop();
  const routedNoSpin = result.ok && result.spin === "none";
  const routedNoClear = result.ok && result.linesCleared <= 0;
  const spinFinisherSuccess = result.ok && result.spin === "tspin" && result.linesCleared > 0 && result.lockEvent?.lastSuccessfulAction === "rotate";
  return withBenchmarkGarbage(engine, result, {
    ...garbageHoleMetrics,
    routeUsed: true,
    routeFailed: false,
    spinFinisherAttempt: true,
    spinFinisherSuccess,
    physicalRouteAttempt: true,
    physicalRouteSuccess: true,
    usedDirectApply: false,
    tPreserveAction,
    wastedTPlacement,
    slotDestroyed: slotDestroyed || routedNoSpin,
    routedNoSpin,
    routedNoClear,
    routeFailureReason: routedNoSpin ? "route_no_spin" : (routedNoClear ? "route_no_clear" : undefined),
  });
}
