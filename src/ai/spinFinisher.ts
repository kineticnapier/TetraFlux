import { boardMetrics, TetrisEngine, type PlacementAction, type SpinType } from "../engine/tetris";
import { estimateSpinPotential } from "./spinPotential";
import type { AiChoice } from "./heuristic";

export type AiMoveOp = "hold" | "left" | "right" | "cw" | "ccw" | "180" | "soft";
export type SpinFinisherRejectReason = "no_ready_slot" | "no_t_available" | "route_not_found" | "route_budget_exceeded" | "terrain_too_bad";
export type RouteFailureReason = "no_path_to_target" | "final_rotation_not_possible" | "target_not_placeable" | "route_budget_exceeded";
export type RouteDiagnostics = {
  searchedNodes: number;
  rejectedByCollision: number;
  rejectedByFinalOp: number;
  targetUnreachable: number;
  maxDepthHit: number;
  failureReason?: RouteFailureReason;
};

function normalizeRot(rot: number): number { return ((rot % 4) + 4) % 4; }
export function moveOpsEndWithRotation(ops: AiMoveOp[]): boolean {
  const last = ops[ops.length - 1];
  return last === "cw" || last === "ccw" || last === "180";
}

export function applyMove(engine: TetrisEngine, op: AiMoveOp): boolean {
  if (op === "hold") return engine.holdPiece();
  if (op === "left") return engine.move(-1, 0);
  if (op === "right") return engine.move(1, 0);
  if (op === "cw") return engine.rotateCw();
  if (op === "ccw") return engine.rotateCcw();
  if (op === "180") return engine.rotate180();
  return engine.move(0, 1);
}

export function findMoveRoute(engine: TetrisEngine, action: PlacementAction, preferSpinFinish = false, diagnostics?: RouteDiagnostics): AiMoveOp[] | null {
  const diag: RouteDiagnostics = diagnostics ?? { searchedNodes: 0, rejectedByCollision: 0, rejectedByFinalOp: 0, targetUnreachable: 0, maxDepthHit: 0 };
  const targetX = action.x;
  const targetRot = normalizeRot(action.rot);
  const start = engine.clone();
  const prefix: AiMoveOp[] = [];
  if (action.hold) { if (!start.holdPiece()) return null; prefix.push("hold"); }
  if (start.active.kind !== action.piece) return null;

  const targetProbe = start.clone();
  targetProbe.active = { kind: action.piece, x: targetX, y: 0, rot: targetRot };
  if (targetProbe.collides(targetProbe.active)) {
    diag.targetUnreachable++;
    diag.failureReason = "target_not_placeable";
    return null;
  }
  const targetY = targetProbe.hardDropDistance(targetProbe.active);

  const isTargetBeforeDrop = (e: TetrisEngine) => {
    const dropY = e.hardDropDistance(e.active);
    const dropped = { ...e.active, y: dropY };
    const droppedY = dropped.y;
    return e.active.kind === action.piece &&
    e.active.x === targetX &&
    normalizeRot(e.active.rot) === targetRot &&
    Math.abs(droppedY - targetY) <= 1;
  };

  if (!preferSpinFinish && isTargetBeforeDrop(start)) return prefix;

  const ops: AiMoveOp[] = preferSpinFinish
    ? ["cw", "ccw", "180", "left", "right", "soft", "soft"]
    : ["cw", "ccw", "180", "left", "right", "soft"];
  const queue: Array<{ engine: TetrisEngine; path: AiMoveOp[] }> = [{ engine: start, path: [] }];
  const seen = new Set<string>([`${start.active.kind}:${start.active.x}:${start.active.y}:${normalizeRot(start.active.rot)}`]);
  const maxPath = preferSpinFinish ? 30 : 24;
  const maxStates = preferSpinFinish ? 180 : 110;
  let budgetExceeded = false;

  for (let head = 0; head < queue.length && seen.size <= maxStates; head++) {
    const cur = queue[head];
    if (cur.path.length >= maxPath) {
      diag.maxDepthHit++;
      continue;
    }
    for (const op of ops) {
      const next = cur.engine.clone();
      if (!applyMove(next, op)) {
        diag.rejectedByCollision++;
        continue;
      }
      const key = `${next.active.kind}:${next.active.x}:${next.active.y}:${normalizeRot(next.active.rot)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diag.searchedNodes++;
      const path = [...cur.path, op];
      const fullPath = [...prefix, ...path];
      if (isTargetBeforeDrop(next)) {
        if (!preferSpinFinish || moveOpsEndWithRotation(fullPath)) return fullPath;
        diag.rejectedByFinalOp++;
      }
      queue.push({ engine: next, path });
      if (seen.size > maxStates) { budgetExceeded = true; break; }
    }
  }
  if (budgetExceeded) diag.failureReason = "route_budget_exceeded";
  else if (diag.rejectedByFinalOp > 0) diag.failureReason = "final_rotation_not_possible";
  else diag.failureReason = "no_path_to_target";
  return null;
}

function expectedLinesForSpinKind(kind: string): number {
  if (kind === "TST") return 3;
  if (kind === "TSD_LEFT" || kind === "TSD_RIGHT" || kind === "STSD") return 2;
  return 1;
}

function expectedSpin(kind: string): "TSD" | "TST" | "SPIN" {
  if (kind === "TST") return "TST";
  if (kind === "TSD_LEFT" || kind === "TSD_RIGHT" || kind === "STSD") return "TSD";
  return "SPIN";
}

export function findReadySpinFinisherChoice(engine: TetrisEngine): { choice: AiChoice | null; reason?: SpinFinisherRejectReason } {
  const state = engine.stateDict();
  const target = estimateSpinPotential(state).bestTarget;
  if (!target) return { choice: null, reason: "no_ready_slot" };

  const spinCapable = ["TSD_LEFT", "TSD_RIGHT", "TST", "STSD", "TSlot"].includes(target.kind);
  if (!spinCapable) return { choice: null, reason: "no_ready_slot" };

  const tNow = engine.active.kind === "T" || (engine.canHold && (engine.hold === "T" || (engine.hold === null && engine.queue[0] === "T")));
  if (!tNow) return { choice: null, reason: "no_t_available" };

  const metrics = boardMetrics(state.board);
  const topRowsBlocked = state.board.slice(0, 6).some((row) => /[^.]/.test(row));
  if (metrics.maxHeight > 8 || engine.pendingGarbage >= 4 || metrics.holes > 1 || metrics.bumpiness > 12 || metrics.totalHeight > 35 || topRowsBlocked) return { choice: null, reason: "terrain_too_bad" };

  const expectedLines = expectedLinesForSpinKind(target.kind);
  const legal = engine.legalPlacements(true).filter((a) => a.piece === "T");
  let best: AiChoice | null = null;
  for (const action of legal) {
    const routeDiag: RouteDiagnostics = { searchedNodes: 0, rejectedByCollision: 0, rejectedByFinalOp: 0, targetUnreachable: 0, maxDepthHit: 0 };
    const route = findMoveRoute(engine, action, true, routeDiag);
    if (!route || !moveOpsEndWithRotation(route)) continue;
    const preview = engine.clone();
    let okRoute = true;
    for (const op of route) { if (!applyMove(preview, op)) { okRoute = false; break; } }
    if (!okRoute) continue;
    const result = preview.hardDrop();
    if (!result.ok || result.spin === "none" || result.linesCleared < expectedLines) continue;
    const cand: AiChoice = {
      ...action,
      aiScore: Number.NEGATIVE_INFINITY,
      aiInfo: {
        source: "spin_finisher",
        spinFinisher: true,
        route,
        expectedSpin: expectedSpin(target.kind),
        target: { x: action.x, y: preview.active.y, rot: normalizeRot(action.rot) },
        routeDiagnostics: routeDiag,
      }
    };
    if (!best || route.length < ((best.aiInfo as any).route?.length ?? 999)) best = cand;
  }
  if (!best) {
    const budgetExceeded = legal.some((action) => {
      const routeDiag: RouteDiagnostics = { searchedNodes: 0, rejectedByCollision: 0, rejectedByFinalOp: 0, targetUnreachable: 0, maxDepthHit: 0 };
      findMoveRoute(engine, action, true, routeDiag);
      return routeDiag.failureReason === "route_budget_exceeded";
    });
    return { choice: null, reason: budgetExceeded ? "route_budget_exceeded" : "route_not_found" };
  }
  return { choice: best };
}

export function runForcedSpinFinisherProbe(): { found: boolean; route: boolean; spin: SpinType; linesCleared: number; reason?: string } {
  const e = new TetrisEngine(7, 11);
  const pattern = ["....X.....","...X.XX...","...XXXXX..","...XXXXX.."];
  for (let i = 0; i < pattern.length; i++) {
    const y = e.board.length - 1 - i;
    for (let x = 0; x < 10; x++) e.board[y][x] = pattern[i][x] === "X" ? "G" : null;
  }
  e.active = { kind: "T", x: 3, y: 0, rot: 0 };
  e.queue = ["I", "O", "L", "J", "S", "Z", "T"];
  e.hold = null;
  e.canHold = true;
  const found = findReadySpinFinisherChoice(e);
  if (!found.choice) return { found: false, route: false, spin: "none", linesCleared: 0, reason: found.reason };
  const route = ((found.choice.aiInfo as Record<string, unknown>).route as AiMoveOp[] | undefined) ?? [];
  for (const op of route) if (!applyMove(e, op)) return { found: true, route: false, spin: "none", linesCleared: 0, reason: "route_failed" };
  const result = e.hardDrop();
  return { found: true, route: true, spin: result.spin, linesCleared: result.linesCleared };
}
