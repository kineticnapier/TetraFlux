import { boardMetrics, TetrisEngine, type PlacementAction, type SpinType } from "../engine/tetris";
import { estimateSpinPotential } from "./spinPotential";
import type { AiChoice } from "./heuristic";

export type AiMoveOp = "hold" | "left" | "right" | "cw" | "ccw" | "180" | "soft";
export type SpinFinisherRejectReason = "no_ready_slot" | "no_t_available" | "route_not_found" | "route_budget_exceeded" | "terrain_too_bad" | "weak_candidate_skipped" | "immediate_candidate_route_failed";
export type RouteFailureReason = "no_path_to_target" | "final_rotation_not_possible" | "target_not_placeable" | "route_budget_exceeded";
export type RouteDiagnostics = {
  searchedNodes: number;
  rejectedByCollision: number;
  rejectedByFinalOp: number;
  targetUnreachable: number;
  maxDepthHit: number;
  failureReason?: RouteFailureReason;
};

const ROUTE_BUDGET_NORMAL_MS = 4;
const ROUTE_BUDGET_STRONG_MS = 8;
const ROUTE_BUDGET_HARD_CAP_MS = 12;
const MAX_ROUTE_CANDIDATES_PER_DECISION = 3;

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

export function findMoveRoute(engine: TetrisEngine, action: PlacementAction, preferSpinFinish = false, diagnostics?: RouteDiagnostics, deadlineMs?: number): AiMoveOp[] | null {
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
  const targetY = targetProbe.active.y + targetProbe.hardDropDistance(targetProbe.active);

  const isTargetBeforeDrop = (e: TetrisEngine) => {
    const droppedY = e.active.y + e.hardDropDistance(e.active);
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
  const maxPath = preferSpinFinish ? 34 : 24;
  const maxStates = preferSpinFinish ? 260 : 110;
  let budgetExceeded = false;

  for (let head = 0; head < queue.length && seen.size <= maxStates; head++) {
    if (deadlineMs !== undefined && performance.now() >= deadlineMs) {
      diag.failureReason = "route_budget_exceeded";
      return null;
    }
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

function isStrongImmediateCandidate(kind: string): boolean {
  return kind === "TST" || kind === "TSD_LEFT" || kind === "TSD_RIGHT" || kind === "STSD";
}

function postFinisherSafe(engine: TetrisEngine): boolean {
  const m = boardMetrics(engine.stateDict().board);
  return !engine.dead && m.holes <= 2 && m.maxHeight <= 10;
}

function candidateScore(target: ReturnType<typeof estimateSpinPotential>["bestTarget"]): number {
  if (!target) return Number.NEGATIVE_INFINITY;
  const base = Number(target.score ?? 0);
  const corners = Number(target.cornerCount ?? 0);
  const kindBoost = target.kind === "TST" ? 10 : (target.kind === "TSD_LEFT" || target.kind === "TSD_RIGHT" || target.kind === "STSD" ? 7 : 0);
  return base + corners * 2 + kindBoost;
}

function isBoardDangerousForSpin(engine: TetrisEngine): boolean {
  const m = boardMetrics(engine.stateDict().board);
  return m.holes >= 2 || m.maxHeight >= 9 || m.bumpiness >= 13 || m.totalHeight >= 36;
}

function expectedSpin(kind: string): "TSD" | "TST" | "SPIN" {
  if (kind === "TST") return "TST";
  if (kind === "TSD_LEFT" || kind === "TSD_RIGHT" || kind === "STSD") return "TSD";
  return "SPIN";
}

export function findReadySpinFinisherChoice(engine: TetrisEngine): { choice: AiChoice | null; reason?: SpinFinisherRejectReason } {
  const tNow = engine.active.kind === "T" || (engine.canHold && (engine.hold === "T" || (engine.hold === null && engine.queue[0] === "T")));
  if (!tNow) return { choice: null, reason: "no_t_available" };

  const state = engine.stateDict();
  const target = estimateSpinPotential(state).bestTarget;
  if (!target) return { choice: null, reason: "no_ready_slot" };

  const spinCapable = ["TSD_LEFT", "TSD_RIGHT", "TST", "STSD", "TSlot"].includes(target.kind);
  if (!spinCapable) return { choice: null, reason: "no_ready_slot" };

  const expectedLines = expectedLinesForSpinKind(target.kind);
  const expectedSpinType = expectedSpin(target.kind);
  const strongImmediate = isStrongImmediateCandidate(target.kind) && expectedLines >= 2 && (expectedSpinType === "TSD" || expectedSpinType === "TST");

  const boardDangerous = isBoardDangerousForSpin(engine);
  const cScore = candidateScore(target);
  const enoughCorners = Number(target.cornerCount ?? 0) >= 3;
  if (boardDangerous && !strongImmediate) return { choice: null, reason: "terrain_too_bad" };
  if (!(expectedLines >= 2 && (expectedSpinType === "TSD" || expectedSpinType === "TST") && enoughCorners && cScore >= 8)) {
    return { choice: null, reason: "weak_candidate_skipped" };
  }

  const legal = engine.legalPlacements(true).filter((a) => a.piece === "T");
  const ranked = legal.map((action) => {
    const probe = engine.clone();
    const lock = probe.applyAction(action);
    if (!lock.ok) return { action, ev: Number.NEGATIVE_INFINITY };
    const ev = (lock.spin === "tspin" ? 18 : 0) + lock.linesCleared * 6 + lock.attackSent * 2;
    return { action, ev };
  }).sort((a, b) => b.ev - a.ev).slice(0, MAX_ROUTE_CANDIDATES_PER_DECISION);
  let best: AiChoice | null = null;
  let sawBudgetExceeded = false;
  let sawRouteFailure = false;
  const routeBudgetMs = strongImmediate ? ROUTE_BUDGET_STRONG_MS : ROUTE_BUDGET_NORMAL_MS;
  const decisionStartMs = performance.now();
  const softDeadlineMs = decisionStartMs + routeBudgetMs;
  const hardDeadlineMs = decisionStartMs + ROUTE_BUDGET_HARD_CAP_MS;
  for (const { action } of ranked) {
    const now = performance.now();
    if (now >= softDeadlineMs || now >= hardDeadlineMs) {
      sawBudgetExceeded = true;
      break;
    }
    const routeDiag: RouteDiagnostics = { searchedNodes: 0, rejectedByCollision: 0, rejectedByFinalOp: 0, targetUnreachable: 0, maxDepthHit: 0 };
    const route = findMoveRoute(engine, action, true, routeDiag, Math.min(softDeadlineMs, hardDeadlineMs));
    if (!route) {
      if (routeDiag.failureReason === "route_budget_exceeded") sawBudgetExceeded = true;
      else sawRouteFailure = true;
      continue;
    }
    if (!moveOpsEndWithRotation(route)) continue;
    const preview = engine.clone();
    let okRoute = true;
    for (const op of route) { if (!applyMove(preview, op)) { okRoute = false; break; } }
    if (!okRoute) continue;
    const result = preview.hardDrop();
    if (!result.ok || result.spin === "none" || result.linesCleared < expectedLines) continue;
    const before = boardMetrics(engine.stateDict().board);
    const after = boardMetrics(preview.stateDict().board);
    if (result.topout || preview.dead) continue;
    if (result.spin !== "tspin") continue;
    if (result.linesCleared < 2) continue;
    if (after.holes > before.holes + 1 || !postFinisherSafe(preview)) continue;
    if (after.maxHeight > Math.max(10, before.maxHeight + 1)) continue;
    const cand: AiChoice = {
      ...action,
      aiScore: Number.NEGATIVE_INFINITY,
      aiInfo: {
        source: "spin_finisher",
        spinFinisher: true,
        route,
        expectedSpin: expectedSpinType,
        target: { x: action.x, y: preview.active.y, rot: normalizeRot(action.rot) },
        routeDiagnostics: routeDiag,
      }
    };
    if (!best || route.length < ((best.aiInfo as any).route?.length ?? 999)) best = cand;
  }
  if (!best) {
    if (sawBudgetExceeded) return { choice: null, reason: "route_budget_exceeded" };
    if (sawRouteFailure) return { choice: null, reason: "immediate_candidate_route_failed" };
    return { choice: null, reason: "route_not_found" };
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
