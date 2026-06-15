import type { AiChoice } from "../ai/heuristic";
import { buildBrowserAiEntries } from "../ai/registry";
import { estimateSpinPotential } from "../ai/spinPotential";
import { estimateB2BReleaseAttack, isDifficultB2BClear } from "../ai/b2bPressure";
import { executeBenchmarkAction } from "../ai/benchmarkRunner";
import {
  benchmarkGarbageConfigSummary,
  configureBenchmarkGarbageEnvironment,
  createBenchmarkGarbageAggregate,
  getBenchmarkGarbageEnvironmentConfig,
  resetBenchmarkGarbageTracking,
  updateBenchmarkGarbageAggregate,
  type BenchmarkGarbageAggregateMetrics,
  type BenchmarkGarbageEnvironmentConfig,
} from "../ai/benchmarkEnvironment";
import { boardMetrics, TetrisEngine } from "../engine/tetris";
import { applyBenchmarkTuningToAi, benchmarkTuningSummary, normalizeBenchmarkTuningConfig, type BenchmarkTuningConfig } from "./benchmarkTuning";

export type AiLike = { choose(engine: TetrisEngine): AiChoice | null };

export type Aggregate = BenchmarkGarbageAggregateMetrics & {
  games: number;
  rounds: number;
  piecesSurvived: number;
  survivalRate: number;
  linesCleared: number;
  attackSent: number;
  attackPerPiece: number;
  topoutCount: number;
  avgHoles: number;
  avgMaxHeight: number;
  avgBumpiness: number;
  avgTotalHeight: number;
  tspinCount: number;
  tsdCount: number;
  tstCount: number;
  spinPotentialCreated: number;
  garbageHandled: number;
  avgDecisionTimeMs: number;
  maxDecisionTimeMs: number;
  spinFinisherSearches: number;
  candidateRouteChecks: number;
  executionAttempts: number;
  spinFinisherAttempts: number;
  spinFinisherSuccesses: number;
  physicalRouteAttempts: number;
  physicalRouteSuccesses: number;
  syntheticFallbackAttempts: number;
  syntheticFallbackSuccesses: number;
  syntheticFinisherAttempts: number;
  syntheticFinisherSuccesses: number;
  physicalFinisherAttempts: number;
  physicalFinisherSuccesses: number;
  finalRotationFailures: number;
  routeFailures: number;
  directPlacements: number;
  routedPlacements: number;
  spinFinisherRejectReasons: Record<string, number>;
  routeFailureReasons: Record<string, number>;
  routedNoSpin: number;
  routedNoClear: number;
  tPreserveActions: number;
  wastedTPlacements: number;
  slotDestroyedCount: number;
  b2bMax: number;
  b2bEnd: number;
  b2bDifficultClears: number;
  b2bMaintains: number;
  b2bBreaks: number;
  b2bReleaseEstimateMax: number;
  b2bReleaseEstimateEnd: number;
  garbageHoleDetectedTurns: number;
  garbageHoleProgressTurns: number;
  garbageHoleWorseTurns: number;
  garbageHoleProgressTotal: number;
  garbageHoleAccessDeltaTotal: number;
  garbageHoleBlocksReduced: number;
  garbageHoleBlocksAdded: number;
  garbageHolePenaltyTotal: number;
};

export type BenchEntry = { name: string; ai: AiLike };
export type BenchConfig = {
  games: number;
  maxPieces: number;
  seedBase: number;
  aiIds?: string[];
  benchmarkGarbage?: Partial<BenchmarkGarbageEnvironmentConfig>;
  tuning?: Partial<BenchmarkTuningConfig>;
};
export type BenchPayload = {
  generatedAt: string;
  environment: "browser";
  games: number;
  maxPieces: number;
  seedBase: number;
  aiIds?: string[];
  benchmarkGarbage: BenchmarkGarbageEnvironmentConfig;
  tuning: BenchmarkTuningConfig;
  aiCount: number;
  results: Record<string, Aggregate>;
  worker?: boolean;
  canceled?: boolean;
  elapsedMs?: number;
};
export type ProgressEvent = { type: "started" | "ai_started" | "game_progress" | "ai_finished" | "finished" | "error"; message?: string; aiName?: string; game?: number; games?: number };

export const fmt = (n: number, d = 2) => Number.isFinite(n) ? n.toFixed(d) : "0";

export function renderSummary(payload: BenchPayload): string {
  const rows = Object.entries(payload.results)
    .map(([name, a]) => [
      name.padEnd(13),
      `pieces ${String(a.piecesSurvived).padStart(5)}`,
      `surv ${fmt((a.survivalRate ?? 0) * 100, 1).padStart(5)}%`,
      `topout ${String(a.topoutCount).padStart(3)}`,
      `atk ${String(a.attackSent).padStart(5)}`,
      `app ${fmt(a.attackPerPiece ?? 0, 3).padStart(5)}`,
      `b2b ${String(a.b2bMax ?? 0).padStart(3)}`,
      `b2bBr ${String(a.b2bBreaks ?? 0).padStart(3)}`,
      `holes ${fmt(a.avgHoles, 2).padStart(6)}`,
      `h ${fmt(a.avgMaxHeight, 2).padStart(5)}`,
      `bump ${fmt(a.avgBumpiness, 2).padStart(6)}`,
      `tsd ${String(a.tsdCount).padStart(3)}`,
      `tst ${String(a.tstCount).padStart(3)}`,
      `gQ ${String(a.benchmarkGarbageLinesQueued ?? 0).padStart(4)}`,
      `gC ${String(a.benchmarkGarbageLinesCancelled ?? 0).padStart(4)}`,
      `gA ${String(a.benchmarkGarbageLinesApplied ?? 0).padStart(4)}`,
      `gMax ${String(a.benchmarkGarbageMaxPending ?? 0).padStart(3)}`,
      `gTurns ${String(a.benchmarkGarbagePressureTurns ?? 0).padStart(4)}`,
      `gHole ${String(a.garbageHoleProgressTurns ?? 0).padStart(3)}/${String(a.garbageHoleWorseTurns ?? 0).padStart(3)}`,
      `gBlk ${String(a.garbageHoleBlocksReduced ?? 0).padStart(3)}`,
      `ms ${fmt(a.avgDecisionTimeMs, 2).padStart(6)}`,
      `routeChk ${String(a.candidateRouteChecks ?? a.spinFinisherAttempts ?? 0).padStart(3)}`,
      `exec ${String(a.executionAttempts ?? 0).padStart(3)}`,
      `fin ${String(a.spinFinisherSuccesses).padStart(3)}/${String(a.routedPlacements).padStart(3)}`,
      `phys ${String(a.physicalFinisherSuccesses ?? 0).padStart(3)}/${String(a.physicalFinisherAttempts ?? 0).padStart(3)}`,
      `syn ${String(a.syntheticFinisherSuccesses ?? 0).padStart(3)}/${String(a.syntheticFinisherAttempts ?? 0).padStart(3)}`,
      `search ${String(a.spinFinisherSearches ?? 0).padStart(3)}`,
    ].join(" | "))
    .join("\n");

  return [
    "TetraFlux Browser AI Benchmark",
    `generated: ${payload.generatedAt}`,
    `games=${payload.games} maxPieces=${payload.maxPieces} seed=${payload.seedBase} ai=${payload.aiCount}`,
    benchmarkGarbageConfigSummary(payload.benchmarkGarbage),
    benchmarkTuningSummary(payload.tuning),
    "",
    rows,
  ].join("\n");
}

export async function buildBrowserAis(aiIds?: string[], tuning?: Partial<BenchmarkTuningConfig>): Promise<BenchEntry[]> {
  const normalizedTuning = normalizeBenchmarkTuningConfig(tuning);
  const entries = await buildBrowserAiEntries(aiIds);
  return entries.map(({ name, ai }) => {
    applyBenchmarkTuningToAi(ai, normalizedTuning);
    return { name, ai };
  });
}

export async function runOneAi(
  entry: BenchEntry,
  cfg: BenchConfig,
  isCanceled: () => boolean,
  onProgress?: (e: ProgressEvent) => void,
): Promise<Aggregate> {
  const garbageConfig = configureBenchmarkGarbageEnvironment(cfg.benchmarkGarbage ?? getBenchmarkGarbageEnvironmentConfig());
  const garbageAggregate = createBenchmarkGarbageAggregate(garbageConfig);

  let piecesSurvived = 0;
  let linesCleared = 0;
  let attackSent = 0;
  let topoutCount = 0;
  let tspinCount = 0;
  let tsdCount = 0;
  let tstCount = 0;
  let holesSum = 0;
  let maxHeightSum = 0;
  let bumpinessSum = 0;
  let totalHeightSum = 0;
  let spinPotentialCreated = 0;
  let garbageHandled = 0;
  let decisionMsTotal = 0;
  let decisionMsMax = 0;
  let decisions = 0;
  let spinFinisherSearches = 0;
  let candidateRouteChecks = 0;
  let executionAttempts = 0;
  let spinFinisherSuccesses = 0;
  let physicalRouteAttempts = 0;
  let physicalRouteSuccesses = 0;
  let syntheticFallbackAttempts = 0;
  let syntheticFallbackSuccesses = 0;
  let syntheticFinisherAttempts = 0;
  let syntheticFinisherSuccesses = 0;
  let physicalFinisherAttempts = 0;
  let physicalFinisherSuccesses = 0;
  let finalRotationFailures = 0;
  let routeFailures = 0;
  let routedNoSpin = 0;
  let routedNoClear = 0;
  let directPlacements = 0;
  let routedPlacements = 0;
  let tPreserveActions = 0;
  let wastedTPlacements = 0;
  let slotDestroyedCount = 0;
  let b2bMax = 0;
  let b2bEnd = 0;
  let b2bDifficultClears = 0;
  let b2bMaintains = 0;
  let b2bBreaks = 0;
  let b2bReleaseEstimateMax = 0;
  let garbageHoleDetectedTurns = 0;
  let garbageHoleProgressTurns = 0;
  let garbageHoleWorseTurns = 0;
  let garbageHoleProgressTotal = 0;
  let garbageHoleAccessDeltaTotal = 0;
  let garbageHoleBlocksReduced = 0;
  let garbageHoleBlocksAdded = 0;
  let garbageHolePenaltyTotal = 0;
  const spinFinisherRejectReasons: Record<string, number> = {};
  const routeFailureReasons: Record<string, number> = {};

  for (let g = 0; g < cfg.games; g++) {
    if (isCanceled()) throw new Error("Benchmark canceled");
    const seed = cfg.seedBase + g * 31;
    const engine = new TetrisEngine(seed, seed + 17);
    resetBenchmarkGarbageTracking(engine);

    for (let p = 0; p < cfg.maxPieces && !engine.dead; p++) {
      if (isCanceled()) throw new Error("Benchmark canceled");
      const beforePending = engine.pendingGarbage;
      const beforeState = engine.stateDict();
      const t0 = performance.now();
      const action = entry.ai.choose(engine);
      const dt = performance.now() - t0;
      decisionMsTotal += dt;
      decisionMsMax = Math.max(decisionMsMax, dt);
      decisions++;
      if (!action) {
        topoutCount++;
        break;
      }

      const info = (action.aiInfo ?? {}) as Record<string, unknown>;
      if (info.spinFinisherSearch === true) spinFinisherSearches++;
      const rejected = typeof info.spinFinisherRejected === "string" ? info.spinFinisherRejected : "";
      if (rejected) spinFinisherRejectReasons[rejected] = (spinFinisherRejectReasons[rejected] ?? 0) + 1;
      const plannedRouteAttempts = Math.max(0, Math.floor(Number(info.spinFinisherRouteAttempts ?? 0)));

      const execution = executeBenchmarkAction(engine, action);
      const result = execution.result;
      const afterStateForB2B = engine.stateDict();
      const beforeB2B = Math.max(0, Math.floor(Number(beforeState.b2b ?? 0)));
      const afterB2B = Math.max(0, Math.floor(Number(afterStateForB2B.b2b ?? 0)));
      const difficultB2B = isDifficultB2BClear(result);
      if (difficultB2B) b2bDifficultClears++;
      if (beforeB2B > 0 && difficultB2B && afterB2B >= beforeB2B) b2bMaintains++;
      if (beforeB2B > 0 && result.linesCleared > 0 && !difficultB2B) b2bBreaks++;
      b2bMax = Math.max(b2bMax, beforeB2B, afterB2B);
      b2bEnd = afterB2B;
      b2bReleaseEstimateMax = Math.max(b2bReleaseEstimateMax, estimateB2BReleaseAttack(beforeB2B), estimateB2BReleaseAttack(afterB2B));
      updateBenchmarkGarbageAggregate(garbageAggregate, execution.metrics.benchmarkGarbage);
      if (execution.metrics.garbageHoleFoundBefore || execution.metrics.garbageHoleFoundAfter) garbageHoleDetectedTurns++;
      const holeProgress = Number(execution.metrics.garbageHoleProgress ?? 0);
      const holeAccessDelta = Number(execution.metrics.garbageHoleAccessDelta ?? 0);
      const holePenalty = Number(execution.metrics.garbageHolePenalty ?? 0);
      const beforeHoleBlocks = Number(execution.metrics.garbageHoleBeforeBlocks ?? 0);
      const afterHoleBlocks = Number(execution.metrics.garbageHoleAfterBlocks ?? 0);
      if (holeProgress > 0.05 || afterHoleBlocks < beforeHoleBlocks) garbageHoleProgressTurns++;
      if (holeProgress < -0.05 || afterHoleBlocks > beforeHoleBlocks) garbageHoleWorseTurns++;
      garbageHoleProgressTotal += Number.isFinite(holeProgress) ? holeProgress : 0;
      garbageHoleAccessDeltaTotal += Number.isFinite(holeAccessDelta) ? holeAccessDelta : 0;
      garbageHolePenaltyTotal += Number.isFinite(holePenalty) ? holePenalty : 0;
      garbageHoleBlocksReduced += Math.max(0, beforeHoleBlocks - afterHoleBlocks);
      garbageHoleBlocksAdded += Math.max(0, afterHoleBlocks - beforeHoleBlocks);
      candidateRouteChecks += plannedRouteAttempts;
      if (execution.metrics.spinFinisherAttempt) executionAttempts++;
      if (execution.metrics.spinFinisherSuccess) spinFinisherSuccesses++;
      if (execution.metrics.physicalRouteAttempt) physicalRouteAttempts++;
      if (execution.metrics.physicalRouteSuccess) physicalRouteSuccesses++;
      if (execution.metrics.syntheticFallbackAttempt) syntheticFallbackAttempts++;
      if (execution.metrics.syntheticFallbackSuccess) syntheticFallbackSuccesses++;
      if (execution.metrics.syntheticFallbackAttempt) syntheticFinisherAttempts++;
      if (execution.metrics.syntheticFallbackSuccess) syntheticFinisherSuccesses++;
      if (execution.metrics.physicalRouteAttempt) physicalFinisherAttempts++;
      if (execution.metrics.physicalRouteAttempt && execution.metrics.spinFinisherSuccess && !execution.metrics.syntheticFallbackSuccess) physicalFinisherSuccesses++;
      if (execution.metrics.routeFailed) routeFailures++;
      if (execution.metrics.routeFailed && execution.metrics.routeFailureReason === "final_rotation_not_possible") finalRotationFailures++;
      if (execution.metrics.routedNoSpin) routedNoSpin++;
      if (execution.metrics.routedNoClear) routedNoClear++;
      if (execution.metrics.routeFailureReason) routeFailureReasons[execution.metrics.routeFailureReason] = (routeFailureReasons[execution.metrics.routeFailureReason] ?? 0) + 1;
      if (execution.metrics.routeUsed) routedPlacements++;
      if (execution.metrics.usedDirectApply) directPlacements++;
      if (execution.metrics.tPreserveAction) tPreserveActions++;
      if (execution.metrics.wastedTPlacement) wastedTPlacements++;
      if (execution.metrics.slotDestroyed) slotDestroyedCount++;
      if (!result.ok) {
        topoutCount++;
        break;
      }

      piecesSurvived++;
      linesCleared += result.linesCleared;
      attackSent += result.attackSent;
      if (result.topout || engine.dead) topoutCount++;
      if (result.spin === "tspin") {
        tspinCount++;
        if (result.linesCleared === 2) tsdCount++;
        if (result.linesCleared === 3) tstCount++;
      }

      spinPotentialCreated += estimateSpinPotential(beforeState).bonus;
      const afterPending = engine.pendingGarbage;
      const canceled = Math.max(0, beforePending - afterPending);
      garbageHandled += canceled + Math.min(result.attackSent, beforePending);

      const m = boardMetrics(engine.stateDict().board);
      holesSum += m.holes;
      maxHeightSum += m.maxHeight;
      bumpinessSum += m.bumpiness;
      totalHeightSum += m.totalHeight;
    }

    onProgress?.({
      type: "game_progress",
      aiName: entry.name,
      game: g + 1,
      games: cfg.games,
      message: `${entry.name}: game ${g + 1}/${cfg.games}`,
    });
  }

  const rounds = Math.max(1, piecesSurvived);
  const maxPossiblePieces = Math.max(1, cfg.games * cfg.maxPieces);
  return {
    games: cfg.games,
    rounds,
    piecesSurvived,
    survivalRate: piecesSurvived / maxPossiblePieces,
    linesCleared,
    attackSent,
    attackPerPiece: attackSent / rounds,
    topoutCount,
    avgHoles: holesSum / rounds,
    avgMaxHeight: maxHeightSum / rounds,
    avgBumpiness: bumpinessSum / rounds,
    avgTotalHeight: totalHeightSum / rounds,
    tspinCount,
    tsdCount,
    tstCount,
    spinPotentialCreated,
    garbageHandled,
    avgDecisionTimeMs: decisions ? decisionMsTotal / decisions : 0,
    maxDecisionTimeMs: decisionMsMax,
    spinFinisherSearches,
    candidateRouteChecks,
    executionAttempts,
    spinFinisherAttempts: candidateRouteChecks,
    spinFinisherSuccesses,
    physicalRouteAttempts,
    physicalRouteSuccesses,
    syntheticFallbackAttempts,
    syntheticFallbackSuccesses,
    syntheticFinisherAttempts,
    syntheticFinisherSuccesses,
    physicalFinisherAttempts,
    physicalFinisherSuccesses,
    finalRotationFailures,
    routeFailures,
    directPlacements,
    routedPlacements,
    spinFinisherRejectReasons,
    routeFailureReasons,
    routedNoSpin,
    routedNoClear,
    tPreserveActions,
    wastedTPlacements,
    slotDestroyedCount,
    b2bMax,
    b2bEnd,
    b2bDifficultClears,
    b2bMaintains,
    b2bBreaks,
    b2bReleaseEstimateMax,
    b2bReleaseEstimateEnd: estimateB2BReleaseAttack(b2bEnd),
    garbageHoleDetectedTurns,
    garbageHoleProgressTurns,
    garbageHoleWorseTurns,
    garbageHoleProgressTotal,
    garbageHoleAccessDeltaTotal,
    garbageHoleBlocksReduced,
    garbageHoleBlocksAdded,
    garbageHolePenaltyTotal,
    ...garbageAggregate,
  };
}
