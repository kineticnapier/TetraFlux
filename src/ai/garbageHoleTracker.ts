import { boardMetrics, type LockResult } from "../engine/tetris";
import type { GarbagePressureContext } from "./garbagePressure";

export interface GarbageHoleState {
  found: boolean;
  garbageLikeRows: number;
  holeColumns: number[];
  dominantColumn: number | null;
  targetRow: number | null;
  deepestRow: number | null;
  blocksAboveTarget: number;
  emptyCellsAboveTarget: number;
  targetColumnHeight: number;
  neighborMinHeight: number;
  neighborAvgHeight: number;
  columnBuriedByNeighbors: number;
  accessScore: number;
  accessBlocked: boolean;
  openLaneCells: number;
  topSurfaceGap: number;
}

export interface GarbageHoleScore {
  penalty: number;
  reward: number;
  riskPenalty: number;
  progressReward: number;
  before: GarbageHoleState;
  after: GarbageHoleState;
  column: number | null;
  progress: number;
  blockedDelta: number;
  accessDelta: number;
}

function isFilled(cell: string | undefined): boolean {
  return !!cell && cell !== ".";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function countFilled(row: string): number {
  let filled = 0;
  for (let x = 0; x < 10; x++) if (isFilled(row[x])) filled++;
  return filled;
}

export function analyzeGarbageHole(board: string[]): GarbageHoleState {
  const rows = Array.isArray(board) ? board : [];
  const h = rows.length;
  const metrics = boardMetrics(rows);
  const columnRows = Array.from({ length: 10 }, () => [] as number[]);
  const scanStart = Math.max(0, h - 16);
  let garbageLikeRows = 0;

  for (let y = scanStart; y < h; y++) {
    const row = rows[y] ?? "";
    if (row.length < 10) continue;
    const filled = countFilled(row);
    const emptyColumns: number[] = [];
    for (let x = 0; x < 10; x++) if (!isFilled(row[x])) emptyColumns.push(x);

    // Real garbage rows are usually 9/10 filled. During line clears or mixed
    // garbage stacks, an 8/10 row with two holes is still a useful signal.
    if ((filled >= 9 && emptyColumns.length === 1) || (filled >= 8 && emptyColumns.length <= 2 && y >= h - 10)) {
      garbageLikeRows++;
      for (const x of emptyColumns) columnRows[x]?.push(y);
    }
  }

  let dominantColumn: number | null = null;
  let bestScore = -Infinity;
  for (let x = 0; x < 10; x++) {
    const ys = columnRows[x] ?? [];
    if (ys.length === 0) continue;
    const topmost = Math.min(...ys);
    const deepest = Math.max(...ys);
    const score = ys.length * 10 + deepest * 0.08 - topmost * 0.03;
    if (score > bestScore) {
      bestScore = score;
      dominantColumn = x;
    }
  }

  if (dominantColumn === null) {
    return {
      found: false,
      garbageLikeRows,
      holeColumns: [],
      dominantColumn: null,
      targetRow: null,
      deepestRow: null,
      blocksAboveTarget: 0,
      emptyCellsAboveTarget: 0,
      targetColumnHeight: 0,
      neighborMinHeight: 0,
      neighborAvgHeight: 0,
      columnBuriedByNeighbors: 0,
      accessScore: 0,
      accessBlocked: false,
      openLaneCells: 0,
      topSurfaceGap: 0,
    };
  }

  const ys = columnRows[dominantColumn] ?? [];
  const targetRow = Math.min(...ys); // nearest garbage hole to the surface.
  const deepestRow = Math.max(...ys);
  let blocksAboveTarget = 0;
  let emptyCellsAboveTarget = 0;
  let openLaneCells = 0;
  let seenBlockInLane = false;

  for (let y = 0; y < targetRow; y++) {
    if (isFilled(rows[y]?.[dominantColumn])) {
      blocksAboveTarget++;
      seenBlockInLane = true;
    } else {
      emptyCellsAboveTarget++;
      if (!seenBlockInLane) openLaneCells++;
    }
  }

  const heights = metrics.heights ?? Array(10).fill(0);
  const targetColumnHeight = heights[dominantColumn] ?? 0;
  const leftHeight = dominantColumn > 0 ? heights[dominantColumn - 1] ?? targetColumnHeight : targetColumnHeight;
  const rightHeight = dominantColumn < 9 ? heights[dominantColumn + 1] ?? targetColumnHeight : targetColumnHeight;
  const neighborMinHeight = Math.min(leftHeight, rightHeight);
  const neighborAvgHeight = (leftHeight + rightHeight) / 2;
  const columnBuriedByNeighbors = Math.max(0, targetColumnHeight - neighborMinHeight);
  const topSurfaceGap = Math.max(0, neighborAvgHeight - targetColumnHeight);

  // Higher is better. This rewards an open vertical lane and a low target column,
  // but does not require the hole to be fully open yet.
  const accessScore = clamp(
    14 - blocksAboveTarget * 1.55 - columnBuriedByNeighbors * 0.8 + openLaneCells * 0.18 + topSurfaceGap * 0.35 + ys.length * 0.5,
    -30,
    30,
  );

  return {
    found: true,
    garbageLikeRows,
    holeColumns: columnRows.map((rowsForColumn) => rowsForColumn.length),
    dominantColumn,
    targetRow,
    deepestRow,
    blocksAboveTarget,
    emptyCellsAboveTarget,
    targetColumnHeight,
    neighborMinHeight,
    neighborAvgHeight: Number(neighborAvgHeight.toFixed(3)),
    columnBuriedByNeighbors,
    accessScore: Number(accessScore.toFixed(4)),
    accessBlocked: blocksAboveTarget > 0 || columnBuriedByNeighbors >= 3,
    openLaneCells,
    topSurfaceGap: Number(topSurfaceGap.toFixed(3)),
  };
}

export function scoreGarbageHoleResponse(args: {
  before: GarbageHoleState;
  after: GarbageHoleState;
  pressure: GarbagePressureContext;
  result: LockResult;
}): GarbageHoleScore {
  const { before, after, pressure, result } = args;
  const active = before.found || after.found;
  if (!active) {
    return {
      penalty: 0,
      reward: 0,
      riskPenalty: 0,
      progressReward: 0,
      before,
      after,
      column: null,
      progress: 0,
      blockedDelta: 0,
      accessDelta: 0,
    };
  }

  const level = pressure.mode === "normal" ? (pressure.pendingGarbage > 0 ? 1 : 0) : pressure.mode === "counter" ? 1 : pressure.mode === "downstack" ? 2 : 3;
  if (level <= 0 && before.garbageLikeRows <= 0 && after.garbageLikeRows <= 0) {
    return {
      penalty: 0,
      reward: 0,
      riskPenalty: 0,
      progressReward: 0,
      before,
      after,
      column: before.dominantColumn ?? after.dominantColumn,
      progress: 0,
      blockedDelta: 0,
      accessDelta: 0,
    };
  }

  const sameColumn = before.dominantColumn !== null && before.dominantColumn === after.dominantColumn;
  const blockedDelta = (after.blocksAboveTarget || 0) - (before.blocksAboveTarget || 0);
  const accessDelta = (after.accessScore || 0) - (before.accessScore || 0);
  const columnHeightDelta = (after.targetColumnHeight || 0) - (before.targetColumnHeight || 0);
  const garbageRowsDelta = (after.garbageLikeRows || 0) - (before.garbageLikeRows || 0);

  let reward = 0;
  let riskPenalty = 0;

  if (before.found && !after.found) reward += 38 + level * 18;
  if (!before.found && after.found) riskPenalty += 8 + level * 4;

  reward += Math.max(0, -blockedDelta) * (10 + level * 4);
  reward += Math.max(0, accessDelta) * (3.5 + level * 1.7);
  reward += Math.max(0, -columnHeightDelta) * (2.4 + level * 0.9);
  reward += Math.max(0, -garbageRowsDelta) * (5 + level * 2.5);
  reward += Math.max(0, result.attackSent ?? 0) * (pressure.pendingGarbage > 0 ? 0.8 + level * 0.25 : 0.25);

  riskPenalty += Math.max(0, blockedDelta) * (14 + level * 6);
  riskPenalty += Math.max(0, -accessDelta) * (4.5 + level * 2.2);
  riskPenalty += Math.max(0, columnHeightDelta) * (3.2 + level * 1.35);
  riskPenalty += Math.max(0, garbageRowsDelta) * (3 + level * 1.6);

  // If the AI clears/attacks while not making hole progress, it is probably
  // skimming the surface instead of digging toward the real garbage hole.
  const madeProgress = accessDelta > 0.4 || blockedDelta < 0 || columnHeightDelta < 0 || (before.found && !after.found);
  if ((result.linesCleared > 0 || result.attackSent > 0) && !madeProgress && before.found) {
    riskPenalty += (5 + level * 4) * Math.max(1, Math.min(4, result.linesCleared + result.attackSent * 0.25));
  }

  if (before.found && after.found && !sameColumn && before.garbageLikeRows >= 2) {
    // Switching away from a stable hole column usually means the old hole was
    // buried or the stack became chaotic. Do not over-penalize single noisy rows.
    riskPenalty += 9 + level * 5;
  }

  if (pressure.mode === "emergency" && before.found && !madeProgress && result.attackSent <= 0) {
    riskPenalty += 16 + before.blocksAboveTarget * 1.8;
  }

  const progress = reward - riskPenalty;
  return {
    penalty: riskPenalty - reward,
    reward,
    riskPenalty,
    progressReward: reward,
    before,
    after,
    column: before.dominantColumn ?? after.dominantColumn,
    progress: Number(progress.toFixed(4)),
    blockedDelta,
    accessDelta: Number(accessDelta.toFixed(4)),
  };
}
