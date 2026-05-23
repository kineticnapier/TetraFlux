import { boardMetrics, type EngineState } from "../engine/tetris";

export type SpinPotentialKind = "TSD" | "TST" | "TSlot";

export interface SpinPotentialTarget {
  kind: SpinPotentialKind;
  x: number;
  y: number;
  rot: number;
  centerX: number;
  centerY: number;
  cornerCount: number;
  blockedMoves: number;
  completeRows: number;
  nearRows: number;
  lineDeficit: number;
  score: number;
}

export interface SpinPotentialInfo {
  bonus: number;
  targetCount: number;
  tAvailability: number;
  bestTarget: SpinPotentialTarget | null;
  terrainFactor: number;
  terrainRisk: {
    holes: number;
    maxHeight: number;
    bumpiness: number;
    centerTower: number;
  };
}

const T_SHAPES: Array<Array<[number, number]>> = [
  [[1, 0], [0, 1], [1, 1], [2, 1]],
  [[1, 0], [1, 1], [2, 1], [1, 2]],
  [[0, 1], [1, 1], [2, 1], [1, 2]],
  [[1, 0], [0, 1], [1, 1], [1, 2]],
];

const BOARD_W = 10;
const BOARD_H = 20;

function normalizeBoard(board: unknown): string[] {
  const rows = Array.isArray(board) ? board.map((row) => String(row)) : [];
  const visible = rows.slice(-BOARD_H);
  while (visible.length < BOARD_H) visible.unshift(".".repeat(BOARD_W));
  return visible.map((row) => (row + ".".repeat(BOARD_W)).slice(0, BOARD_W));
}

function occupied(board: string[], x: number, y: number): boolean {
  if (x < 0 || x >= BOARD_W) return true;
  if (y >= BOARD_H) return true;
  if (y < 0) return true;
  return board[y][x] !== ".";
}

function cellsFor(x: number, y: number, rot: number): Array<[number, number]> {
  return T_SHAPES[((rot % 4) + 4) % 4].map(([dx, dy]) => [x + dx, y + dy]);
}

function canPlaceT(board: string[], x: number, y: number, rot: number): boolean {
  return cellsFor(x, y, rot).every(([cx, cy]) => cx >= 0 && cx < BOARD_W && cy >= 0 && cy < BOARD_H && board[cy][cx] === ".");
}

function collidesShifted(board: string[], x: number, y: number, rot: number, dx: number, dy: number): boolean {
  return cellsFor(x + dx, y + dy, rot).some(([cx, cy]) => occupied(board, cx, cy));
}

function countFilledOnRow(board: string[], y: number): number {
  if (y < 0 || y >= BOARD_H) return BOARD_W;
  let count = 0;
  for (let x = 0; x < BOARD_W; x++) if (board[y][x] !== ".") count++;
  return count;
}

function tAvailability(state: EngineState): number {
  if (state.active?.kind === "T") return 1.25;
  if (state.hold === "T") return 1.18;

  const queue = Array.isArray(state.queue) ? state.queue : [];
  const idx = queue.findIndex((piece) => piece === "T");
  if (idx < 0) return 0.55;
  return Math.max(0.65, 1.08 - idx * 0.08);
}

function scoreCandidate(board: string[], x: number, y: number, rot: number): SpinPotentialTarget | null {
  if (!canPlaceT(board, x, y, rot)) return null;

  const centerX = x + 1;
  const centerY = y + 1;
  const corners = [
    occupied(board, centerX - 1, centerY - 1),
    occupied(board, centerX + 1, centerY - 1),
    occupied(board, centerX - 1, centerY + 1),
    occupied(board, centerX + 1, centerY + 1),
  ].filter(Boolean).length;

  if (corners < 3) return null;

  const blockedLeft = collidesShifted(board, x, y, rot, -1, 0);
  const blockedRight = collidesShifted(board, x, y, rot, 1, 0);
  const blockedDown = collidesShifted(board, x, y, rot, 0, 1);
  const blockedMoves = Number(blockedLeft) + Number(blockedRight) + Number(blockedDown);

  const tCells = cellsFor(x, y, rot);
  const tByRow = new Map<number, number>();
  for (const [, cy] of tCells) tByRow.set(cy, (tByRow.get(cy) ?? 0) + 1);

  const rowDeficits = [...tByRow.entries()]
    .map(([row, tCount]) => Math.max(0, BOARD_W - (countFilledOnRow(board, row) + tCount)))
    .sort((a, b) => a - b);

  const completeRows = rowDeficits.filter((deficit) => deficit === 0).length;
  const nearRows = rowDeficits.filter((deficit) => deficit <= 2).length;
  const lineDeficit = rowDeficits.slice(0, 2).reduce((sum, deficit) => sum + deficit, 0);

  let kind: SpinPotentialKind = "TSlot";
  if (completeRows >= 3) kind = "TST";
  else if (completeRows >= 2 || (nearRows >= 2 && lineDeficit <= 2)) kind = "TSD";

  let score = 1.6;
  score += (corners - 2) * 1.15;
  score += blockedMoves * 0.55;
  score += completeRows * 2.25;
  score += nearRows * 0.65;
  score += Math.max(0, 4 - lineDeficit) * 0.45;
  if (blockedMoves >= 3) score += 1.2;
  if (kind === "TSD") score += 2.2;
  if (kind === "TST") score += 3.0;

  return {
    kind,
    x,
    y,
    rot,
    centerX,
    centerY,
    cornerCount: corners,
    blockedMoves,
    completeRows,
    nearRows,
    lineDeficit,
    score,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function spinTerrainFactor(board: string[]): SpinPotentialInfo["terrainRisk"] & { factor: number } {
  const metrics = boardMetrics(board);
  const centerMax = Math.max(metrics.heights[4] ?? 0, metrics.heights[5] ?? 0);
  const sideAvg = (
    (metrics.heights[0] ?? 0) +
    (metrics.heights[1] ?? 0) +
    (metrics.heights[8] ?? 0) +
    (metrics.heights[9] ?? 0)
  ) / 4;
  const centerTower = Math.max(0, centerMax - sideAvg);

  if (metrics.holes >= 5 || metrics.maxHeight >= 15 || metrics.bumpiness >= 26 || centerTower >= 5) {
    return { holes: metrics.holes, maxHeight: metrics.maxHeight, bumpiness: metrics.bumpiness, centerTower, factor: 0 };
  }

  const holeFactor = metrics.holes === 0 ? 1 : metrics.holes === 1 ? 0.7 : metrics.holes <= 3 ? 0.35 : 0.12;
  const heightFactor = clamp01((14 - metrics.maxHeight) / 6);
  const bumpFactor = clamp01((24 - metrics.bumpiness) / 16);
  const centerFactor = clamp01((5 - centerTower) / 4);
  const factor = clamp01(holeFactor * heightFactor * bumpFactor * centerFactor);

  return { holes: metrics.holes, maxHeight: metrics.maxHeight, bumpiness: metrics.bumpiness, centerTower, factor };
}

export function estimateSpinPotential(state: EngineState): SpinPotentialInfo {
  const board = normalizeBoard(state.board);
  const availability = tAvailability(state);
  const terrain = spinTerrainFactor(board);
  let bestTarget: SpinPotentialTarget | null = null;
  let targetCount = 0;

  for (let rot = 0; rot < 4; rot++) {
    for (let y = 0; y < BOARD_H; y++) {
      for (let x = -1; x <= BOARD_W - 1; x++) {
        const target = scoreCandidate(board, x, y, rot);
        if (!target) continue;
        targetCount++;
        if (!bestTarget || target.score > bestTarget.score) bestTarget = target;
      }
    }
  }

  const raw = bestTarget ? bestTarget.score * availability * terrain.factor : 0;
  return {
    bonus: Math.min(10, Number(raw.toFixed(4))),
    targetCount,
    tAvailability: availability,
    bestTarget,
    terrainFactor: Number(terrain.factor.toFixed(4)),
    terrainRisk: {
      holes: terrain.holes,
      maxHeight: terrain.maxHeight,
      bumpiness: terrain.bumpiness,
      centerTower: Number(terrain.centerTower.toFixed(2)),
    },
  };
}
