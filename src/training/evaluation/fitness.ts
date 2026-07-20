import type {
  HeuristicEvaluationAggregate,
  HeuristicGameResult,
} from "../core/types";

function percentile10(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.1) - 1)] ?? 0;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function calculateHeuristicFitness(a: Omit<HeuristicEvaluationAggregate, "fitness">): number {
  return 1_000_000 * a.meanSurvivalCubed
    + 200_000 * a.percentile10Survival
    - 50_000 * a.topoutRate
    + 5_000 * a.linesPerPiece
    + 300 * a.attackPerPiece
    - 100 * a.avgHoles
    - 10 * a.avgMaxHeight
    - 2 * a.avgBumpiness;
}

export function aggregateHeuristicGames(
  perGame: HeuristicGameResult[],
  maxPieces: number,
): HeuristicEvaluationAggregate {
  const totalPieces = perGame.reduce((sum, game) => sum + game.pieces, 0);
  const survival = perGame.map((game) => game.pieces / maxPieces);
  const rounds = Math.max(1, totalPieces);
  const topouts = perGame.filter((game) => game.topout).length;
  const lines = perGame.reduce((sum, game) => sum + game.lines, 0);
  const attack = perGame.reduce((sum, game) => sum + game.attack, 0);
  const aggregateWithoutFitness: Omit<HeuristicEvaluationAggregate, "fitness"> = {
    games: perGame.length,
    maxPieces,
    pieces: totalPieces,
    survivalRate: mean(survival),
    meanSurvivalCubed: mean(survival.map((value) => value ** 3)),
    percentile10Survival: percentile10(survival),
    topouts,
    topoutRate: topouts / Math.max(1, perGame.length),
    lines,
    attack,
    linesPerPiece: lines / rounds,
    attackPerPiece: attack / rounds,
    avgHoles: perGame.reduce((sum, game) => sum + game.avgHoles * game.pieces, 0) / rounds,
    avgMaxHeight: perGame.reduce((sum, game) => sum + game.avgMaxHeight * game.pieces, 0) / rounds,
    avgBumpiness: perGame.reduce((sum, game) => sum + game.avgBumpiness * game.pieces, 0) / rounds,
    avgTotalHeight: perGame.reduce((sum, game) => sum + game.avgTotalHeight * game.pieces, 0) / rounds,
    maxObservedHeight: Math.max(0, ...perGame.map((game) => game.maxObservedHeight)),
  };

  return {
    ...aggregateWithoutFitness,
    fitness: calculateHeuristicFitness(aggregateWithoutFitness),
  };
}
