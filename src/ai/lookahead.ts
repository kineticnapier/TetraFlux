import { boardMetrics, TetrisEngine, type LockResult, type PlacementAction } from "../engine/tetris";
import { HeuristicAI, type AiChoice } from "./heuristic";
import { estimateSpinPotential } from "./spinPotential";
import { findReadySpinFinisherChoice, hasUsableTForFinisher } from "./spinFinisher";
import { executeChoiceWithOptionalRoute, generateTwistChoices, hasRouteInfo } from "./twistMoveGenerator";
import { adjustForGarbagePressure, getGarbagePressureContext, scoreGarbagePressureResponse, shouldSkipSpeculativeFinisher, type GarbagePressureContext } from "./garbagePressure";
import type { WebValueModel } from "./webValue";

export interface LookaheadOptions {
  depth?: number;
  beamWidth?: number;
  includeHold?: boolean;
  spinBias?: number;
  valueModel?: WebValueModel | null;
  maxCandidatesPerNode?: number;
  maxNodesPerDepth?: number;
  timeBudgetMs?: number;
  includeTwists?: boolean;
  maxTwistCandidates?: number;
  twistTimeBudgetMs?: number;
  twistBias?: number;
  useGarbagePressure?: boolean;
  garbagePressureSensitivity?: number;
}

type Node = {
  engine: TetrisEngine;
  firstAction: AiChoice;
  seq: AiChoice[];
  score: number;
  leafInfo: Record<string, unknown>;
};

type CandidateProbe = {
  action: AiChoice;
  score: number;
  info: Record<string, unknown>;
  lock: LockResult;
  engineAfter: TetrisEngine;
  routeUsed: boolean;
};

const DEFAULTS: Required<Omit<LookaheadOptions, "valueModel">> = {
  depth: 3,
  beamWidth: 50,
  includeHold: true,
  spinBias: 1,
  maxCandidatesPerNode: 36,
  maxNodesPerDepth: 300,
  timeBudgetMs: 9,
  includeTwists: false,
  maxTwistCandidates: 10,
  twistTimeBudgetMs: 2.5,
  twistBias: 1,
  useGarbagePressure: true,
  garbagePressureSensitivity: 1,
};

function isRiskyBoard(engine: TetrisEngine): boolean {
  const state = engine.stateDict();
  const m = boardMetrics(state.board);
  const topRowsBlocked = state.board.slice(0, 6).some((row) => /[^.]/.test(row));
  return m.maxHeight >= 9 || m.holes >= 2 || m.bumpiness >= 13 || m.totalHeight >= 36 || topRowsBlocked;
}

function clampDepth(engine: TetrisEngine, depth: number): number {
  const q = engine.stateDict().queue.length;
  return Math.max(1, Math.min(depth, q + 2));
}

function asChoice(action: PlacementAction, info: Record<string, unknown> = {}): AiChoice {
  const existing = action as AiChoice;
  return {
    ...action,
    aiScore: Number.isFinite(existing.aiScore) ? existing.aiScore : 0,
    aiInfo: { ...(existing.aiInfo ?? {}), ...info },
  };
}

function actionDedupeKey(action: AiChoice): string {
  const info = action.aiInfo ?? {};
  const target = info.target as { x?: number; y?: number; rot?: number } | undefined;
  const y = typeof target?.y === "number" ? target.y : "drop";
  const route = Array.isArray(info.route) ? `r:${(info.route as unknown[]).slice(-5).join(",")}` : "direct";
  return `${action.hold}:${action.piece}:${action.x}:${y}:${action.rot}:${route}`;
}

function buildCandidates(engine: TetrisEngine, o: Required<Omit<LookaheadOptions, "valueModel">>, deadlineMs: number, pressure?: GarbagePressureContext): AiChoice[] {
  const direct = engine.legalPlacements(o.includeHold).map((a) => asChoice(a, { source: "legal_direct", garbagePressureMode: pressure?.mode, pendingGarbage: pressure?.pendingGarbage }));
  if (!o.includeTwists) return direct;

  const twistDeadline = Math.min(deadlineMs, performance.now() + Math.max(0.25, o.twistTimeBudgetMs));
  const twists = generateTwistChoices(engine, {
    includeHold: o.includeHold,
    maxChoices: o.maxTwistCandidates,
    maxStates: 1400,
    maxPathLength: 34,
    deadlineMs: twistDeadline,
    includeNonClearingMechanical: false,
  });

  const out: AiChoice[] = [];
  const seen = new Set<string>();

  // Put twist choices first. Later sorting still decides, but if budgets are cut
  // short the rare routed candidates should not be starved by ordinary placements.
  for (const action of [...twists, ...direct]) {
    const key = actionDedupeKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

function terrainDiagnostics(board: string[], heights: number[]): { coveredCells: number; centerTower: number; roughPenalty: number } {
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

function evaluateChoice(engine: TetrisEngine, action: AiChoice, heuristic: HeuristicAI, spinBias: number, valueModel: WebValueModel | null | undefined, pressure?: GarbagePressureContext): CandidateProbe | null {
  const beforeState = engine.stateDict();
  const beforeMetrics = boardMetrics(beforeState.board);
  const beforeTerrain = terrainDiagnostics(beforeState.board, beforeMetrics.heights);
  const beforeSpin = estimateSpinPotential(beforeState);

  const clone = engine.clone();
  const execution = executeChoiceWithOptionalRoute(clone, action);
  const result = execution.result;
  if (!result.ok) return null;

  const state = clone.stateDict();
  const metrics = boardMetrics(state.board);
  const terrain = terrainDiagnostics(state.board, metrics.heights);
  const spinPotential = estimateSpinPotential(state);

  const spinBiasSafe = Number.isFinite(spinBias) ? Math.max(1, spinBias) : 1;
  const spinStrength = spinBiasSafe > 1 ? Math.min(2.8, spinBiasSafe) : 0;
  const actionInfo = action.aiInfo ?? {};
  const twistBiasRaw = actionInfo.twistRoute ? 1 : 0;

  const holeDelta = metrics.holes - beforeMetrics.holes;
  const maxHeightDelta = metrics.maxHeight - beforeMetrics.maxHeight;
  const bumpinessDelta = metrics.bumpiness - beforeMetrics.bumpiness;
  const centerTowerDelta = terrain.centerTower - beforeTerrain.centerTower;

  const newHolePenalty = Math.max(0, holeDelta) * heuristic.newHolePenaltyWeight;
  const maxHeightRisePenalty = Math.max(0, maxHeightDelta - 1) * heuristic.maxHeightRisePenaltyWeight;
  const bumpRisePenalty = Math.max(0, bumpinessDelta - 2) * heuristic.bumpRisePenaltyWeight;
  const centerTowerRisePenalty = Math.max(0, centerTowerDelta - 0.75) * heuristic.centerTowerRisePenaltyWeight;
  const terrainPenalty = newHolePenalty + maxHeightRisePenalty + bumpRisePenalty + centerTowerRisePenalty;
  const garbagePressure = pressure ?? getGarbagePressureContext(engine);
  const garbagePressureScore = scoreGarbagePressureResponse({
    before: garbagePressure,
    result,
    beforeMetrics,
    afterMetrics: metrics,
    holeDelta,
    maxHeightDelta,
    bumpinessDelta,
  });

  const noAttackPressure = result.attackSent <= 0 ? Math.max(0, metrics.totalHeight - 72) : 0;
  const mechanicalSpin = result.spinClassification?.mechanical === "immobile";
  const scoringSpin =
    result.spin === "tspin" ? 7.5 :
    result.spin === "tspin-mini" ? 3.2 :
    result.spin === "spin" ? 4.5 :
    0;
  const mechanicalSpinBonus = scoringSpin <= 0 && mechanicalSpin ? 1.15 : 0;
  const spinClassificationBonusApplied = (scoringSpin + mechanicalSpinBonus) * heuristic.spinClassificationBonus * (spinStrength > 0 ? spinStrength : 1);

  let spinPotentialScale = 1;
  if (metrics.holes >= 12 || metrics.maxHeight >= 18) spinPotentialScale = 0;
  else {
    if (metrics.holes >= 8) spinPotentialScale *= 0.2;
    if (metrics.maxHeight >= 16) spinPotentialScale *= 0.35;
    if (metrics.bumpiness >= 24) spinPotentialScale *= 0.55;
    if (metrics.bumpiness >= 30) spinPotentialScale *= 0.4;
    if (noAttackPressure > 0) spinPotentialScale *= Math.max(0.2, 1 - noAttackPressure / 32);
    if (holeDelta > 0) spinPotentialScale *= Math.max(0.15, 1 - holeDelta * 0.22);
  }
  spinPotentialScale = Math.max(0, Math.min(1, spinPotentialScale));
  const spinPotentialApplied = spinPotential.bonus * spinPotentialScale;

  const queue = Array.isArray(beforeState.queue) ? beforeState.queue : [];
  const tQueueIndex = queue.findIndex((p) => p === "T");
  const hasNearReadySlot = !!beforeSpin.bestTarget && beforeSpin.bestTarget.score >= 6.8 && beforeSpin.bestTarget.lineDeficit <= 4;
  const activeT = beforeState.active?.kind === "T";
  const holdT = beforeState.hold === "T";
  const queueTSoon = tQueueIndex >= 0 && tQueueIndex <= 3;
  const tAvailabilityReason = activeT ? "active" : holdT ? "hold" : queueTSoon ? `queue_${tQueueIndex}` : "unavailable";

  let tPreserved = false;
  let tPreservationBonusApplied = 0;
  let wastedTPenaltyApplied = 0;
  let slotDestroyedPenaltyApplied = 0;
  let nearReadySpinSlotBonusApplied = 0;

  if (spinStrength > 0) {
    const spinPotentialDrop = Math.max(0, beforeSpin.bonus - spinPotential.bonus);
    const usedTForOrdinary = action.piece === "T" && (result.spin === "none" || result.linesCleared <= 0);
    const usedHoldTOrdinary = usedTForOrdinary && action.hold && holdT;

    if (usedTForOrdinary && hasNearReadySlot && (activeT || holdT || queueTSoon)) {
      wastedTPenaltyApplied += heuristic.wastedTPenalty * spinStrength * (activeT || holdT ? 1.25 : 0.9);
    }
    if (usedHoldTOrdinary && metrics.maxHeight < 16) wastedTPenaltyApplied += heuristic.wastedTPenalty * 0.75 * spinStrength;
    if (hasNearReadySlot && spinPotentialDrop > 0.45) slotDestroyedPenaltyApplied += heuristic.slotDestroyedPenalty * spinStrength * Math.min(2.2, spinPotentialDrop / 0.8);
    if (!usedTForOrdinary && hasNearReadySlot && (queueTSoon || holdT || activeT)) nearReadySpinSlotBonusApplied += heuristic.nearReadySpinSlotBonus * spinStrength;
    if (action.hold && activeT && beforeState.hold !== "T" && hasNearReadySlot) {
      tPreserved = true;
      tPreservationBonusApplied += heuristic.tPreservationBonus * spinStrength * 1.15;
    } else if (!usedTForOrdinary && (holdT || queueTSoon) && hasNearReadySlot && (action.piece !== "T" || action.hold)) {
      tPreserved = true;
      tPreservationBonusApplied += heuristic.tPreservationBonus * spinStrength * 0.7;
    }
  }

  const routeBonus = hasRouteInfo(action)
    ? ((result.spin !== "none" ? 18 : mechanicalSpin ? 4.5 : 1.2) * Math.max(1, spinBiasSafe) + result.attackSent * 2.4 + result.linesCleared * 1.6)
    : 0;

  let score = 0;
  score += heuristic.holeWeight * metrics.holes;
  score += heuristic.coveredHoleWeight * terrain.coveredCells;
  score += heuristic.heightWeight * metrics.totalHeight;
  score += heuristic.maxHeightWeight * Math.max(0, metrics.maxHeight - 9) ** 1.25;
  score += heuristic.maxHeightWeight * 2.2 * Math.max(0, metrics.maxHeight - 13) ** 1.5;
  score += heuristic.centerTowerWeight * terrain.centerTower ** 1.35;
  score += heuristic.bumpWeight * metrics.bumpiness;
  score += heuristic.bumpWeight * 1.55 * terrain.roughPenalty;
  score += heuristic.wellWeight * metrics.wells;
  score -= heuristic.lineBonus * result.linesCleared;
  score -= heuristic.attackBonus * result.attackSent;
  score -= spinClassificationBonusApplied;
  score += heuristic.spinTerrainPressureWeight * noAttackPressure;
  score += terrainPenalty;
  score += garbagePressureScore.penalty;
  score -= heuristic.spinPotentialBonus * spinPotentialApplied;
  score += wastedTPenaltyApplied + slotDestroyedPenaltyApplied;
  score -= tPreservationBonusApplied + nearReadySpinSlotBonusApplied;
  score -= routeBonus;
  if (action.hold) score += heuristic.holdPenalty;
  if (clone.dead || result.topout) score += heuristic.topoutPenalty;

  const value = valueModel ? valueModel.evaluate(beforeState, action) * 0.2 : 0;
  score -= value;

  const aiInfo: Record<string, unknown> = {
    ...(action.aiInfo ?? {}),
    metrics,
    terrain,
    lines: result.linesCleared,
    attack: result.attackSent,
    spin: result.spin,
    spinClassification: result.spinClassification,
    spinClassificationBonus: Number(spinClassificationBonusApplied.toFixed(4)),
    spinPotential,
    spinPotentialRaw: spinPotential.bonus,
    spinPotentialApplied,
    spinPotentialScale: Number(spinPotentialScale.toFixed(4)),
    tAvailabilityReason,
    hasNearReadySlot,
    nearReadySlotScore: Number((beforeSpin.bestTarget?.score ?? 0).toFixed(4)),
    nearReadySlotLineDeficit: beforeSpin.bestTarget?.lineDeficit ?? null,
    tPreserved,
    tPreservationBonus: Number(tPreservationBonusApplied.toFixed(4)),
    wastedTPenalty: Number(wastedTPenaltyApplied.toFixed(4)),
    slotDestroyedPenalty: Number(slotDestroyedPenaltyApplied.toFixed(4)),
    nearReadySpinSlotBonus: Number(nearReadySpinSlotBonusApplied.toFixed(4)),
    terrainPenalty: Number(terrainPenalty.toFixed(4)),
    garbagePressure: {
      mode: garbagePressure.mode,
      pendingGarbage: garbagePressure.pendingGarbage,
      danger: garbagePressure.danger,
      penalty: Number(garbagePressureScore.penalty.toFixed(4)),
      cancelReward: Number(garbagePressureScore.cancelReward.toFixed(4)),
      clearReward: Number(garbagePressureScore.clearReward.toFixed(4)),
      downstackReward: Number(garbagePressureScore.downstackReward.toFixed(4)),
      safetyPenalty: Number(garbagePressureScore.safetyPenalty.toFixed(4)),
      estimatedRemainingGarbage: garbagePressureScore.estimatedRemainingGarbage,
    },
    garbagePressureMode: garbagePressure.mode,
    pendingGarbage: garbagePressure.pendingGarbage,
    routeBonus: Number(routeBonus.toFixed(4)),
    routeUsedInLookahead: execution.routeUsed || undefined,
    beforeMetrics: {
      ...beforeMetrics,
      centerTower: Number(beforeTerrain.centerTower.toFixed(3)),
      coveredCells: beforeTerrain.coveredCells,
      roughPenalty: Number(beforeTerrain.roughPenalty.toFixed(3)),
    },
    afterMetrics: {
      ...metrics,
      centerTower: Number(terrain.centerTower.toFixed(3)),
      coveredCells: terrain.coveredCells,
      roughPenalty: Number(terrain.roughPenalty.toFixed(3)),
    },
    deltas: {
      holes: holeDelta,
      maxHeight: maxHeightDelta,
      bumpiness: Number(bumpinessDelta.toFixed(3)),
      centerTower: Number(centerTowerDelta.toFixed(3)),
    },
    topout: clone.dead || result.topout,
    value,
    twistBias: twistBiasRaw || undefined,
  };

  return { action: { ...action, aiScore: score, aiInfo }, score, info: aiInfo, lock: result, engineAfter: clone, routeUsed: execution.routeUsed };
}

export function chooseLookaheadPlacement(engine: TetrisEngine, heuristic: HeuristicAI, options: LookaheadOptions = {}): AiChoice | null {
  const o = { ...DEFAULTS, ...options };
  const startMs = performance.now();
  const rootPressure = getGarbagePressureContext(engine);
  const pressureOptions = o.useGarbagePressure ? adjustForGarbagePressure(o, rootPressure, o.garbagePressureSensitivity) : { ...o, pressureMultiplier: 0 };
  const deadlineMs = startMs + pressureOptions.timeBudgetMs;
  const depth = clampDepth(engine, pressureOptions.depth);
  (engine as unknown as { spinBias?: number }).spinBias = pressureOptions.spinBias;

  const rootLegal = buildCandidates(engine, pressureOptions, deadlineMs, rootPressure);
  if (!rootLegal.length) return null;

  let expandedNodes = 0;
  let twistCandidatesSeen = 0;
  let routeCandidatesSeen = 0;
  const rootNodes: Node[] = [];

  for (const action of rootLegal.slice(0, pressureOptions.maxNodesPerDepth)) {
    if (performance.now() > deadlineMs) break;
    if (action.aiInfo?.twistRoute) twistCandidatesSeen++;
    if (hasRouteInfo(action)) routeCandidatesSeen++;

    const probe = evaluateChoice(engine, action, heuristic, pressureOptions.spinBias, o.valueModel, rootPressure);
    if (!probe) continue;
    expandedNodes++;
    const spinBonus = (probe.lock.spin !== "none" ? 12 : 0) + probe.lock.attackSent * 4 + probe.lock.linesCleared * 2;
    rootNodes.push({ engine: probe.engineAfter, firstAction: probe.action, seq: [probe.action], score: probe.score - spinBonus * pressureOptions.spinBias, leafInfo: probe.info });
  }

  if (!rootNodes.length) return null;
  rootNodes.sort((a, b) => a.score - b.score);
  let beam = rootNodes.slice(0, pressureOptions.beamWidth);

  for (let ply = 1; ply < depth; ply++) {
    if (performance.now() - startMs > pressureOptions.timeBudgetMs) break;
    const next: Node[] = [];

    for (const node of beam) {
      if (performance.now() - startMs > pressureOptions.timeBudgetMs) break;
      const nodePressure = getGarbagePressureContext(node.engine);
      const nodeOptions = pressureOptions.useGarbagePressure ? adjustForGarbagePressure({ ...pressureOptions, maxTwistCandidates: Math.max(2, Math.floor(pressureOptions.maxTwistCandidates / 2)) }, nodePressure, pressureOptions.garbagePressureSensitivity) : { ...pressureOptions, maxTwistCandidates: Math.max(2, Math.floor(pressureOptions.maxTwistCandidates / 2)), pressureMultiplier: 0 };
      const legal = buildCandidates(node.engine, nodeOptions, deadlineMs, nodePressure);
      if (!legal.length) {
        next.push(node);
        continue;
      }

      const ranked: CandidateProbe[] = [];
      for (const action of legal) {
        if (performance.now() - startMs > pressureOptions.timeBudgetMs) break;
        const probe = evaluateChoice(node.engine, action, heuristic, nodeOptions.spinBias, o.valueModel, nodePressure);
        if (probe) ranked.push(probe);
      }
      ranked.sort((a, b) => a.score - b.score);

      for (const cand of ranked.slice(0, nodeOptions.maxCandidatesPerNode)) {
        if (next.length >= nodeOptions.maxNodesPerDepth) break;
        expandedNodes++;

        const state = cand.engineAfter.stateDict();
        const m = boardMetrics(state.board);
        const spinPotential = estimateSpinPotential(state);
        const terrainPenalty = m.holes * 0.9 + Math.max(0, m.maxHeight - 13) * 2 + m.bumpiness * 0.12 + Math.max(0, Math.max(m.heights[4] ?? 0, m.heights[5] ?? 0) - ((m.heights[0] + m.heights[9]) / 2)) * 0.8;
        const spinPotentialReward = terrainPenalty < 18 ? spinPotential.bonus * 0.6 * nodeOptions.spinBias : spinPotential.bonus * 0.18 * nodeOptions.spinBias;
        const finisherReward = (cand.lock.spin !== "none" && cand.lock.linesCleared > 0) ? (24 + cand.lock.attackSent * 6) * nodeOptions.spinBias : 0;
        const routeReward = cand.routeUsed ? (cand.lock.spin !== "none" ? 18 : 2) * (nodeOptions.twistBias ?? 1) : 0;
        const topoutPenalty = (cand.engineAfter.dead || cand.lock.topout) ? 50000 : 0;

        const seqScore = node.score + cand.score - (cand.lock.attackSent * 2.8 + cand.lock.linesCleared * 1.6) - spinPotentialReward - finisherReward - routeReward + terrainPenalty + topoutPenalty;
        next.push({ engine: cand.engineAfter, firstAction: node.firstAction, seq: [...node.seq, cand.action], score: seqScore, leafInfo: { ...cand.info, terrainPenalty, spinPotential: spinPotential.bonus, finisherReward, routeReward } });
      }
    }

    if (!next.length) break;
    next.sort((a, b) => a.score - b.score);
    beam = next.slice(0, pressureOptions.beamWidth);
  }

  beam.sort((a, b) => a.score - b.score);
  const best = beam[0];
  if (!best) return null;

  return {
    ...best.firstAction,
    aiScore: best.score,
    aiInfo: {
      ...best.firstAction.aiInfo,
      source: best.firstAction.aiInfo?.source ?? "lookahead_beam",
      lookaheadDepth: depth,
      beamWidth: pressureOptions.beamWidth,
      garbagePressureMode: rootPressure.mode,
      pendingGarbage: rootPressure.pendingGarbage,
      garbagePressureDanger: rootPressure.danger,
      pressureAdjusted: pressureOptions.pressureMultiplier > 0 || undefined,
      expandedNodes,
      twistCandidatesSeen,
      routeCandidatesSeen,
      bestSequenceScore: Number(best.score.toFixed(3)),
      plannedSequence: best.seq.slice(0, 5).map((a) => a.key),
      leafMetrics: best.leafInfo,
      spinPlan: best.seq.some((a) => a.piece === "T"),
      chooseMs: Number((performance.now() - startMs).toFixed(3)),
    },
  };
}

export class LookaheadAI extends HeuristicAI {
  public lastSpinFinisherReason: string | null = null;
  public lastSpinFinisherRouteAttempts = 0;
  constructor(public readonly lookaheadOptions: LookaheadOptions = {}) { super(); }

  choose(engine: TetrisEngine): AiChoice | null {
    const budgetMs = this.lookaheadOptions.timeBudgetMs ?? DEFAULTS.timeBudgetMs;
    const start = performance.now();
    this.lastSpinFinisherReason = null;
    this.lastSpinFinisherRouteAttempts = 0;
    const spinBias = this.lookaheadOptions.spinBias ?? DEFAULTS.spinBias;
    const pressure = getGarbagePressureContext(engine);
    const risky = isRiskyBoard(engine);
    const usePressure = this.lookaheadOptions.useGarbagePressure ?? DEFAULTS.useGarbagePressure;
    const pressureSensitivity = this.lookaheadOptions.garbagePressureSensitivity ?? DEFAULTS.garbagePressureSensitivity;
    const pressureAdjusted = usePressure ? adjustForGarbagePressure({ ...DEFAULTS, ...this.lookaheadOptions, valueModel: undefined, spinBias }, pressure, pressureSensitivity) : { ...DEFAULTS, ...this.lookaheadOptions, valueModel: undefined, spinBias, pressureMultiplier: 0 };
    const effectiveSpinBias = risky ? 1 : pressureAdjusted.spinBias;
    (engine as unknown as { spinBias?: number }).spinBias = effectiveSpinBias;
    if (effectiveSpinBias > 1 && !shouldSkipSpeculativeFinisher(pressure)) {
      const state = engine.stateDict();
      const m = boardMetrics(state.board);
      const cleanEnoughForForcedSpin = m.holes < 2 && m.maxHeight < 9 && m.bumpiness < 13 && m.totalHeight < 36 && !state.board.slice(0, 6).some((row) => /[^.]/.test(row));
      if (hasUsableTForFinisher(engine)) {
        if (!cleanEnoughForForcedSpin) this.lastSpinFinisherReason = "terrain_too_bad";
        const finisher = findReadySpinFinisherChoice(engine);
        if (finisher.choice) {
          this.lastSpinFinisherRouteAttempts = finisher.routeAttempts;
          finisher.choice.aiInfo = {
            ...finisher.choice.aiInfo,
            spinFinisherSearch: true,
            spinFinisherRouteAttempts: finisher.routeAttempts,
            chooseMs: Number((performance.now() - start).toFixed(3)),
            spinDecisionType: cleanEnoughForForcedSpin ? "speculative_setup_and_finisher" : "immediate_finisher_override",
            garbagePressureMode: pressure.mode,
            pendingGarbage: pressure.pendingGarbage,
            pressureAdjusted: pressureAdjusted.pressureMultiplier > 0 || undefined,
          };
          return finisher.choice;
        }
        this.lastSpinFinisherRouteAttempts = finisher.routeAttempts;
        this.lastSpinFinisherReason = finisher.reason && finisher.reason !== "no_t_available" ? finisher.reason : null;
      }
    } else if (shouldSkipSpeculativeFinisher(pressure)) {
      this.lastSpinFinisherReason = `garbage_pressure_${pressure.mode}`;
    }
    const choice = chooseLookaheadPlacement(engine, this, { ...this.lookaheadOptions, spinBias: effectiveSpinBias, useGarbagePressure: usePressure, garbagePressureSensitivity: pressureSensitivity });
    if (choice) {
      if (this.lastSpinFinisherReason || risky) choice.aiInfo = { ...choice.aiInfo, spinFinisherSearch: !!this.lastSpinFinisherReason || undefined, spinFinisherRouteAttempts: this.lastSpinFinisherRouteAttempts || undefined, spinFinisherRejected: this.lastSpinFinisherReason, topoutSafetyOverride: risky || undefined, garbagePressureMode: pressure.mode, pendingGarbage: pressure.pendingGarbage, pressureAdjusted: pressureAdjusted.pressureMultiplier > 0 || undefined };
      return choice;
    }
    const fallback = super.choose(engine);
    if (fallback) fallback.aiInfo = { ...fallback.aiInfo, source: "lookahead_fallback", chooseMs: Number((performance.now() - start).toFixed(3)), budgetMs, spinFinisherSearch: !!this.lastSpinFinisherReason || undefined, spinFinisherRouteAttempts: this.lastSpinFinisherRouteAttempts || undefined, spinFinisherRejected: this.lastSpinFinisherReason ?? undefined, garbagePressureMode: pressure.mode, pendingGarbage: pressure.pendingGarbage, pressureAdjusted: pressureAdjusted.pressureMultiplier > 0 || undefined };
    return fallback;
  }
}
