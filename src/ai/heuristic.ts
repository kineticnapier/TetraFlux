import { boardMetrics, TetrisEngine, type PlacementAction } from "../engine/tetris";
import { estimateSpinPotential } from "./spinPotential";

export interface AiChoice extends PlacementAction {
  aiScore: number;
  aiInfo: Record<string, unknown>;
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
  topoutPenalty = 100000.0;
  holdPenalty = 0.05;

  newHolePenaltyWeight = 16.0;
  maxHeightRisePenaltyWeight = 4.8;
  bumpRisePenaltyWeight = 1.25;
  centerTowerRisePenaltyWeight = 2.6;
  spinTerrainPressureWeight = 1.1;

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
    const beforeTerrain = this.terrainDiagnostics(beforeState.board, beforeMetrics.heights);

    const e = engine.clone();
    const result = e.applyAction(action);
    const state = e.stateDict();
    const metrics = boardMetrics(state.board);
    const terrain = this.terrainDiagnostics(state.board, metrics.heights);
    const spinPotential = estimateSpinPotential(state);

    const holeDelta = metrics.holes - beforeMetrics.holes;
    const maxHeightDelta = metrics.maxHeight - beforeMetrics.maxHeight;
    const bumpinessDelta = metrics.bumpiness - beforeMetrics.bumpiness;
    const centerTowerDelta = terrain.centerTower - beforeTerrain.centerTower;

    const newHolePenalty = Math.max(0, holeDelta) * this.newHolePenaltyWeight;
    const maxHeightRisePenalty = Math.max(0, maxHeightDelta - 1) * this.maxHeightRisePenaltyWeight;
    const bumpRisePenalty = Math.max(0, bumpinessDelta - 2) * this.bumpRisePenaltyWeight;
    const centerTowerRisePenalty = Math.max(0, centerTowerDelta - 0.75) * this.centerTowerRisePenaltyWeight;
    const terrainPenalty = newHolePenalty + maxHeightRisePenalty + bumpRisePenalty + centerTowerRisePenalty;

    const noAttackPressure = result.attackSent <= 0 ? Math.max(0, metrics.totalHeight - 72) : 0;

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
    score += this.spinTerrainPressureWeight * noAttackPressure;
    score += terrainPenalty;
    score -= this.spinPotentialBonus * spinPotentialApplied;
    if (action.hold) score += this.holdPenalty;
    if (e.dead || result.topout) score += this.topoutPenalty;

    return {
      score,
      info: {
        metrics,
        terrain,
        lines: result.linesCleared,
        attack: result.attackSent,
        spin: result.spin,
        spinPotential,
        spinPotentialRaw: spinPotential.bonus,
        spinPotentialApplied,
        spinPotentialScale: Number(spinPotentialScale.toFixed(4)),
        terrainPenalty: Number(terrainPenalty.toFixed(4)),
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
