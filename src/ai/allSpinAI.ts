import { boardMetrics, TetrisEngine, type LockResult, type PlacementAction } from "../engine/tetris";
import {
  DEFAULT_ALLSPIN_SEARCH,
  DEFAULT_ALLSPIN_WEIGHTS,
  normalizeAllSpinSearch,
  normalizeAllSpinWeights,
  parseAllSpinWeightProfile,
  type AllSpinWeightKey,
  type AllSpinWeightProfileV1,
  type AllSpinWeightVector,
} from "../training/allspinWeights";
import {
  DEFAULT_HEURISTIC_WEIGHTS,
  normalizeHeuristicWeights,
  type HeuristicWeightKey,
  type HeuristicWeightVector,
} from "../training/heuristicWeights";
import type { AiChoice } from "./heuristic";
import { allSpinKind, isAllSpinLineClear, violatesStrictAllSpin } from "./allSpinRules";
import { executeChoiceWithOptionalRoute, generateTwistChoices, hasRouteInfo } from "./twistMoveGenerator";

export interface AllSpinAIOptions {
  depth?: number;
  beamWidth?: number;
  includeHold?: boolean;
  strictLineClears?: boolean;
  timeBudgetMs?: number;
  searchBudgetMode?: "time" | "nodes";
  maxExpandedNodes?: number;
  maxCandidatesPerNode?: number;
  maxTwistCandidates?: number;
  maxTwistStates?: number;
  maxTwistPathLength?: number;
  twistTimeBudgetMs?: number;
  includeNonClearingMechanical?: boolean;
  profile?: unknown;
  baseHeuristicWeights?: Partial<Record<HeuristicWeightKey, unknown>>;
  weights?: Partial<Record<AllSpinWeightKey, unknown>>;
}

interface ResolvedOptions {
  depth: number;
  beamWidth: number;
  includeHold: boolean;
  strictLineClears: boolean;
  timeBudgetMs: number;
  searchBudgetMode: "time" | "nodes";
  maxExpandedNodes: number;
  maxCandidatesPerNode: number;
  maxTwistCandidates: number;
  maxTwistStates: number;
  maxTwistPathLength: number;
  twistTimeBudgetMs: number;
  includeNonClearingMechanical: boolean;
  profileId: string | null;
  baseHeuristicWeights: HeuristicWeightVector;
  weights: AllSpinWeightVector;
}

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

const DEFAULTS = {
  includeHold: true,
  strictLineClears: true,
  timeBudgetMs: 14,
  searchBudgetMode: "time" as const,
  twistTimeBudgetMs: 4,
  includeNonClearingMechanical: false,
};

function optionalProfile(input: unknown): AllSpinWeightProfileV1 | null {
  if (!input) return null;
  return parseAllSpinWeightProfile(input);
}

function normalizeOptions(options: AllSpinAIOptions): ResolvedOptions {
  const profile = optionalProfile(options.profile);
  const profileSearch = profile?.search ?? DEFAULT_ALLSPIN_SEARCH;
  const search = normalizeAllSpinSearch({
    ...profileSearch,
    depth: options.depth ?? profileSearch.depth,
    beamWidth: options.beamWidth ?? profileSearch.beamWidth,
    maxExpandedNodes: options.maxExpandedNodes ?? profileSearch.maxExpandedNodes,
    maxCandidatesPerNode: options.maxCandidatesPerNode ?? profileSearch.maxCandidatesPerNode,
    maxTwistCandidates: options.maxTwistCandidates ?? profileSearch.maxTwistCandidates,
    maxTwistStates: options.maxTwistStates ?? profileSearch.maxTwistStates,
    maxTwistPathLength: options.maxTwistPathLength ?? profileSearch.maxTwistPathLength,
  });
  return {
    ...search,
    includeHold: options.includeHold ?? DEFAULTS.includeHold,
    strictLineClears: options.strictLineClears ?? DEFAULTS.strictLineClears,
    timeBudgetMs: Math.max(1, Number(options.timeBudgetMs ?? DEFAULTS.timeBudgetMs) || DEFAULTS.timeBudgetMs),
    searchBudgetMode: options.searchBudgetMode ?? DEFAULTS.searchBudgetMode,
    twistTimeBudgetMs: Math.max(0.25, Number(options.twistTimeBudgetMs ?? DEFAULTS.twistTimeBudgetMs) || DEFAULTS.twistTimeBudgetMs),
    includeNonClearingMechanical: options.includeNonClearingMechanical ?? DEFAULTS.includeNonClearingMechanical,
    profileId: profile?.profileId ?? null,
    baseHeuristicWeights: normalizeHeuristicWeights(
      options.baseHeuristicWeights ?? profile?.baseHeuristic.weights,
      profile?.baseHeuristic.weights ?? DEFAULT_HEURISTIC_WEIGHTS,
    ),
    weights: normalizeAllSpinWeights(options.weights ?? profile?.weights, profile?.weights ?? DEFAULT_ALLSPIN_WEIGHTS),
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

function buildCandidates(
  engine: TetrisEngine,
  options: ResolvedOptions,
  deadlineMs: number | null,
  ply: number,
): AiChoice[] {
  const twistDeadline = deadlineMs === null
    ? undefined
    : performance.now() + Math.min(
      Math.max(0.25, deadlineMs - performance.now()),
      ply === 0 ? options.twistTimeBudgetMs : options.twistTimeBudgetMs * 0.55,
    );
  const twistChoices = options.maxTwistCandidates > 0
    ? generateTwistChoices(engine, {
      includeHold: options.includeHold,
      maxStates: ply === 0 ? options.maxTwistStates : Math.max(500, Math.floor(options.maxTwistStates * 0.55)),
      maxPathLength: options.maxTwistPathLength,
      maxChoices: ply === 0 ? options.maxTwistCandidates : Math.max(4, Math.floor(options.maxTwistCandidates * 0.55)),
      deadlineMs: twistDeadline,
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

function terrainDiagnostics(board: string[], heights: number[]): {
  coveredCells: number;
  centerTower: number;
  roughPenalty: number;
} {
  let coveredCells = 0;
  for (let x = 0; x < 10; x++) {
    let cover = 0;
    for (let y = 0; y < board.length; y++) {
      if ((board[y]?.[x] ?? ".") !== ".") cover++;
      else if (cover > 0) coveredCells += cover;
    }
  }
  const centerMax = Math.max(heights[4] ?? 0, heights[5] ?? 0);
  const sideAvg = ((heights[0] ?? 0) + (heights[1] ?? 0) + (heights[8] ?? 0) + (heights[9] ?? 0)) / 4;
  const centerTower = Math.max(0, centerMax - sideAvg);
  const roughPenalty = heights.reduce((sum, h, i) => {
    const left = i > 0 ? heights[i - 1] : h;
    const right = i < heights.length - 1 ? heights[i + 1] : h;
    return sum + Math.max(0, h - Math.max(left ?? h, right ?? h) - 2);
  }, 0);
  return { coveredCells, centerTower, roughPenalty };
}

function learnedHeuristicScore(
  before: TetrisEngine,
  after: TetrisEngine,
  action: AiChoice,
  result: LockResult,
  weights: HeuristicWeightVector,
): number {
  const beforeState = before.stateDict();
  const afterState = after.stateDict();
  const beforeMetrics = boardMetrics(beforeState.board);
  const metrics = boardMetrics(afterState.board);
  const beforeTerrain = terrainDiagnostics(beforeState.board, beforeMetrics.heights);
  const terrain = terrainDiagnostics(afterState.board, metrics.heights);
  const holeDelta = metrics.holes - beforeMetrics.holes;
  const heightDelta = metrics.maxHeight - beforeMetrics.maxHeight;
  const bumpDelta = metrics.bumpiness - beforeMetrics.bumpiness;
  const centerDelta = terrain.centerTower - beforeTerrain.centerTower;

  let score = 0;
  score += weights.holeWeight * metrics.holes;
  score += weights.coveredHoleWeight * terrain.coveredCells;
  score += weights.heightWeight * metrics.totalHeight;
  score += weights.maxHeightWeight * Math.max(0, metrics.maxHeight - 9) ** 1.25;
  score += weights.maxHeightWeight * 2.2 * Math.max(0, metrics.maxHeight - 13) ** 1.5;
  score += weights.centerTowerWeight * terrain.centerTower ** 1.35;
  score += weights.bumpWeight * metrics.bumpiness;
  score += weights.bumpWeight * 1.55 * terrain.roughPenalty;
  score += weights.wellWeight * metrics.wells;
  score -= weights.lineBonus * result.linesCleared;
  score -= weights.attackBonus * result.attackSent;
  score += Math.max(0, holeDelta) * weights.newHolePenaltyWeight;
  score += Math.max(0, heightDelta - 1) * weights.maxHeightRisePenaltyWeight;
  score += Math.max(0, bumpDelta - 2) * weights.bumpRisePenaltyWeight;
  score += Math.max(0, centerDelta - 0.75) * weights.centerTowerRisePenaltyWeight;
  if (action.hold) score += weights.holdPenalty;
  return score;
}

function evaluateAfterstate(
  before: TetrisEngine,
  after: TetrisEngine,
  action: AiChoice,
  result: LockResult,
  options: ResolvedOptions,
): number {
  const beforeMetrics = boardMetrics(before.stateDict().board);
  const metrics = boardMetrics(after.stateDict().board);
  const heightDelta = metrics.maxHeight - beforeMetrics.maxHeight;
  const mechanical = result.spinClassification?.mechanical === "immobile";
  const spinClear = isAllSpinLineClear(result);
  const routeLength = Array.isArray(action.aiInfo?.route) ? action.aiInfo.route.length : 0;
  const weights = options.weights;

  let score = weights.baseHeuristicScale * learnedHeuristicScore(
    before,
    after,
    action,
    result,
    options.baseHeuristicWeights,
  );
  score += routeLength * weights.routeLengthPenalty;
  score -= result.attackSent * weights.spinAttackBonus;
  score -= spinClear ? weights.spinClearBonus + result.linesCleared * weights.spinLineBonus : 0;
  score -= mechanical && result.linesCleared === 0 ? weights.mechanicalSetupBonus : 0;
  score -= after.b2b * weights.b2bBonus;
  score += Math.max(0, heightDelta - 2) * weights.heightRisePenalty;
  if (metrics.maxHeight >= 14 && result.linesCleared === 0) {
    score += (metrics.maxHeight - 13) * weights.highStackPenalty;
  }
  if (after.dead || result.topout) score += 1_000_000;
  return score;
}

function probeAction(
  engine: TetrisEngine,
  action: AiChoice,
  options: ResolvedOptions,
): Probe | null {
  const clone = engine.clone();
  const execution = executeChoiceWithOptionalRoute(clone, action);
  const result = execution.result;
  if (!result.ok || result.topout || clone.dead) return null;
  if (options.strictLineClears && violatesStrictAllSpin(result)) return null;

  const score = evaluateAfterstate(engine, clone, action, result, options);
  const decorated: AiChoice = {
    ...action,
    aiScore: score,
    aiInfo: {
      ...(action.aiInfo ?? {}),
      source: hasRouteInfo(action) ? "allspin_route" : "allspin_search",
      strictAllSpin: options.strictLineClears,
      allSpinClear: isAllSpinLineClear(result),
      allSpinKind: allSpinKind(result),
      lines: result.linesCleared,
      attack: result.attackSent,
      spin: result.spin,
      mechanicalSpin: result.spinClassification?.mechanical === "immobile",
      routeUsed: execution.routeUsed || undefined,
      allSpinProfileId: options.profileId ?? undefined,
    },
  };
  return { action: decorated, engineAfter: clone, result, score };
}

export function chooseAllSpinPlacement(engine: TetrisEngine, input: AllSpinAIOptions = {}): AiChoice | null {
  const options = normalizeOptions(input);
  const startedAt = performance.now();
  const deadlineMs = options.searchBudgetMode === "time" ? startedAt + options.timeBudgetMs : null;
  let expandedNodes = 0;
  let rejectedNonSpinClears = 0;
  const budgetReached = () => (
    expandedNodes >= options.maxExpandedNodes
    || (deadlineMs !== null && performance.now() >= deadlineMs)
  );

  const rootCandidates = buildCandidates(engine, options, deadlineMs, 0);
  const roots: BeamNode[] = [];
  for (const action of rootCandidates.slice(0, options.maxCandidatesPerNode * 2)) {
    if (budgetReached()) break;
    const preview = engine.clone();
    const execution = executeChoiceWithOptionalRoute(preview, action);
    if (options.strictLineClears && violatesStrictAllSpin(execution.result)) {
      rejectedNonSpinClears++;
      continue;
    }
    const probe = probeAction(engine, action, options);
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
  let beam = roots.slice(0, options.beamWidth);

  for (let ply = 1; ply < options.depth; ply++) {
    if (budgetReached()) break;
    const next: BeamNode[] = [];

    for (const node of beam) {
      if (budgetReached()) break;
      const candidates = buildCandidates(node.engine, options, deadlineMs, ply);
      const probes: Probe[] = [];

      for (const action of candidates.slice(0, options.maxCandidatesPerNode * 2)) {
        if (budgetReached()) break;
        const preview = node.engine.clone();
        const execution = executeChoiceWithOptionalRoute(preview, action);
        if (options.strictLineClears && violatesStrictAllSpin(execution.result)) {
          rejectedNonSpinClears++;
          continue;
        }
        const probe = probeAction(node.engine, action, options);
        if (probe) {
          expandedNodes++;
          probes.push(probe);
        }
      }

      probes.sort((a, b) => a.score - b.score);
      for (const probe of probes.slice(0, options.maxCandidatesPerNode)) {
        const spinChainReward = isAllSpinLineClear(node.lastResult) && isAllSpinLineClear(probe.result)
          ? options.weights.spinChainBonus
          : 0;
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
    beam = next.slice(0, options.beamWidth);
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
      strictAllSpin: options.strictLineClears,
      searchDepth: options.depth,
      beamWidth: options.beamWidth,
      searchBudgetMode: options.searchBudgetMode,
      maxExpandedNodes: options.maxExpandedNodes,
      expandedNodes,
      rejectedNonSpinClears,
      plannedSequence: best.sequence.slice(0, 5).map((action) => action.key),
      plannedSpinKinds: best.sequence.slice(0, 5).map((action) => action.aiInfo?.allSpinKind ?? "unknown"),
      chooseMs: Number((performance.now() - startedAt).toFixed(3)),
      allSpinProfileId: options.profileId ?? undefined,
    },
  };
}

export class AllSpinAI {
  constructor(public readonly options: AllSpinAIOptions = {}) {}

  choose(engine: TetrisEngine): AiChoice | null {
    return chooseAllSpinPlacement(engine, this.options);
  }
}
