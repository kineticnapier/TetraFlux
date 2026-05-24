import type { AiChoice } from "./heuristic";
import { TetrisEngine, type LockResult } from "../engine/tetris";

type AiMoveOp = "hold" | "left" | "right" | "cw" | "ccw" | "180" | "soft";

export interface BenchmarkPlacementMetrics {
  routeUsed: boolean;
  routeFailed: boolean;
  spinFinisherAttempt: boolean;
  spinFinisherSuccess: boolean;
  usedDirectApply: boolean;
}

export interface BenchmarkPlacementResult {
  result: LockResult;
  metrics: BenchmarkPlacementMetrics;
}

function normalizeRot(rot: number): number {
  return ((rot % 4) + 4) % 4;
}

function activeKey(engine: TetrisEngine): string {
  const a = engine.active;
  return `${a.kind}:${a.x}:${a.y}:${normalizeRot(a.rot)}`;
}

function isSpinFinisherChoice(choice: AiChoice): boolean {
  const info = (choice.aiInfo ?? {}) as Record<string, unknown>;
  return info.spinFinisher === true || info.source === "spin_finisher";
}

function applyMove(engine: TetrisEngine, op: AiMoveOp): boolean {
  if (op === "hold") return engine.holdPiece();
  if (op === "left") return engine.move(-1, 0);
  if (op === "right") return engine.move(1, 0);
  if (op === "cw") return engine.rotateCw();
  if (op === "ccw") return engine.rotateCcw();
  if (op === "180") return engine.rotate180();
  return engine.move(0, 1);
}

function endsWithRotation(ops: AiMoveOp[]): boolean {
  const last = ops[ops.length - 1];
  return last === "cw" || last === "ccw" || last === "180";
}

function findRoute(engine: TetrisEngine, action: AiChoice, preferSpinFinish: boolean): AiMoveOp[] | null {
  const targetX = action.x;
  const targetRot = normalizeRot(action.rot);
  const start = engine.clone();
  const prefix: AiMoveOp[] = [];

  if (action.hold) {
    if (!start.holdPiece()) return null;
    prefix.push("hold");
  }
  if (start.active.kind !== action.piece) return null;

  const targetProbe = start.clone();
  targetProbe.active = { kind: action.piece, x: targetX, y: 0, rot: targetRot };
  if (targetProbe.collides(targetProbe.active)) return null;
  const targetY = targetProbe.hardDropDistance(targetProbe.active);

  const isTargetBeforeDrop = (e: TetrisEngine) =>
    e.active.kind === action.piece &&
    e.active.x === targetX &&
    normalizeRot(e.active.rot) === targetRot &&
    e.hardDropDistance(e.active) === targetY;

  if (!preferSpinFinish && isTargetBeforeDrop(start)) return prefix;

  const ops: AiMoveOp[] = ["cw", "ccw", "180", "left", "right", "soft"];
  const queue: Array<{ engine: TetrisEngine; path: AiMoveOp[] }> = [{ engine: start, path: [] }];
  const seen = new Set<string>([activeKey(start)]);
  const maxPath = preferSpinFinish ? 34 : 28;
  const maxStates = preferSpinFinish ? 190 : 140;

  for (let head = 0; head < queue.length && seen.size <= maxStates; head++) {
    const cur = queue[head];
    if (cur.path.length >= maxPath) continue;
    for (const op of ops) {
      const next = cur.engine.clone();
      if (!applyMove(next, op)) continue;
      const key = activeKey(next);
      if (seen.has(key)) continue;
      seen.add(key);

      const path = [...cur.path, op];
      const fullPath = [...prefix, ...path];
      if (isTargetBeforeDrop(next)) {
        if (!preferSpinFinish || endsWithRotation(fullPath)) return fullPath;
      }
      queue.push({ engine: next, path });
      if (seen.size > maxStates) break;
    }
  }

  return null;
}

export function executeBenchmarkAction(engine: TetrisEngine, action: AiChoice): BenchmarkPlacementResult {
  const spinFinisherAttempt = isSpinFinisherChoice(action);
  if (!spinFinisherAttempt) {
    return {
      result: engine.applyAction(action),
      metrics: { routeUsed: false, routeFailed: false, spinFinisherAttempt: false, spinFinisherSuccess: false, usedDirectApply: true },
    };
  }

  const route = findRoute(engine, action, true);
  if (!route) {
    return {
      result: engine.applyAction(action),
      metrics: { routeUsed: false, routeFailed: true, spinFinisherAttempt: true, spinFinisherSuccess: false, usedDirectApply: true },
    };
  }

  for (const op of route) {
    if (!applyMove(engine, op)) {
      return {
        result: engine.applyAction(action),
        metrics: { routeUsed: false, routeFailed: true, spinFinisherAttempt: true, spinFinisherSuccess: false, usedDirectApply: true },
      };
    }
  }

  const result = engine.hardDrop();
  const spinFinisherSuccess = result.ok && result.spin !== "none" && result.linesCleared > 0;
  return {
    result,
    metrics: { routeUsed: true, routeFailed: false, spinFinisherAttempt: true, spinFinisherSuccess, usedDirectApply: false },
  };
}
