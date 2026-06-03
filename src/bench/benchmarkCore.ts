import type { AiChoice } from "../ai/heuristic";
import { buildBrowserAiEntries } from "../ai/registry";
import { estimateSpinPotential } from "../ai/spinPotential";
import { executeBenchmarkAction } from "../ai/benchmarkRunner";
import { boardMetrics, TetrisEngine } from "../engine/tetris";

export type AiLike = { choose(engine: TetrisEngine): AiChoice | null };

export type Aggregate = {
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
  spinFinisherAttempts: number;
  spinFinisherSuccesses: number;
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
};

export type BenchEntry = { name: string; ai: AiLike };
export type BenchConfig = { games: number; maxPieces: number; seedBase: number; aiIds?: string[] };
export type BenchPayload = {
  generatedAt: string;
  environment: "browser";
  games: number;
  maxPieces: number;
  seedBase: number;
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
      `holes ${fmt(a.avgHoles, 2).padStart(6)}`,
      `h ${fmt(a.avgMaxHeight, 2).padStart(5)}`,
      `bump ${fmt(a.avgBumpiness, 2).padStart(6)}`,
      `tsd ${String(a.tsdCount).padStart(3)}`,
      `tst ${String(a.tstCount).padStart(3)}`,
      `ms ${fmt(a.avgDecisionTimeMs, 2).padStart(6)}`,
      `fin ${String(a.spinFinisherAttempts).padStart(3)}/${String(a.routedPlacements).padStart(3)}`,
      `search ${String(a.spinFinisherSearches ?? 0).padStart(3)}`,
    ].join(" | "))
    .join("\n");

  return [
    "TetraFlux Browser AI Benchmark",
    `generated: ${payload.generatedAt}`,
    `games=${payload.games} maxPieces=${payload.maxPieces} seed=${payload.seedBase} ai=${payload.aiCount}`,
    "",
    rows,
  ].join("\n");
}

export async function buildBrowserAis(aiIds?: string[]): Promise<BenchEntry[]> {
  const entries = await buildBrowserAiEntries(aiIds);
  return entries.map(({ name, ai }) => ({ name, ai }));
}

export async function runOneAi(
  entry: BenchEntry,
  cfg: BenchConfig,
  isCanceled: () => boolean,
  onProgress?: (e: ProgressEvent) => void,
): Promise<Aggregate> {
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
  let spinFinisherAttempts = 0;
  let spinFinisherSuccesses = 0;
  let routeFailures = 0;
  let routedNoSpin = 0;
  let routedNoClear = 0;
  let directPlacements = 0;
  let routedPlacements = 0;
  let tPreserveActions = 0;
  let wastedTPlacements = 0;
  let slotDestroyedCount = 0;
  const spinFinisherRejectReasons: Record<string, number> = {};
  const routeFailureReasons: Record<string, number> = {};

  for (let g = 0; g < cfg.games; g++) {
    if (isCanceled()) throw new Error("Benchmark canceled");
    const seed = cfg.seedBase + g * 31;
    const engine = new TetrisEngine(seed, seed + 17);

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
      if (plannedRouteAttempts > 0) spinFinisherAttempts += plannedRouteAttempts;
      else if (execution.metrics.spinFinisherAttempt) spinFinisherAttempts++;
      if (execution.metrics.spinFinisherSuccess) spinFinisherSuccesses++;
      if (execution.metrics.routeFailed) routeFailures++;
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
    spinFinisherAttempts,
    spinFinisherSuccesses,
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
  };
}
