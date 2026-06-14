import { boardMetrics, TetrisEngine, type PlacementAction } from "../engine/tetris";
import { estimateSpinPotential } from "./spinPotential";
import { getGarbagePressureContext, scoreGarbagePressureResponse } from "./garbagePressure";

export interface AiChoice extends PlacementAction {
  aiScore: number;
  aiInfo: Record<string, unknown>;
}

function zeroGarbagePressureInfo(mode = "normal", pendingGarbage = 0): Record<string, unknown> {
  return {
    mode,
    pendingGarbage,
    danger: 0,
    penalty: 0,
    cancelReward: 0,
    clearReward: 0,
    downstackReward: 0,
    safetyPenalty: 0,
    estimatedRemainingGarbage: pendingGarbage,
  };
}

export class HeuristicAI {
  holeWeight = 13.0;
  coveredHoleWeight = 1.15;
  heightWeight = 0.72;
  maxHeightWeight = 1.85;
  centerTowerWeight = 1.6;
  bumpWeight = 0.85;
  wellWeight = 0.2;
  lineBonus = 4.0;
  attackBonus = 2.0;
  spinPotentialBonus = 0.75;
  spinClassificationBonus = 0.9;
  topoutPenalty = 100000.0;
  holdPenalty = 0.05;

  newHolePenaltyWeight = 16.0;
  maxHeightRisePenaltyWeight = 4.8;
  bumpRisePenaltyWeight = 1.25;
  centerTowerRisePenaltyWeight = 2.6;
  spinTerrainPressureWeight = 1.1;
  tPreservationBonus = 0.9;
  wastedTPenalty = 5.2;
  slotDestroyedPenalty = 4.4;
  nearReadySpinSlotBonus = 2.2;

  // This is intentionally enabled on the base heuristic so every built-in AI
  // variant, WebPolicy fallback, and NoisyHybrid fallback reacts to incoming
  // garbage without needing a LookaheadAI-specific option.
  useGarbagePressure = true;
  garbagePressureSensitivity = 1.0;

  private terrainDiagnostics(board: string[], heights: number[]): {
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

  scoreAfter(engine: TetrisEngine, action: PlacementAction): { score: number; info: Record<string, unknown> } {
    const beforeState = engine.stateDict();
    const beforeMetrics = boardMetrics(beforeState.board);
    const beforeB2B = Math.max(0, Math.floor(Number(beforeState.b2b ?? 0)));
    const beforeTerrain = this.terrainDiagnostics(beforeState.board, beforeMetrics.heights);

    const e = engine.clone();
    const result = e.applyAction(action);
    const state = e.stateDict();
    const afterB2B = Math.max(0, Math.floor(Number(state.b2b ?? 0)));
    const metrics = boardMetrics(state.board);
    const terrain = this.terrainDiagnostics(state.board, metrics.heights);
    const spinPotential = estimateSpinPotential(state);
    const spinBiasRaw = Number((engine as unknown as { spinBias?: number }).spinBias ?? 1);
    const spinBias = Number.isFinite(spinBiasRaw) ? Math.max(1, spinBiasRaw) : 1;
    const spinStrength = spinBias > 1 ? Math.min(2.5, spinBias) : 0;
    const beforeSpin = estimateSpinPotential(beforeState);

    const queue = Array.isArray(beforeState.queue) ? beforeState.queue : [];
    const tQueueIndex = queue.findIndex((p) => p === "T");
    const hasNearReadySlot = !!beforeSpin.bestTarget && beforeSpin.bestTarget.score >= 6.8 && beforeSpin.bestTarget.lineDeficit <= 4;
    const activeT = beforeState.active?.kind === "T";
    const holdT = beforeState.hold === "T";
    const queueTSoon = tQueueIndex >= 0 && tQueueIndex <= 3;
    const tAvailabilityReason = activeT ? "active" : holdT ? "hold" : queueTSoon ? `queue_${tQueueIndex}` : "unavailable";

    const holeDelta = metrics.holes - beforeMetrics.holes;
    const maxHeightDelta = metrics.maxHeight - beforeMetrics.maxHeight;
    const bumpinessDelta = metrics.bumpiness - beforeMetrics.bumpiness;
    const centerTowerDelta = terrain.centerTower - beforeTerrain.centerTower;

    const newHolePenalty = Math.max(0, holeDelta) * this.newHolePenaltyWeight;
    const maxHeightRisePenalty = Math.max(0, maxHeightDelta - 1) * this.maxHeightRisePenaltyWeight;
    const bumpRisePenalty = Math.max(0, bumpinessDelta - 2) * this.bumpRisePenaltyWeight;
    const centerTowerRisePenalty = Math.max(0, centerTowerDelta - 0.75) * this.centerTowerRisePenaltyWeight;
    const terrainPenalty = newHolePenalty + maxHeightRisePenalty + bumpRisePenalty + centerTowerRisePenalty;

    const pressureContext = getGarbagePressureContext(engine);
    const pressureScore = this.useGarbagePressure
      ? scoreGarbagePressureResponse({
        before: pressureContext,
        result,
        beforeMetrics,
        afterMetrics: metrics,
        holeDelta,
        maxHeightDelta,
        bumpinessDelta,
      })
      : null;
    const pressureSensitivity = Math.max(0, Number(this.garbagePressureSensitivity) || 0);
    const garbagePressurePenalty = pressureScore ? pressureScore.penalty * pressureSensitivity : 0;

    const noAttackPressure = result.attackSent <= 0 ? Math.max(0, metrics.totalHeight - 72) : 0;
    const mechanicalSpin = result.spinClassification?.mechanical === "immobile";
    const scoringSpin =
      result.spin === "tspin" ? 7.5 :
      result.spin === "tspin-mini" ? 3.2 :
      result.spin === "spin" ? 4.5 :
      0;
    const mechanicalSpinBonus = scoringSpin <= 0 && mechanicalSpin ? 0.75 : 0;
    const spinClassificationBonusApplied = (scoringSpin + mechanicalSpinBonus) * this.spinClassificationBonus * (spinStrength > 0 ? spinStrength : 1);

    let spinPotentialScale = 1;
    if (metrics.holes >= 12 || metrics.maxHeight >= 18) spinPotentialScale = 0;
    else {
      if (metrics.holes >= 8) spinPotentialScale *= 0.2;
      if (metrics.maxHeight >= 16) spinPotentialScale *= 0.35;
      if (metrics.bumpiness >= 24) spinPotentialScale *= 0.55;
      if (metrics.bumpiness >= 30) spinPotentialScale *= 0.4;
      if (noAttackPressure > 0) {
        const pressureScale = Math.max(0.2, 1 - noAttackPressure / 32);
        spinPotentialScale *= pressureScale;
      }
      if (holeDelta > 0) spinPotentialScale *= Math.max(0.15, 1 - holeDelta * 0.22);
      if (pressureContext.mode === "downstack") spinPotentialScale *= 0.65;
      else if (pressureContext.mode === "emergency") spinPotentialScale *= 0.25;
    }
    spinPotentialScale = Math.max(0, Math.min(1, spinPotentialScale));
    const spinPotentialApplied = spinPotential.bonus * spinPotentialScale;

    let score = 0;
    score += this.holeWeight * metrics.holes;
    score += this.coveredHoleWeight * terrain.coveredCells;
    score += this.heightWeight * metrics.totalHeight;
    score += this.maxHeightWeight * Math.max(0, metrics.maxHeight - 9) ** 1.25;
    score += this.maxHeightWeight * 2.2 * Math.max(0, metrics.maxHeight - 13) ** 1.5;
    score += this.centerTowerWeight * terrain.centerTower ** 1.35;
    score += this.bumpWeight * metrics.bumpiness;
    score += this.bumpWeight * 1.55 * terrain.roughPenalty;
    score += this.wellWeight * metrics.wells;
    score -= this.lineBonus * result.linesCleared;
    score -= this.attackBonus * result.attackSent;
    score -= spinClassificationBonusApplied;
    score += this.spinTerrainPressureWeight * noAttackPressure;
    score += terrainPenalty;
    score += garbagePressurePenalty;
    score -= this.spinPotentialBonus * spinPotentialApplied;

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
        wastedTPenaltyApplied += this.wastedTPenalty * spinStrength * (activeT || holdT ? 1.25 : 0.9);
      }
      if (usedHoldTOrdinary && metrics.maxHeight < 16) {
        wastedTPenaltyApplied += this.wastedTPenalty * 0.75 * spinStrength;
      }

      if (hasNearReadySlot && spinPotentialDrop > 0.45) {
        slotDestroyedPenaltyApplied += this.slotDestroyedPenalty * spinStrength * Math.min(2.2, spinPotentialDrop / 0.8);
      }

      if (!usedTForOrdinary && hasNearReadySlot && (queueTSoon || holdT || activeT)) {
        nearReadySpinSlotBonusApplied += this.nearReadySpinSlotBonus * spinStrength;
      }

      if (action.hold && activeT && beforeState.hold !== "T" && hasNearReadySlot) {
        tPreserved = true;
        tPreservationBonusApplied += this.tPreservationBonus * spinStrength * 1.15;
      } else if (!usedTForOrdinary && (holdT || queueTSoon) && hasNearReadySlot && (action.piece !== "T" || action.hold)) {
        tPreserved = true;
        tPreservationBonusApplied += this.tPreservationBonus * spinStrength * 0.7;
      }
    }

    score += wastedTPenaltyApplied + slotDestroyedPenaltyApplied;
    score -= tPreservationBonusApplied + nearReadySpinSlotBonusApplied;

    if (action.hold) score += this.holdPenalty;
    if (e.dead || result.topout) score += this.topoutPenalty;

    const garbagePressureInfo = pressureScore
      ? {
        mode: pressureContext.mode,
        pendingGarbage: pressureContext.pendingGarbage,
        danger: pressureContext.danger,
        sensitivity: Number(pressureSensitivity.toFixed(3)),
        penalty: Number(garbagePressurePenalty.toFixed(4)),
        rawPenalty: Number(pressureScore.penalty.toFixed(4)),
        cancelReward: Number(pressureScore.cancelReward.toFixed(4)),
        clearReward: Number(pressureScore.clearReward.toFixed(4)),
        downstackReward: Number(pressureScore.downstackReward.toFixed(4)),
        safetyPenalty: Number(pressureScore.safetyPenalty.toFixed(4)),
        estimatedRemainingGarbage: pressureScore.estimatedRemainingGarbage,
      }
      : zeroGarbagePressureInfo(pressureContext.mode, pressureContext.pendingGarbage);

    return {
      score,
      info: {
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
        garbagePressure: garbagePressureInfo,
        garbagePressureMode: pressureContext.mode,
        pendingGarbage: pressureContext.pendingGarbage,
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
        topout: e.dead || result.topout
      }
    };
  }

  choose(engine: TetrisEngine): AiChoice | null {
    const legal = engine.legalPlacements(true);
    if (legal.length === 0) return null;

    let best: PlacementAction | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestInfo: Record<string, unknown> = {};

    for (const action of legal) {
      const { score, info } = this.scoreAfter(engine, action);
      if (score < bestScore) {
        best = action;
        bestScore = score;
        bestInfo = info;
      }
    }

    if (!best) return null;
    return { ...best, aiScore: bestScore, aiInfo: bestInfo };
  }
}
