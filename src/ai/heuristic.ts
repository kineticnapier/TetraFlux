import { boardMetrics, TetrisEngine, type PlacementAction } from "../engine/tetris";
import { estimateSpinPotential } from "./spinPotential";

export interface AiChoice extends PlacementAction {
  aiScore: number;
  aiInfo: Record<string, unknown>;
}

export class HeuristicAI {
  holeWeight = 10.5;
  coveredHoleWeight = 0.75;
  heightWeight = 0.72;
  maxHeightWeight = 1.35;
  centerTowerWeight = 1.15;
  bumpWeight = 0.65;
  wellWeight = 0.2;
  lineBonus = 4.0;
  attackBonus = 2.0;
  spinPotentialBonus = 0.75;
  topoutPenalty = 100000.0;
  holdPenalty = 0.05;

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
    const e = engine.clone();
    const result = e.applyAction(action);
    const state = e.stateDict();
    const metrics = boardMetrics(state.board);
    const terrain = this.terrainDiagnostics(state.board, metrics.heights);
    const spinPotential = estimateSpinPotential(state);

    let score = 0;
    score += this.holeWeight * metrics.holes;
    score += this.coveredHoleWeight * terrain.coveredCells;
    score += this.heightWeight * metrics.totalHeight;
    score += this.maxHeightWeight * Math.max(0, metrics.maxHeight - 9) ** 1.25;
    score += this.centerTowerWeight * terrain.centerTower ** 1.35;
    score += this.bumpWeight * metrics.bumpiness;
    score += this.bumpWeight * 1.2 * terrain.roughPenalty;
    score += this.wellWeight * metrics.wells;
    score -= this.lineBonus * result.linesCleared;
    score -= this.attackBonus * result.attackSent;
    score -= this.spinPotentialBonus * spinPotential.bonus;
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
