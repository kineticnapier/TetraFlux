import { boardMetrics, HIDDEN_ROWS, SHAPES, shapeCells, TetrisEngine, type Cell, type PieceKind, type PieceState } from "./engine/tetris";

const COLORS: Record<string, string> = {
  ".": "#14161c",
  I: "#2dd4bf",
  J: "#60a5fa",
  L: "#fb923c",
  O: "#facc15",
  S: "#4ade80",
  T: "#c084fc",
  Z: "#f87171",
  G: "#787887"
};

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = "#e5e7eb", font = "16px Consolas"): void {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.fillText(text, x, y);
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function cellColor(c: Cell): string {
  return COLORS[c ?? "."] ?? "#aaa";
}

function drawPieceCells(ctx: CanvasRenderingContext2D, piece: PieceState, ox: number, oy: number, cell: number, fill: string, stroke = "#ffffff"): void {
  for (const [x, y] of shapeCells(piece)) {
    const vy = y - HIDDEN_ROWS;
    if (x < 0 || x >= 10 || vy < 0 || vy >= 20) continue;
    const px = ox + x * cell;
    const py = oy + vy * cell;
    ctx.fillStyle = fill;
    ctx.fillRect(px, py, cell, cell);
    ctx.strokeStyle = stroke;
    ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
  }
}

export function drawMiniPiece(ctx: CanvasRenderingContext2D, piece: PieceKind | null, x: number, y: number, scale: number, label?: string): void {
  drawRoundRect(ctx, x, y, 88, 58, 10, "#111827");
  if (label) drawText(ctx, label, x + 8, y + 15, "#94a3b8", "12px Consolas");
  if (!piece) {
    drawText(ctx, "-", x + 38, y + 39, "#64748b", "18px Consolas");
    return;
  }

  const cells = SHAPES[piece][0];
  const minX = Math.min(...cells.map(([cx]) => cx));
  const maxX = Math.max(...cells.map(([cx]) => cx));
  const minY = Math.min(...cells.map(([, cy]) => cy));
  const maxY = Math.max(...cells.map(([, cy]) => cy));
  const w = (maxX - minX + 1) * scale;
  const h = (maxY - minY + 1) * scale;
  const ox = x + 44 - w / 2;
  const oy = y + 34 - h / 2 + 4;

  for (const [cx, cy] of cells) {
    ctx.fillStyle = COLORS[piece];
    ctx.fillRect(ox + (cx - minX) * scale, oy + (cy - minY) * scale, scale, scale);
    ctx.strokeStyle = "#0f172a";
    ctx.strokeRect(ox + (cx - minX) * scale + 0.5, oy + (cy - minY) * scale + 0.5, scale - 1, scale - 1);
  }
}

export function drawNextQueue(ctx: CanvasRenderingContext2D, queue: PieceKind[], x: number, y: number): void {
  drawText(ctx, "NEXT", x, y - 10, "#38bdf8", "bold 18px Consolas");
  for (let i = 0; i < Math.min(6, queue.length); i++) {
    drawMiniPiece(ctx, queue[i], x, y + i * 64, i === 0 ? 18 : 15, i === 0 ? "next 1" : `${i + 1}`);
  }
}

export interface DrawBoardOptions {
  x: number;
  y: number;
  cell: number;
  title: string;
  showGhost?: boolean;
  active?: boolean;
}

/**
 * Layout per player:
 *
 *   [ HOLD ]  [ 10x20 BOARD ]  [ NEXT ]
 *
 * opts.x is the left edge of the whole player panel.
 */
export function drawBoard(ctx: CanvasRenderingContext2D, engine: TetrisEngine, opts: DrawBoardOptions): void {
  const { x, y, cell, title } = opts;

  const sideW = 96;
  const gap = 12;
  const boardX = x + sideW + gap;
  const boardY = y;
  const boardW = 10 * cell;
  const boardH = 20 * cell;
  const nextX = boardX + boardW + gap;

  const panelW = sideW + gap + boardW + gap + sideW + 24;
  const panelH = boardH + 130;

  drawRoundRect(ctx, x - 12, y - 50, panelW, panelH, 14, "#0d1423");
  drawText(ctx, title, x, y - 22, "#38bdf8", "bold 22px Consolas");

  // HOLD: left side of this player's board.
  drawMiniPiece(ctx, engine.hold, x, y, 15, "HOLD");

  // Board: center.
  const visible = engine.board.slice(HIDDEN_ROWS);
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 10; col++) {
      const px = boardX + col * cell;
      const py = boardY + row * cell;
      ctx.fillStyle = cellColor(visible[row][col]);
      ctx.fillRect(px, py, cell, cell);
      ctx.strokeStyle = "#2b2f3a";
      ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
    }
  }

  // NEXT: right side of this player's board.
  drawNextQueue(ctx, engine.queue, nextX, y);

  if (opts.showGhost && !engine.dead) {
    const ghost = engine.ghostPiece();
    for (const [gx, gy] of shapeCells(ghost)) {
      const vy = gy - HIDDEN_ROWS;
      if (gx < 0 || gx >= 10 || vy < 0 || vy >= 20) continue;
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.strokeRect(boardX + gx * cell + 5, boardY + vy * cell + 5, cell - 10, cell - 10);
      ctx.lineWidth = 1;
    }
  }

  if (opts.active && !engine.dead) {
    drawPieceCells(ctx, engine.active, boardX, boardY, cell, COLORS[engine.active.kind], "#ffffff");
  }

  const metrics = boardMetrics(engine.stateDict().board);
  const infoY = y + boardH + 24;
  drawText(ctx, `active=${engine.active.kind} canHold=${engine.canHold}`, boardX, infoY, "#e5e7eb", "14px Consolas");
  drawText(ctx, `lines=${engine.lines} pieces=${engine.piecesLocked} garbage=${engine.pendingGarbage}`, boardX, infoY + 20, "#94a3b8", "14px Consolas");
  drawText(ctx, `combo=${engine.combo} b2b=${engine.b2b} holes=${metrics.holes} height=${metrics.maxHeight}`, boardX, infoY + 40, "#94a3b8", "14px Consolas");
  if (engine.lastResult) {
    const r = engine.lastResult;
    drawText(ctx, `last: ${r.linesCleared}L ${r.spin} atk=${r.attackSent}`, boardX, infoY + 60, "#94a3b8", "14px Consolas");
  }
}

export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string, lines: Array<[string, string?]>): void {
  drawRoundRect(ctx, x, y, w, h, 14, "#0d1423");
  drawText(ctx, title, x + 16, y + 32, "#38bdf8", "bold 22px Consolas");
  let yy = y + 62;
  for (const [line, color] of lines) {
    drawText(ctx, line, x + 16, yy, color ?? "#e5e7eb", "15px Consolas");
    yy += 22;
  }
}
