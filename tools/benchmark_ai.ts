import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { randomBytes } from "node:crypto";
import { HeuristicAI, type AiChoice } from "../src/ai/heuristic";
import { LookaheadAI } from "../src/ai/lookahead";
import { estimateSpinPotential } from "../src/ai/spinPotential";
import { executeBenchmarkAction } from "../src/ai/benchmarkRunner";
import { WebPolicyAI, type WebPolicyJson } from "../src/ai/webPolicy";
import { WebValueModel, type WebValueJson } from "../src/ai/webValue";
import { boardMetrics, TetrisEngine } from "../src/engine/tetris";

type AiLike = { choose(engine: TetrisEngine): AiChoice | null };

type Aggregate = {
  games: number;
  rounds: number;
  piecesSurvived: number;
  linesCleared: number;
  attackSent: number;
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
  spinFinisherAttempts: number;
  spinFinisherSuccesses: number;
  routeFailures: number;
  directPlacements: number;
  routedPlacements: number;
  routeFailureReasons: Record<string, number>;
  routedNoSpin: number;
  routedNoClear: number;
};

type Entry = { name: string; ai: AiLike };

function parseArgs() {
  const args = process.argv.slice(2);
  let games = 50;
  let maxPieces = 500;
  let seedBase: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === "-n" || a === "--games") && args[i + 1]) games = Number(args[++i]);
    else if ((a === "-p" || a === "--max-pieces") && args[i + 1]) maxPieces = Number(args[++i]);
    else if ((a === "-s" || a === "--seed") && args[i + 1]) seedBase = Number(args[++i]);
  }
  const randomSeed = randomBytes(4).readUInt32LE(0);
  return {
    games: Number.isFinite(games) && games > 0 ? Math.floor(games) : 50,
    maxPieces: Number.isFinite(maxPieces) && maxPieces > 0 ? Math.floor(maxPieces) : 500,
    seedBase: seedBase !== null && Number.isFinite(seedBase) ? Math.floor(seedBase) : randomSeed,
  };
}

function tryReadJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

function buildAis(): Entry[] {
  const ais: Entry[] = [];
  const baseline = new HeuristicAI();
  ais.push({ name: "HeuristicAI", ai: baseline });

  const spinAi = new LookaheadAI({ depth: 1, beamWidth: 24, includeHold: true, spinBias: 1.2, maxCandidatesPerNode: 16, maxNodesPerDepth: 120, timeBudgetMs: 2.8 });
  Object.assign(spinAi, { holeWeight: 10.1, heightWeight: 0.88, maxHeightWeight: 2.35, bumpWeight: 0.55, wellWeight: 0.04, lineBonus: 3.7, attackBonus: 4.7, spinPotentialBonus: 2.95, holdPenalty: 0.01 });
  ais.push({ name: "SpinAI", ai: spinAi });

  ais.push({ name: "LookaheadAI", ai: new LookaheadAI({ depth: 3, beamWidth: 50, includeHold: true, spinBias: 1, maxCandidatesPerNode: 36, maxNodesPerDepth: 300, timeBudgetMs: 9 }) });

  const policyPath = resolve("models/web_policy.json");
  const valuePath = resolve("models/web_value.json");
  const policyJson = tryReadJson<WebPolicyJson>(policyPath);
  const valueJson = tryReadJson<WebValueJson>(valuePath);

  if (policyJson?.format === "tetraflux_web_policy_json_v1") {
    const policy = new WebPolicyAI(policyJson);
    ais.push({ name: "WebPolicyAI", ai: policy });
    if (valueJson?.format === "tetraflux_web_value_json_v1") {
      const value = new WebValueModel(valueJson);
      policy.setValueModel(value);
      ais.push({ name: "HybridAI", ai: policy });
    }
  }

  return ais;
}

function runBenchmark(entry: Entry, games: number, maxPieces: number, seedBase: number): Aggregate {
  let piecesSurvived = 0, linesCleared = 0, attackSent = 0, topoutCount = 0, tspinCount = 0, tsdCount = 0, tstCount = 0;
  let holesSum = 0, maxHeightSum = 0, bumpinessSum = 0, totalHeightSum = 0, spinPotentialCreated = 0, garbageHandled = 0;
  let decisionMsTotal = 0, decisionMsMax = 0, decisions = 0;
  let spinFinisherAttempts = 0, spinFinisherSuccesses = 0, routeFailures = 0, directPlacements = 0, routedPlacements = 0;
  let routedNoSpin = 0, routedNoClear = 0;
  const routeFailureReasons: Record<string, number> = {};

  for (let g = 0; g < games; g++) {
    const seed = seedBase + g * 31;
    const engine = new TetrisEngine(seed, seed + 17);

    for (let p = 0; p < maxPieces && !engine.dead; p++) {
      const beforePending = engine.pendingGarbage;
      const beforeState = engine.stateDict();
      const t0 = performance.now();
      const action = entry.ai.choose(engine);
      const dt = performance.now() - t0;
      decisionMsTotal += dt;
      decisionMsMax = Math.max(decisionMsMax, dt);
      decisions++;
      if (!action) { topoutCount++; break; }
      const execution = executeBenchmarkAction(engine, action);
      const result = execution.result;
      if (execution.metrics.spinFinisherAttempt) spinFinisherAttempts++;
      if (execution.metrics.spinFinisherSuccess) spinFinisherSuccesses++;
      if (execution.metrics.routeFailed) routeFailures++;
      if (execution.metrics.routedNoSpin) routedNoSpin++;
      if (execution.metrics.routedNoClear) routedNoClear++;
      if (execution.metrics.routeFailureReason) routeFailureReasons[execution.metrics.routeFailureReason] = (routeFailureReasons[execution.metrics.routeFailureReason] ?? 0) + 1;
      if (execution.metrics.routeUsed) routedPlacements++;
      if (execution.metrics.usedDirectApply) directPlacements++;
      if (!result.ok) { topoutCount++; break; }

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

      const metrics = boardMetrics(engine.stateDict().board);
      holesSum += metrics.holes;
      maxHeightSum += metrics.maxHeight;
      bumpinessSum += metrics.bumpiness;
      totalHeightSum += metrics.totalHeight;
    }
  }

  const rounds = Math.max(1, piecesSurvived);
  return {
    games, rounds, piecesSurvived, linesCleared, attackSent, topoutCount,
    avgHoles: holesSum / rounds,
    avgMaxHeight: maxHeightSum / rounds,
    avgBumpiness: bumpinessSum / rounds,
    avgTotalHeight: totalHeightSum / rounds,
    tspinCount, tsdCount, tstCount, spinPotentialCreated, garbageHandled,
    avgDecisionTimeMs: decisions > 0 ? decisionMsTotal / decisions : 0,
    maxDecisionTimeMs: decisionMsMax,
    spinFinisherAttempts,
    spinFinisherSuccesses,
    routeFailures,
    directPlacements,
    routedPlacements,
    routeFailureReasons,
    routedNoSpin,
    routedNoClear,
  };
}

function printSummary(name: string, a: Aggregate) {
  console.log(`\n=== ${name} ===`);
  console.log(`games=${a.games} pieces=${a.piecesSurvived} topouts=${a.topoutCount}`);
  console.log(`lines=${a.linesCleared} attack=${a.attackSent} garbageHandled=${a.garbageHandled.toFixed(2)}`);
  console.log(`avg holes=${a.avgHoles.toFixed(3)} maxHeight=${a.avgMaxHeight.toFixed(3)} bumpiness=${a.avgBumpiness.toFixed(3)} totalHeight=${a.avgTotalHeight.toFixed(3)}`);
  console.log(`spins: tspin=${a.tspinCount} tsd=${a.tsdCount} tst=${a.tstCount} spinPotential=${a.spinPotentialCreated.toFixed(2)}`);
  console.log(`decision ms: avg=${a.avgDecisionTimeMs.toFixed(3)} max=${a.maxDecisionTimeMs.toFixed(3)}`);
  console.log(`execution: spinFinisher attempts=${a.spinFinisherAttempts} successes=${a.spinFinisherSuccesses} routeFailures=${a.routeFailures} direct=${a.directPlacements} routed=${a.routedPlacements} routedNoSpin=${a.routedNoSpin} routedNoClear=${a.routedNoClear}`);
  console.log(`route failure reasons: ${JSON.stringify(a.routeFailureReasons)}`);
}

function main() {
  const { games, maxPieces, seedBase } = parseArgs();
  const entries = buildAis();
  const out: Record<string, Aggregate> = {};
  for (const entry of entries) {
    const res = runBenchmark(entry, games, maxPieces, seedBase);
    out[entry.name] = res;
    printSummary(entry.name, res);
  }

  mkdirSync("data", { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), games, maxPieces, seedBase, aiCount: entries.length, results: out };
  writeFileSync("data/benchmark_ai_summary.json", JSON.stringify(payload, null, 2));
  console.log("\nWrote data/benchmark_ai_summary.json");
}

main();
