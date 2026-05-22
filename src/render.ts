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
  G: "#787887",
  B: "#a1a1aa"
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

function drawPieceCells(ctx: CanvasRenderingContext2D, piece: PieceState, ox: number, oy: number, cell: number, fill: string, stroke = "#ffffff", topCutRows = 0): void {
  const visibleRows = Math.max(1, 20 - topCutRows);
  for (const [x, y] of shapeCells(piece)) {
    const vy = y - HIDDEN_ROWS - topCutRows;
    if (x < 0 || x >= 10 || vy < 0 || vy >= visibleRows) continue;
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

export function drawNextQueue(ctx: CanvasRenderingContext2D, queue: PieceKind[], x: number, y: number, count = 6): void {
  drawText(ctx, "NEXT", x, y - 10, "#38bdf8", "bold 18px Consolas");
  for (let i = 0; i < Math.min(count, queue.length); i++) {
    drawMiniPiece(ctx, queue[i], x, y + i * 64, i === 0 ? 18 : 15, i === 0 ? "next 1" : `${i + 1}`);
  }
}

export interface GarbageMeterSegment {
  label: string;
  amount: number;
  color: string;
}

export function drawGarbageMeter(ctx: CanvasRenderingContext2D, amount: number, x: number, y: number, h: number, segments?: GarbageMeterSegment[]): void {
  const w = 14;
  const cleanSegments = (segments ?? [])
    .map((s) => ({ ...s, amount: Math.max(0, Math.floor(s.amount)) }))
    .filter((s) => s.amount > 0);
  const total = cleanSegments.length > 0
    ? cleanSegments.reduce((sum, s) => sum + s.amount, 0)
    : Math.max(0, Math.floor(amount));
  const clamped = Math.max(0, Math.min(20, total));

  drawText(ctx, "G", x - 1, y - 10, total > 0 ? "#fb7185" : "#64748b", "bold 13px Consolas");

  ctx.fillStyle = "#111827";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = total > 0 ? "#fb7185" : "#334155";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const rowH = Math.max(2, Math.floor(h / 20));
  let drawn = 0;

  if (cleanSegments.length > 0) {
    // Draw bottom-up in the order supplied. Ready/red is passed first so it grows from the bottom.
    for (const segment of cleanSegments) {
      const rows = Math.min(20 - drawn, segment.amount);
      for (let i = 0; i < rows; i++) {
        const yy = y + h - (drawn + 1) * rowH;
        ctx.fillStyle = segment.color;
        ctx.fillRect(x + 2, yy + 1, w - 4, Math.max(1, rowH - 2));
        drawn++;
      }
      if (drawn >= clamped) break;
    }
  } else {
    for (let i = 0; i < clamped; i++) {
      const yy = y + h - (i + 1) * rowH;
      ctx.fillStyle = i < 8 ? "#f97316" : i < 14 ? "#ef4444" : "#be123c";
      ctx.fillRect(x + 2, yy + 1, w - 4, Math.max(1, rowH - 2));
    }
  }

  if (total > 20) {
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "10px Consolas";
    ctx.fillText(`+${total - 20}`, x - 1, y + 10);
  }

  ctx.fillStyle = total > 0 ? "#fecaca" : "#64748b";
  ctx.font = "12px Consolas";
  ctx.fillText(String(total), x - 2, y + h + 14);

  if (cleanSegments.length > 0) {
    let yy = y + h + 30;
    ctx.font = "10px Consolas";
    ctx.fillStyle = "#fbbf24";
    ctx.fillText(`queued:${total}`, x - 38, yy);
    yy += 12;
    for (const segment of cleanSegments.slice(0, 4)) {
      ctx.fillStyle = segment.color;
      ctx.fillText(`${segment.label}:${segment.amount}`, x - 38, yy);
      yy += 12;
    }
  }
}

export interface DrawBoardOptions {
  x: number;
  y: number;
  cell: number;
  title: string;
  showGhost?: boolean;
  active?: boolean;
  invisibleLocked?: boolean;
  revealInvisible?: boolean;
  holdDisabled?: boolean;
  garbageSegments?: GarbageMeterSegment[];
  nextVisibleCount?: number;
  topCutRows?: number;
  visibleGarbageRows?: number;
  lastStandIndicators?: Array<{ x: number; y: number; color: string; label?: string }>;
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
  const garbageW = 20;
  const boardX = x + sideW + gap + garbageW + gap;
  const topCutRows = Math.max(0, Math.min(19, opts.topCutRows ?? 0));
  const visibleRows = Math.max(1, 20 - topCutRows);
  const boardY = y + topCutRows * cell;
  const boardW = 10 * cell;
  const boardH = visibleRows * cell;
  const nextX = boardX + boardW + gap;

  const panelW = sideW + gap + garbageW + gap + boardW + gap + sideW + 24;
  const panelH = 20 * cell + 130;

  drawRoundRect(ctx, x - 12, y - 50, panelW, panelH, 14, "#0d1423");
  drawText(ctx, title, x, y - 22, "#38bdf8", "bold 22px Consolas");
  if (topCutRows > 0) drawText(ctx, `safe height ${visibleRows}`, boardX, boardY - 8, "#fb7185", "12px Consolas");

  // HOLD: left side of this player's board.
  drawMiniPiece(ctx, engine.hold, x, y, 15, "HOLD");
  if (opts.holdDisabled) {
    ctx.strokeStyle = "#f87171";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, 85, 55);
    ctx.lineWidth = 1;
    drawText(ctx, "NO HOLD", x + 11, y + 51, "#fecaca", "bold 12px Consolas");
  }

  // Visible garbage queue: between HOLD and board.
  drawGarbageMeter(ctx, engine.pendingGarbage, x + sideW + gap, boardY, boardH, opts.garbageSegments);

  // Board: center. Last Stand cuts rows from the top, so only the lower
  // visibleRows are drawn and used for the visible playfield.
  const visible = engine.board.slice(HIDDEN_ROWS + topCutRows);
  const garbageRows = visible
    .map((r, idx) => r.some((c) => c === "G" || c === "B") ? idx : -1)
    .filter((idx) => idx >= 0);
  const visibleGarbageRows = opts.visibleGarbageRows ?? Number.POSITIVE_INFINITY;
  const visibleGarbageSet = new Set(garbageRows.slice(0, Math.max(0, visibleGarbageRows)));
  for (let row = 0; row < visibleRows; row++) {
    for (let col = 0; col < 10; col++) {
      const px = boardX + col * cell;
      const py = boardY + row * cell;
      const c = visible[row][col];
      const hideLocked = opts.invisibleLocked && !opts.revealInvisible && c !== null && c !== "G" && c !== "B";
      ctx.fillStyle = hideLocked ? cellColor(null) : cellColor(c);
      ctx.fillRect(px, py, cell, cell);
      ctx.strokeStyle = "#2b2f3a";
      ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
    }
  }

  if (opts.lastStandIndicators?.length) {
    for (const marker of opts.lastStandIndicators) {
      if (marker.x < 0 || marker.x >= 10 || marker.y < 0 || marker.y >= visibleRows) continue;
      const cx = boardX + marker.x * cell + cell / 2;
      const cy = boardY + marker.y * cell + cell / 2;
      const isNext = marker.label === "next";

      ctx.save();
      ctx.strokeStyle = marker.color;
      ctx.fillStyle = marker.color;
      ctx.lineWidth = isNext ? 2 : 3;
      ctx.setLineDash(isNext ? [4, 3] : []);
      ctx.beginPath();
      ctx.arc(cx, cy, isNext ? cell * 0.22 : cell * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = isNext ? 0.16 : 0.24;
      ctx.fillRect(boardX + marker.x * cell + 2, boardY + marker.y * cell + 2, cell - 4, cell - 4);
      ctx.globalAlpha = 1;
      drawText(ctx, isNext ? "N" : "H", cx - 4, cy + 4, marker.color, "bold 11px Consolas");
      ctx.restore();
    }
  }

  // NEXT: right side of this player's board.
  drawNextQueue(ctx, engine.queue, nextX, y, opts.nextVisibleCount ?? 6);

  // Ghost is shown for every board, including AI and AI Battle boards.
  // showGhost=false is intentionally ignored so AI placement preview is visible.
  if (!engine.dead) {
    const ghost = engine.ghostPiece();
    for (const [gx, gy] of shapeCells(ghost)) {
      const vy = gy - HIDDEN_ROWS - topCutRows;
      if (gx < 0 || gx >= 10 || vy < 0 || vy >= visibleRows) continue;
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.strokeRect(boardX + gx * cell + 5, boardY + vy * cell + 5, cell - 10, cell - 10);
      ctx.lineWidth = 1;
    }
  }

  if (opts.active && !engine.dead) {
    drawPieceCells(ctx, engine.active, boardX, boardY, cell, COLORS[engine.active.kind], "#ffffff", topCutRows);
  }

  const metrics = boardMetrics(engine.stateDict().board);
  const infoY = boardY + boardH + 24;
  drawText(ctx, `active=${engine.active.kind} canHold=${engine.canHold}`, boardX, infoY, "#e5e7eb", "14px Consolas");
  drawText(ctx, `lines=${engine.lines} pieces=${engine.piecesLocked} garbage=${engine.pendingGarbage}`, boardX, infoY + 20, "#94a3b8", "14px Consolas");
  drawText(ctx, `combo=${engine.combo} b2b=${engine.b2b} holes=${metrics.holes} height=${metrics.maxHeight}`, boardX, infoY + 40, "#94a3b8", "14px Consolas");
  if (engine.lastResult) {
    const r = engine.lastResult;
    const parts = [
      `last: ${r.linesCleared}L ${r.spin}`,
      `atk=${r.attackSent}`,
      `base=${r.attackBase ?? "?"}`,
      `b2b=${r.attackB2bBonus ?? 0}`,
      `cmb=${r.attackComboBonus ?? 0}`,
      r.attackCapped ? "cap" : ""
    ].filter(Boolean).join(" ");
    drawText(ctx, parts, boardX, infoY + 60, r.attackSent >= 8 ? "#fca5a5" : "#94a3b8", "14px Consolas");
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
