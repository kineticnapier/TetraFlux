export const WIDTH = 10;
export const VISIBLE_HEIGHT = 20;
export const HIDDEN_ROWS = 2;
export const HEIGHT = VISIBLE_HEIGHT + HIDDEN_ROWS;
export const PIECES = ["I", "J", "L", "O", "S", "T", "Z"] as const;

export type PieceKind = typeof PIECES[number];
export type Cell = PieceKind | "G" | "B" | null;
export type SpinType = "none" | "tspin" | "tspin-mini" | "spin";

export interface PieceState {
  kind: PieceKind;
  x: number;
  y: number;
  rot: number;
}

export interface PlacementAction {
  piece: PieceKind;
  x: number;
  rot: number;
  hold: boolean;
  key: string;
}

export interface LockResult {
  ok: boolean;
  reason: string;
  piece?: PieceKind;
  x?: number;
  y?: number;
  rot?: number;
  usedHold: boolean;
  linesCleared: number;
  attackSent: number;
  rawAttack: number;
  attackBase?: number;
  attackB2bBonus?: number;
  attackComboBonus?: number;
  attackCapped?: boolean;
  combo: number;
  b2b: number;
  spin: SpinType;
  topout: boolean;
  boardBefore?: string[];
  boardAfter?: string[];
}

export interface GarbageOptions {
  scatterChance?: number;
  doubleHoleChance?: number;
}

export interface EngineState {
  board: string[];
  board22: string[];
  active: PieceState;
  hold: PieceKind | null;
  canHold: boolean;
  queue: PieceKind[];
  dead: boolean;
  lines: number;
  piecesLocked: number;
  pendingGarbage: number;
  combo: number;
  b2b: number;
}

export interface BoardMetrics {
  blocks: number;
  holes: number;
  heights: number[];
  maxHeight: number;
  totalHeight: number;
  bumpiness: number;
  wells: number;
}

export const SHAPES: Record<PieceKind, Array<Array<[number, number]>>> = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]]
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]]
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]]
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]]
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]]
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]]
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]]
  ]
};

type KickKey = `${number}>${number}`;

const JLSTZ_KICKS: Record<KickKey, Array<[number, number]>> = {
  "0>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "1>0": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "1>2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "2>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "3>2": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "3>0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "0>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]
};

const I_KICKS: Record<KickKey, Array<[number, number]>> = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]
};

// TETR.IO's 180 system is not fully reproduced. This is an SRS-like 180 kick set.
const KICKS_180: Array<[number, number]> = [
  [0, 0], [0, -1], [1, 0], [-1, 0], [0, 1],
  [2, 0], [-2, 0], [1, -1], [-1, -1], [1, 1], [-1, 1], [0, -2]
];

export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  clone(): Rng {
    const r = new Rng(1);
    r.state = this.state >>> 0;
    return r;
  }

  next(): number {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
}

export class SevenBag {
  rng: Rng;
  bag: PieceKind[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  clone(): SevenBag {
    const b = new SevenBag(1);
    b.rng = this.rng.clone();
    b.bag = [...this.bag];
    return b;
  }

  next(): PieceKind {
    if (this.bag.length === 0) {
      this.bag = [...PIECES];
      this.rng.shuffle(this.bag);
    }
    return this.bag.pop()!;
  }

  take(n: number): PieceKind[] {
    return Array.from({ length: n }, () => this.next());
  }
}

export function emptyBoard(): Cell[][] {
  return Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => null));
}

export function boardToStrings(board: Cell[][], visibleOnly = false): string[] {
  const rows = visibleOnly ? board.slice(HIDDEN_ROWS) : board;
  return rows.map((row) => row.map((c) => c ?? ".").join(""));
}

export function copyPiece(p: PieceState): PieceState {
  return { kind: p.kind, x: p.x, y: p.y, rot: ((p.rot % 4) + 4) % 4 };
}

export function shapeCells(piece: PieceState): Array<[number, number]> {
  return SHAPES[piece.kind][((piece.rot % 4) + 4) % 4].map(([dx, dy]) => [piece.x + dx, piece.y + dy]);
}

function isDifficultClear(lines: number, spin: SpinType): boolean {
  return lines === 4 || ((spin === "tspin" || spin === "tspin-mini" || spin === "spin") && lines > 0);
}

interface AttackCalc {
  total: number;
  base: number;
  b2bBonus: number;
  comboBonus: number;
  capped: boolean;
}

function calcAttack(lines: number, spin: SpinType, combo: number, b2bBeforeClear: number): AttackCalc {
  if (lines <= 0) return { total: 0, base: 0, b2bBonus: 0, comboBonus: 0, capped: false };

  let base = 0;
  const isSpin = spin === "tspin" || spin === "tspin-mini" || spin === "spin";
  const isQuad = spin === "none" && lines >= 4;
  const difficult = isSpin || isQuad;

  if (spin === "tspin") {
    if (lines === 1) base = 2;
    else if (lines === 2) base = 4;
    else if (lines === 3) base = 6;
    else if (lines >= 4) base = 8;
  } else if (spin === "tspin-mini") {
    if (lines === 1) base = 1;
    else if (lines === 2) base = 3;
    else if (lines >= 3) base = 4;
  } else if (spin === "spin") {
    if (lines === 1) base = 1;
    else if (lines === 2) base = 2;
    else if (lines === 3) base = 4;
    else if (lines >= 4) base = 6;
  } else {
    // Ordinary line clears: Single 0, Double 1, Triple 2, Quad/Tetris 4.
    if (lines === 1) base = 0;
    else if (lines === 2) base = 1;
    else if (lines === 3) base = 2;
    else if (lines >= 4) base = 4;
  }

  const b2bBonus = base > 0 && b2bBeforeClear > 0 && difficult ? 1 : 0;
  let comboBonus = combo > 0 ? Math.min(4, Math.floor((combo + 1) / 2)) : 0;

  let total = base + b2bBonus + comboBonus;
  let capped = false;

  // Ordinary single/double/triple base attack is small, but combo pressure
  // should still matter. Singles can send attack once combo stacks high enough.
  if (spin === "none" && lines < 4) {
    const cap = lines + Math.max(0, Math.floor(combo / 2));
    if (total > cap) {
      total = cap;
      comboBonus = Math.max(0, total - base - b2bBonus);
      capped = true;
    }
  }

  return { total, base, b2bBonus, comboBonus, capped };
}

export function attackFor(lines: number, spin: SpinType, combo: number, b2bBeforeClear: number): number {
  return calcAttack(lines, spin, combo, b2bBeforeClear).total;
}

export function boardMetrics(rows: string[]): BoardMetrics {
  const visible = rows.length === HEIGHT ? rows.slice(HIDDEN_ROWS) : rows.slice(-VISIBLE_HEIGHT);
  const fixed = visible.length < VISIBLE_HEIGHT
    ? [...Array.from({ length: VISIBLE_HEIGHT - visible.length }, () => ".".repeat(WIDTH)), ...visible]
    : visible.slice(-VISIBLE_HEIGHT);

  const heights: number[] = [];
  let holes = 0;
  let blocks = 0;

  for (let x = 0; x < WIDTH; x++) {
    let height = 0;
    let seen = false;
    for (let top = 0; top < VISIBLE_HEIGHT; top++) {
      const y = VISIBLE_HEIGHT - 1 - top;
      const filled = fixed[top][x] !== ".";
      if (filled) {
        blocks++;
        seen = true;
        height = Math.max(height, y + 1);
      } else if (seen) {
        holes++;
      }
    }
    heights.push(height);
  }

  let bumpiness = 0;
  for (let i = 0; i < heights.length - 1; i++) bumpiness += Math.abs(heights[i] - heights[i + 1]);

  let wells = 0;
  for (let i = 0; i < heights.length; i++) {
    const left = i > 0 ? heights[i - 1] : VISIBLE_HEIGHT;
    const right = i < heights.length - 1 ? heights[i + 1] : VISIBLE_HEIGHT;
    wells += Math.max(0, Math.min(left, right) - heights[i]);
  }

  return {
    blocks,
    holes,
    heights,
    maxHeight: Math.max(...heights),
    totalHeight: heights.reduce((a, b) => a + b, 0),
    bumpiness,
    wells
  };
}

export class TetrisEngine {
  bag: SevenBag;
  garbageRng: Rng;
  board: Cell[][];
  queue: PieceKind[];
  hold: PieceKind | null = null;
  canHold = true;
  holdUsedForCurrentPiece = false;
  active: PieceState;
  dead = false;
  lines = 0;
  piecesLocked = 0;
  pendingGarbage = 0;
  combo = -1;
  b2b = 0;
  lastResult: LockResult | null = null;

  private lastActionWasRotation = false;
  private lastKickIndex = 0;
  private placementActionMode = false;

  // Garbage holes are intentionally "sticky" so incoming garbage looks closer
  // to TETR.IO-style garbage instead of fully random cheese every line.
  // A hole column is kept for at least 4 inserted garbage rows.
  // About 5% of rows still become scattered single-line holes.
  private garbageHole: number | null = null;
  private garbageHoleRunRemaining = 0;
  private garbageOptions: GarbageOptions = {};

  constructor(seed: number, garbageSeed?: number) {
    this.bag = new SevenBag(seed);
    this.garbageRng = new Rng(garbageSeed ?? seed);
    this.board = emptyBoard();
    this.active = { kind: this.bag.next(), x: 3, y: 0, rot: 0 };
    this.queue = this.bag.take(7);
    if (this.collides(this.active)) this.dead = true;
  }

  clone(): TetrisEngine {
    const e = Object.create(TetrisEngine.prototype) as TetrisEngine;
    e.bag = this.bag.clone();
    e.garbageRng = this.garbageRng.clone();
    e.board = this.board.map((row) => [...row]);
    e.queue = [...this.queue];
    e.hold = this.hold;
    e.canHold = this.canHold;
    e.holdUsedForCurrentPiece = this.holdUsedForCurrentPiece;
    e.active = copyPiece(this.active);
    e.dead = this.dead;
    e.lines = this.lines;
    e.piecesLocked = this.piecesLocked;
    e.pendingGarbage = this.pendingGarbage;
    e.combo = this.combo;
    e.b2b = this.b2b;
    e.lastResult = this.lastResult ? { ...this.lastResult } : null;
    e.lastActionWasRotation = this.lastActionWasRotation;
    e.lastKickIndex = this.lastKickIndex;
    e.placementActionMode = this.placementActionMode;
    e.garbageHole = this.garbageHole;
    e.garbageHoleRunRemaining = this.garbageHoleRunRemaining;
    e.garbageOptions = { ...this.garbageOptions };
    return e;
  }

  stateDict(): EngineState {
    return {
      board: boardToStrings(this.board, true),
      board22: boardToStrings(this.board, false),
      active: copyPiece(this.active),
      hold: this.hold,
      canHold: this.canHold,
      queue: [...this.queue],
      dead: this.dead,
      lines: this.lines,
      piecesLocked: this.piecesLocked,
      pendingGarbage: this.pendingGarbage,
      combo: this.combo,
      b2b: this.b2b
    };
  }

  collides(piece: PieceState): boolean {
    for (const [x, y] of shapeCells(piece)) {
      if (x < 0 || x >= WIDTH) return true;
      if (y >= HEIGHT) return true;
      if (y >= 0 && this.board[y][x] !== null) return true;
    }
    return false;
  }

  private cellKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private collidesIgnoringLocked(piece: PieceState, lockedCells: Set<string>): boolean {
    for (const [x, y] of shapeCells(piece)) {
      if (x < 0 || x >= WIDTH) return true;
      if (y >= HEIGHT) return true;
      if (y >= 0 && this.board[y][x] !== null && !lockedCells.has(this.cellKey(x, y))) return true;
    }
    return false;
  }

  isOccupiedOrWall(x: number, y: number): boolean {
    if (x < 0 || x >= WIDTH || y >= HEIGHT) return true;
    if (y < 0) return true;
    return this.board[y][x] !== null;
  }

  private isOccupiedOrWallIgnoringLocked(x: number, y: number, lockedCells: Set<string>): boolean {
    if (x < 0 || x >= WIDTH || y >= HEIGHT) return true;
    if (y < 0) return true;
    return this.board[y][x] !== null && !lockedCells.has(this.cellKey(x, y));
  }

  move(dx: number, dy = 0): boolean {
    if (this.dead) return false;
    const p = copyPiece(this.active);
    p.x += dx;
    p.y += dy;
    if (!this.collides(p)) {
      this.active = p;
      this.lastActionWasRotation = false;
      return true;
    }
    return false;
  }

  private kickTable(kind: PieceKind, oldRot: number, newRot: number, delta: number): Array<[number, number]> {
    if (kind === "O") return [[0, 0]];
    if (Math.abs(delta) === 2) return KICKS_180;
    const key = `${oldRot}>${newRot}` as KickKey;
    return kind === "I" ? (I_KICKS[key] ?? [[0, 0]]) : (JLSTZ_KICKS[key] ?? [[0, 0]]);
  }

  rotate(delta: number): boolean {
    if (this.dead) return false;
    const oldRot = ((this.active.rot % 4) + 4) % 4;
    const newRot = (oldRot + delta + 4) % 4;
    const kicks = this.kickTable(this.active.kind, oldRot, newRot, delta);

    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      const p = copyPiece(this.active);
      p.rot = newRot;
      p.x += kx;
      p.y += ky;
      if (!this.collides(p)) {
        this.active = p;
        this.lastActionWasRotation = true;
        this.lastKickIndex = i;
        return true;
      }
    }
    return false;
  }

  rotateCw(): boolean { return this.rotate(1); }
  rotateCcw(): boolean { return this.rotate(-1); }
  rotate180(): boolean { return this.rotate(2); }

  hardDropDistance(piece = this.active): number {
    let p = copyPiece(piece);
    let dist = 0;
    while (true) {
      const q = copyPiece(p);
      q.y += 1;
      if (this.collides(q)) return dist;
      p = q;
      dist++;
    }
  }

  ghostPiece(): PieceState {
    const p = copyPiece(this.active);
    p.y += this.hardDropDistance(p);
    return p;
  }

  holdPiece(): boolean {
    if (this.dead || !this.canHold) return false;
    const old = this.active.kind;

    if (this.hold === null) {
      this.hold = old;
      this.active = { kind: this.queue.shift()!, x: 3, y: 0, rot: 0 };
      this.queue.push(this.bag.next());
    } else {
      this.active = { kind: this.hold, x: 3, y: 0, rot: 0 };
      this.hold = old;
    }

    this.canHold = false;
    this.holdUsedForCurrentPiece = true;
    this.lastActionWasRotation = false;
    this.lastKickIndex = 0;

    if (this.collides(this.active)) {
      this.dead = true;
      return false;
    }
    return true;
  }

  hardDrop(): LockResult {
    if (this.dead) return this.makeFail("already_dead");
    this.active.y += this.hardDropDistance(this.active);
    return this.lockPiece();
  }

  private makeFail(reason: string): LockResult {
    return {
      ok: false,
      reason,
      usedHold: this.holdUsedForCurrentPiece,
      linesCleared: 0,
      attackSent: 0,
      rawAttack: 0,
      combo: this.combo,
      b2b: this.b2b,
      spin: "none",
      topout: true
    };
  }

  private countFullLines(): number {
    return this.board.filter((row) => row.every((c) => c !== null)).length;
  }

  private moveWouldWorkIgnoringLocked(piece: PieceState, dx: number, dy: number, lockedCells: Set<string>): boolean {
    const p = copyPiece(piece);
    p.x += dx;
    p.y += dy;
    return !this.collidesIgnoringLocked(p, lockedCells);
  }

  private detectSpin(linesCleared: number, lockedPiece: PieceState, lockedCells: Set<string>): SpinType {
    if (!this.lastActionWasRotation) return "none";

    // AI/applyAction places a final (x, rot) directly, without a key path.
    // Awarding spin credit here makes impossible fake spins extremely common,
    // because many final placements are immobile even though they were not
    // actually rotated into the slot. Human-controlled rotations still use
    // normal spin detection.
    if (this.placementActionMode) return "none";

    if (lockedPiece.kind === "T") {
      const cx = lockedPiece.x + 1;
      const cy = lockedPiece.y + 1;
      const corners = [
        this.isOccupiedOrWallIgnoringLocked(cx - 1, cy - 1, lockedCells),
        this.isOccupiedOrWallIgnoringLocked(cx + 1, cy - 1, lockedCells),
        this.isOccupiedOrWallIgnoringLocked(cx - 1, cy + 1, lockedCells),
        this.isOccupiedOrWallIgnoringLocked(cx + 1, cy + 1, lockedCells)
      ].filter(Boolean).length;

      if (corners >= 3) {
        if (linesCleared === 1 && this.lastKickIndex < 4) return "tspin-mini";
        return "tspin";
      }
    }

    // Approximate all-piece spin:
    // after a rotation, if the final piece cannot move left, right, or down,
    // mark it as a generic spin. This is not exact TETR.IO SRS+, but it makes
    // I/J/L/O/S/Z spin clears visible, scorable, and learnable in this sandbox.
    const immobile =
      !this.moveWouldWorkIgnoringLocked(lockedPiece, 1, 0, lockedCells) &&
      !this.moveWouldWorkIgnoringLocked(lockedPiece, -1, 0, lockedCells) &&
      !this.moveWouldWorkIgnoringLocked(lockedPiece, 0, 1, lockedCells);

    return immobile ? "spin" : "none";
  }

  lockPiece(): LockResult {
    const before = boardToStrings(this.board, true);
    const p = copyPiece(this.active);

    for (const [x, y] of shapeCells(p)) {
      if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || this.board[y][x] !== null) {
        this.dead = true;
        const result: LockResult = {
          ok: false,
          reason: "lock_collision",
          piece: p.kind,
          x: p.x,
          y: p.y,
          rot: p.rot,
          usedHold: this.holdUsedForCurrentPiece,
          linesCleared: 0,
          attackSent: 0,
          rawAttack: 0,
          combo: this.combo,
          b2b: this.b2b,
          spin: "none",
          topout: true,
          boardBefore: before,
          boardAfter: boardToStrings(this.board, true)
        };
        this.lastResult = result;
        this.placementActionMode = false;
        return result;
      }
    }

    const lockedCells = new Set<string>();
    for (const [x, y] of shapeCells(p)) {
      this.board[y][x] = p.kind;
      lockedCells.add(this.cellKey(x, y));
    }

    const lines = this.countFullLines();
    const spin = this.detectSpin(lines, p, lockedCells);
    this.clearLines();
    if (lines > 0) this.convertBrokenGarbageToNormal();
    this.lines += lines;
    this.piecesLocked++;

    const comboBefore = this.combo;
    if (lines > 0) this.combo = this.combo < 0 ? 0 : this.combo + 1;
    else this.combo = -1;

    const b2bBefore = this.b2b;
    const difficult = isDifficultClear(lines, spin);
    const attack = calcAttack(lines, spin, this.combo, b2bBefore);
    const rawAttack = attack.total;

    if (lines > 0) {
      if (difficult) this.b2b += 1;
      else this.b2b = 0;
    }

    this.canHold = true;
    const usedHold = this.holdUsedForCurrentPiece;
    this.holdUsedForCurrentPiece = false;

    const hiddenOccupied = this.board.slice(0, HIDDEN_ROWS).some((row) => row.some((c) => c !== null));
    if (hiddenOccupied) this.dead = true;

    if (!this.dead) {
      // Garbage is intentionally NOT applied here.
      // The match controller first cancels incoming garbage with outgoing attack,
      // then calls applyPendingGarbage() if anything remains. This matches the
      // TETR.IO-like visible garbage queue/countering flow used by the trainer.
      this.spawnNext();
    }

    const result: LockResult = {
      ok: true,
      reason: hiddenOccupied ? "topout_hidden" : "",
      piece: p.kind,
      x: p.x,
      y: p.y,
      rot: p.rot,
      usedHold,
      linesCleared: lines,
      attackSent: rawAttack,
      rawAttack,
      attackBase: attack.base,
      attackB2bBonus: attack.b2bBonus,
      attackComboBonus: attack.comboBonus,
      attackCapped: attack.capped,
      combo: comboBefore,
      b2b: b2bBefore,
      spin,
      topout: hiddenOccupied || this.dead,
      boardBefore: before,
      boardAfter: boardToStrings(this.board, true)
    };

    this.lastResult = result;
    this.lastActionWasRotation = false;
    this.lastKickIndex = 0;
    this.placementActionMode = false;
    return result;
  }

  clearLines(): number {
    const kept = this.board.filter((row) => row.some((c) => c === null));
    const cleared = HEIGHT - kept.length;
    while (kept.length < HEIGHT) kept.unshift(Array.from({ length: WIDTH }, () => null));
    this.board = kept;
    return cleared;
  }

  spawnNext(): void {
    this.active = { kind: this.queue.shift()!, x: 3, y: 0, rot: 0 };
    this.queue.push(this.bag.next());
    this.lastActionWasRotation = false;
    this.lastKickIndex = 0;
    if (this.collides(this.active)) this.dead = true;
  }

  setGarbageOptions(options: GarbageOptions = {}): void {
    this.garbageOptions = { ...options };
  }

  queueGarbage(n: number): void {
    this.pendingGarbage += Math.max(0, Math.floor(n));
  }

  private nextGarbageHole(): number {
    const scatterChance = this.garbageOptions.scatterChance ?? 0.05;

    // Scatter one row without consuming/changing the current clean streak.
    if (this.garbageRng.next() < scatterChance) return this.garbageRng.int(WIDTH);

    if (this.garbageHole === null || this.garbageHoleRunRemaining <= 0) {
      const prev = this.garbageHole;
      let next = this.garbageRng.int(WIDTH);

      // Prefer changing column when a streak ends, but don't force it if RNG
      // repeatedly lands on the same column.
      if (prev !== null && WIDTH > 1) {
        for (let i = 0; i < 4 && next === prev; i++) next = this.garbageRng.int(WIDTH);
      }

      this.garbageHole = next;
      // At least 4 rows aligned. Extra 0-4 rows makes the pattern less robotic.
      this.garbageHoleRunRemaining = 4 + this.garbageRng.int(5);
    }

    this.garbageHoleRunRemaining--;
    return this.garbageHole;
  }

  private nextGarbageHoles(): number[] {
    const holes = new Set<number>([this.nextGarbageHole()]);
    const doubleHoleChance = this.garbageOptions.doubleHoleChance ?? 0;

    if (this.garbageRng.next() < doubleHoleChance) {
      for (let i = 0; i < 6 && holes.size < 2; i++) {
        holes.add(this.garbageRng.int(WIDTH));
      }
    }

    return [...holes];
  }

  private convertBrokenGarbageToNormal(): void {
    for (const row of this.board) {
      for (let x = 0; x < WIDTH; x++) {
        if (row[x] === "B") row[x] = "G";
      }
    }
  }

  addBrokenGarbageRows(n = 1): void {
    const rows = Math.max(0, Math.floor(n));
    for (let i = 0; i < rows; i++) {
      const holes = new Set<number>([this.nextGarbageHole()]);
      const row: Cell[] = Array.from({ length: WIDTH }, (_, x) => holes.has(x) ? null : "B");
      this.board.shift();
      this.board.push(row);
    }

    const hiddenOccupied = this.board.slice(0, HIDDEN_ROWS).some((row) => row.some((c) => c !== null));
    if (hiddenOccupied) this.dead = true;
  }

  applyPendingGarbage(): void {
    if (this.pendingGarbage <= 0) return;
    for (let i = 0; i < this.pendingGarbage; i++) {
      const holes = new Set(this.nextGarbageHoles());
      const row: Cell[] = Array.from({ length: WIDTH }, (_, x) => holes.has(x) ? null : "G");
      this.board.shift();
      this.board.push(row);
    }
    this.pendingGarbage = 0;
    const hiddenOccupied = this.board.slice(0, HIDDEN_ROWS).some((row) => row.some((c) => c !== null));
    if (hiddenOccupied) this.dead = true;
  }

  applyAction(action: PlacementAction): LockResult {
    if (this.dead) return this.makeFail("already_dead");
    if (action.hold) {
      if (!this.holdPiece()) return this.makeFail("hold_failed");
    }

    this.active.x = action.x;
    this.active.y = 0;
    this.active.rot = ((action.rot % 4) + 4) % 4;

    if (this.collides(this.active)) {
      this.dead = true;
      return this.makeFail("spawn_collision_after_action");
    }

    // Placement-level AI has no key-by-key rotation path. Do not award spin
    // credit to direct placements; otherwise immobile final positions become
    // impossible fake spins and generate too much attack.
    this.placementActionMode = true;
    this.lastActionWasRotation = false;
    this.lastKickIndex = 0;

    return this.hardDrop();
  }

  legalPlacements(includeHold = true): PlacementAction[] {
    const out: PlacementAction[] = [];

    const enumerate = (engine: TetrisEngine, hold: boolean) => {
      const piece = engine.active.kind;
      for (let rot = 0; rot < 4; rot++) {
        for (let x = -3; x <= WIDTH + 2; x++) {
          const e = engine.clone();
          e.active = { kind: piece, x, y: 0, rot };
          if (e.collides(e.active)) continue;
          const dist = e.hardDropDistance(e.active);
          e.active.y += dist;
          if (e.collides(e.active)) continue;
          out.push({ piece, x, rot, hold, key: `${hold ? "H:" : ""}${piece}:${x}:${rot}` });
        }
      }
    };

    enumerate(this, false);

    if (includeHold && this.canHold) {
      const e = this.clone();
      if (e.holdPiece() && !e.dead) enumerate(e, true);
    }

    const seen = new Set<string>();
    return out.filter((a) => {
      const k = `${a.hold}:${a.piece}:${a.x}:${a.rot}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
}
