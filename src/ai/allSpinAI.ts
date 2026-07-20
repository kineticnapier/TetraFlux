import { boardMetrics, TetrisEngine, type LockResult, type PlacementAction } from "../engine/tetris";
import type { AiChoice } from "./heuristic";
import { allSpinKind, isAllSpinLineClear, violatesStrictAllSpin } from "./allSpinRules";
import { executeChoiceWithOptionalRoute, generateTwistChoices, hasRouteInfo } from "./twistMoveGenerator";

export interface AllSpinAIOptions {
  depth?: number;
  beamWidth?: number;
  includeHold?: boolean;
  strictLineClears?: boolean;
  timeBudgetMs?: number;
  maxCandidatesPerNode?: number;
  maxTwistCandidates?: number;
  maxTwistStates?: number;
  maxTwistPathLength?: number;
  twistTimeBudgetMs?: number;
  includeNonClearingMechanical?: boolean;
}

type ResolvedOptions = Required<AllSpinAIOptions>;

type Probe = {
  action: AiChoice;
  engineAfter: TetrisEngine;
  result: LockResult;
  score: number;
};

type BeamNode = {
  engine: TetrisEngine;
  firstAction: AiChoice;
  sequence: AiChoice[];
  score: number;
  lastResult: LockResult;
};

const DEFAULTS: ResolvedOptions = {
  depth: 2,
  beamWidth: 40,
  includeHold: true,
  strictLineClears: true,
  timeBudgetMs: 14,
  maxCandidatesPerNode: 44,
  maxTwistCandidates: 18,
  maxTwistStates: 2200,
  maxTwistPathLength: 48,
  twistTimeBudgetMs: 4,
  includeNonClearingMechanical: false,
};

function normalizeOptions(options: AllSpinAIOptions): ResolvedOptions {
  return {
    depth: Math.max(1, Math.min(5, Math.floor(options.depth ?? DEFAULTS.depth))),
    beamWidth: Math.max(1, Math.min(400, Math.floor(options.beamWidth ?? DEFAULTS.beamWidth))),
    includeHold: options.includeHold ?? DEFAULTS.includeHold,
    strictLineClears: options.strictLineClears ?? DEFAULTS.strictLineClears,
    timeBudgetMs: Math.max(1, options.timeBudgetMs ?? DEFAULTS.timeBudgetMs),
    maxCandidatesPerNode: Math.max(1, Math.min(160, Math.floor(options.maxCandidatesPerNode ?? DEFAULTS.maxCandidatesPerNode))),
    maxTwistCandidates: Math.max(0, Math.min(80, Math.floor(options.maxTwistCandidates ?? DEFAULTS.maxTwistCandidates))),
    maxTwistStates: Math.max(100, Math.min(12000, Math.floor(options.maxTwistStates ?? DEFAULTS.maxTwistStates))),
    maxTwistPathLength: Math.max(4, Math.min(120, Math.floor(options.maxTwistPathLength ?? DEFAULTS.maxTwistPathLength))),
    twistTimeBudgetMs: Math.max(0.25, options.twistTimeBudgetMs ?? DEFAULTS.twistTimeBudgetMs),
    includeNonClearingMechanical: options.includeNonClearingMechanical ?? DEFAULTS.includeNonClearingMechanical,
  };
}

function asChoice(action: PlacementAction, info: Record<string, unknown> = {}): AiChoice {
  const existing = action as AiChoice;
  return {
    ...action,
    aiScore: Number.isFinite(existing.aiScore) ? existing.aiScore : 0,
    aiInfo: { ...(existing.aiInfo ?? {}), ...info },
  };
}

function candidateKey(action: AiChoice): string {
  const info = action.aiInfo ?? {};
  const target = info.target as { y?: number } | undefined;
  const route = Array.isArray(info.route) ? (info.route as unknown[]).join(",") : "direct";
  return `${action.hold}:${action.piece}:${action.x}:${target?.y ?? "drop"}:${action.rot}:${route}`;
}

function buildCandidates(engine: TetrisEngine, options: ResolvedOptions, deadlineMs: number, ply: number): AiChoice[] {
  const remainingMs = Math.max(0.25, deadlineMs - performance.now());
  const twistBudget = Math.min(remainingMs, ply === 0 ? options.twistTimeBudgetMs : options.twistTimeBudgetMs * 0.55);
  const twistChoices = options.maxTwistCandidates > 0
    ? generateTwistChoices(engine, {
      includeHold: options.includeHold,
      maxStates: ply === 0 ? options.maxTwistStates : Math.max(500, Math.floor(options.maxTwistStates * 0.55)),
      maxPathLength: options.maxTwistPathLength,
      maxChoices: ply === 0 ? options.maxTwistCandidates : Math.max(4, Math.floor(options.maxTwistCandidates * 0.55)),
      deadlineMs: performance.now() + twistBudget,
      includeNonClearingMechanical: options.includeNonClearingMechanical,
      allowUnsafe: false,
      allSpinScoring: options.strictLineClears,
    }).map((action) => asChoice(action, { strictAllSpin: options.strictLineClears }))
    : [];

  const direct = engine.legalPlacements(options.includeHold)
    .map((action) => asChoice(action, {
      source: "allspin_direct",
      strictAllSpin: options.strictLineClears,
    }));

  const output: AiChoice[] = [];
  const seen = new Set<string>();
  for (const action of [...twistChoices, ...direct]) {
    const key = candidateKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(action);
  }
  return output;
}

function evaluateAfterstate(before: TetrisEngine, after: TetrisEngine, action: AiChoice, result: LockResult): number {
  const beforeMetrics = boardMetrics(before.stateDict().board);
  const metrics = boardMetrics(after.stateDict().board);
  const holeDelta = metrics.holes - beforeMetrics.holes;
  const heightDelta = metrics.maxHeight - beforeMetrics.maxHeight;
  const mechanical = result.spinClassification?.mechanical === "immobile";
  const spinClear = isAllSpinLineClear(result);
  const routeLength = Array.isArray(action.aiInfo?.route) ? action.aiInfo.route.length : 0;

  let score = 0;
  score += metrics.holes * 31;
  score += Math.max(0, holeDelta) * 22;
  score += metrics.totalHeight * 0.58;
  score += metrics.bumpiness * 0.82;
  score += metrics.wells * 0.14;
  score += Math.max(0, metrics.maxHeight - 10) ** 1.35 * 3.2;
  score += Math.max(0, heightDelta - 2) * 7;
  score += routeLength * 0.025;

  score -= result.attackSent * 15;
  score -= spinClear ? 30 + result.linesCleared * 20 : 0;
  score -= mechanical && result.linesCleared === 0 ? 2.5 : 0;
  score -= after.b2b * 1.6;

  if (metrics.maxHeight >= 14 && result.linesCleared === 0) score += (metrics.maxHeight - 13) * 14;
  if (after.dead || result.topout) score += 1_000_000;
  return score;
}

function probeAction(engine: TetrisEngine, action: AiChoice, strictLineClears: boolean): Probe | null {
  const clone = engine.clone();
  const execution = executeChoiceWithOptionalRoute(clone, action);
  const result = execution.result;
  if (!result.ok || result.topout || clone.dead) return null;
  if (strictLineClears && violatesStrictAllSpin(result)) return null;

  const score = evaluateAfterstate(engine, clone, action, result);
  const decorated: AiChoice = {
    ...action,
    aiScore: score,
    aiInfo: {
      ...(action.aiInfo ?? {}),
      source: hasRouteInfo(action) ? "allspin_route" : "allspin_search",
      strictAllSpin: strictLineClears,
      allSpinClear: isAllSpinLineClear(result),
      allSpinKind: allSpinKind(result),
      lines: result.linesCleared,
      attack: result.attackSent,
      spin: result.spin,
      mechanicalSpin: result.spinClassification?.mechanical === "immobile",
      routeUsed: execution.routeUsed || undefined,
    },
  };
  return { action: decorated, engineAfter: clone, result, score };
}

export function chooseAllSpinPlacement(engine: TetrisEngine, options: AllSpinAIOptions = {}): AiChoice | null {
  const resolved = normalizeOptions(options);
  const startedAt = performance.now();
  const deadlineMs = startedAt + resolved.timeBudgetMs;
  let expandedNodes = 0;
  let rejectedNonSpinClears = 0;

  const rootCandidates = buildCandidates(engine, resolved, deadlineMs, 0);
  const roots: BeamNode[] = [];
  for (const action of rootCandidates.slice(0, resolved.maxCandidatesPerNode * 2)) {
    if (performance.now() >= deadlineMs) break;
    const preview = engine.clone();
    const execution = executeChoiceWithOptionalRoute(preview, action);
    if (resolved.strictLineClears && violatesStrictAllSpin(execution.result)) {
      rejectedNonSpinClears++;
      continue;
    }
    const probe = probeAction(engine, action, resolved.strictLineClears);
    if (!probe) continue;
    expandedNodes++;
    roots.push({
      engine: probe.engineAfter,
      firstAction: probe.action,
      sequence: [probe.action],
      score: probe.score,
      lastResult: probe.result,
    });
  }
  if (roots.length === 0) return null;

  roots.sort((a, b) => a.score - b.score);
  let beam = roots.slice(0, resolved.beamWidth);

  for (let ply = 1; ply < resolved.depth; ply++) {
    if (performance.now() >= deadlineMs) break;
    const next: BeamNode[] = [];

    for (const node of beam) {
      if (performance.now() >= deadlineMs) break;
      const candidates = buildCandidates(node.engine, resolved, deadlineMs, ply);
      const probes: Probe[] = [];

      for (const action of candidates.slice(0, resolved.maxCandidatesPerNode * 2)) {
        if (performance.now() >= deadlineMs) break;
        const preview = node.engine.clone();
        const execution = executeChoiceWithOptionalRoute(preview, action);
        if (resolved.strictLineClears && violatesStrictAllSpin(execution.result)) {
          rejectedNonSpinClears++;
          continue;
        }
        const probe = probeAction(node.engine, action, resolved.strictLineClears);
        if (probe) probes.push(probe);
      }

      probes.sort((a, b) => a.score - b.score);
      for (const probe of probes.slice(0, resolved.maxCandidatesPerNode)) {
        expandedNodes++;
        const spinChainReward = isAllSpinLineClear(node.lastResult) && isAllSpinLineClear(probe.result) ? 18 : 0;
        const score = node.score + probe.score - spinChainReward;
        next.push({
          engine: probe.engineAfter,
          firstAction: node.firstAction,
          sequence: [...node.sequence, probe.action],
          score,
          lastResult: probe.result,
        });
      }
    }

    if (next.length === 0) break;
    next.sort((a, b) => a.score - b.score);
    beam = next.slice(0, resolved.beamWidth);
  }

  beam.sort((a, b) => a.score - b.score);
  const best = beam[0];
  if (!best) return null;

  return {
    ...best.firstAction,
    aiScore: best.score,
    aiInfo: {
      ...(best.firstAction.aiInfo ?? {}),
      source: "allspin_beam",
      strictAllSpin: resolved.strictLineClears,
      searchDepth: resolved.depth,
      beamWidth: resolved.beamWidth,
      expandedNodes,
      rejectedNonSpinClears,
      plannedSequence: best.sequence.slice(0, 5).map((action) => action.key),
      plannedSpinKinds: best.sequence.slice(0, 5).map((action) => action.aiInfo?.allSpinKind ?? "unknown"),
      chooseMs: Number((performance.now() - startedAt).toFixed(3)),
    },
  };
}

export class AllSpinAI {
  constructor(public readonly options: AllSpinAIOptions = {}) {}

  choose(engine: TetrisEngine): AiChoice | null {
    return chooseAllSpinPlacement(engine, this.options);
  }
}
