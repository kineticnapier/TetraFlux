import { boardMetrics, TetrisEngine, type PlacementAction } from "../engine/tetris";

export interface AiChoice extends PlacementAction {
  aiScore: number;
  aiInfo: Record<string, unknown>;
}

export class HeuristicAI {
  holeWeight = 8.0;
  heightWeight = 0.8;
  bumpWeight = 0.4;
  wellWeight = 0.2;
  lineBonus = 4.0;
  attackBonus = 2.0;
  topoutPenalty = 100000.0;
  holdPenalty = 0.05;

  scoreAfter(engine: TetrisEngine, action: PlacementAction): { score: number; info: Record<string, unknown> } {
    const e = engine.clone();
    const result = e.applyAction(action);
    const metrics = boardMetrics(e.stateDict().board);

    let score = 0;
    score += this.holeWeight * metrics.holes;
    score += this.heightWeight * metrics.totalHeight;
    score += this.bumpWeight * metrics.bumpiness;
    score += this.wellWeight * metrics.wells;
    score -= this.lineBonus * result.linesCleared;
    score -= this.attackBonus * result.attackSent;
    if (action.hold) score += this.holdPenalty;
    if (e.dead || result.topout) score += this.topoutPenalty;

    return {
      score,
      info: {
        metrics,
        lines: result.linesCleared,
        attack: result.attackSent,
        spin: result.spin,
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
