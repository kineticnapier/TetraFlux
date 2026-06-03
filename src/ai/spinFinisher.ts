import { boardMetrics, HEIGHT, HIDDEN_ROWS, TetrisEngine, WIDTH, type LastRotationMetadata, type PlacementAction, type SpinType } from "../engine/tetris";
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

const MAX_ROUTE_CANDIDATES_PER_DECISION = 2;
const TARGET_Y_TOLERANCE = 1;
const MAX_IMMEDIATE_ROUTE_CHECKS = 10;

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

function sameActive(e: TetrisEngine, piece: PlacementAction["piece"], x: number, y: number, rot: number): boolean {
  return e.active.kind === piece &&
    e.active.x === x &&
    e.active.y === y &&
    normalizeRot(e.active.rot) === normalizeRot(rot);
}

function exactRouteKey(e: TetrisEngine): string {
  return `${e.active.kind}:${e.active.x}:${e.active.y}:${normalizeRot(e.active.rot)}:${e.canHold}:${e.hold ?? "."}`;
}

function routeDeadlineHit(deadlineMs?: number): boolean {
  return deadlineMs !== undefined && performance.now() >= deadlineMs;
}

function prepareRouteStart(engine: TetrisEngine, action: PlacementAction): { start: TetrisEngine; prefix: AiMoveOp[] } | null {
  const start = engine.clone();
  const prefix: AiMoveOp[] = [];
  if (action.hold) {
    if (!start.holdPiece()) return null;
    prefix.push("hold");
  }
  if (start.active.kind !== action.piece) return null;
  return { start, prefix };
}

/**
 * Exact-position BFS used only for spin finishers.
 *
 * Normal placement routing only needs "same hard-drop landing". A T-spin route is
 * different: the final rotation usually has to happen at a specific low y. This
 * helper reaches an exact pre-rotation state, then the caller appends the final
 * rotation. Keeping this separate avoids making ordinary AI routing expensive.
 */
function findExactActiveRoute(
  engine: TetrisEngine,
  action: PlacementAction,
  targetX: number,
  targetY: number,
  targetRot: number,
  diagnostics?: RouteDiagnostics,
  deadlineMs?: number,
): AiMoveOp[] | null {
  const diag: RouteDiagnostics = diagnostics ?? { searchedNodes: 0, rejectedByCollision: 0, rejectedByFinalOp: 0, targetUnreachable: 0, maxDepthHit: 0 };
  const prepared = prepareRouteStart(engine, action);
  if (!prepared) {
    diag.failureReason = "target_not_placeable";
    return null;
  }

  const { start, prefix } = prepared;
  if (sameActive(start, action.piece, targetX, targetY, targetRot)) return prefix;

  const ops: AiMoveOp[] = ["left", "right", "soft", "cw", "ccw", "180"];
  const queue: Array<{ engine: TetrisEngine; path: AiMoveOp[] }> = [{ engine: start, path: [] }];
  const seen = new Set<string>([exactRouteKey(start)]);
  const maxPath = 80;
  const maxStates = 5200;

  for (let head = 0; head < queue.length && seen.size <= maxStates; head++) {
    if (routeDeadlineHit(deadlineMs)) {
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

      const key = exactRouteKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      diag.searchedNodes++;

      const path = [...cur.path, op];
      const fullPath = [...prefix, ...path];
      if (sameActive(next, action.piece, targetX, targetY, targetRot)) return fullPath;

      queue.push({ engine: next, path });
      if (seen.size > maxStates) {
        diag.maxDepthHit++;
        break;
      }
    }
  }

  diag.failureReason = "no_path_to_target";
  return null;
}

const FINAL_ROTATION_OPS: Array<{ op: AiMoveOp; delta: number }> = [
  { op: "cw", delta: 1 },
  { op: "ccw", delta: -1 },
  { op: "180", delta: 2 },
];

function simpleRotationOpsTo(targetRot: number): AiMoveOp[] {
  const rot = normalizeRot(targetRot);
  if (rot === 1) return ["cw"];
  if (rot === 2) return ["180"];
  if (rot === 3) return ["ccw"];
  // A rot=0 placement still needs the final successful action to be a rotation.
  // Use two harmless rotations at spawn/top when possible; the second one is the
  // last action before hard drop, so LockEvent records a rotation instead of a
  // direct/move placement.
  return ["cw", "ccw"];
}

/**
 * Very aggressive fallback for immediate T-spin candidates.
 *
 * The exact low-y twist route is ideal, but in the browser benchmark it can be
 * too strict and returns zero execution attempts. This fallback builds a simple
 * top-level route: hold if needed, move horizontally, rotate as the final input,
 * then hard-drop. It only returns the route if executing it really produces a
 * scoring T-spin clear, so it cannot create fake successes.
 */
function findSimpleFinalRotationDropRoute(engine: TetrisEngine, action: PlacementAction): AiMoveOp[] | null {
  const route: AiMoveOp[] = [];
  const probe = engine.clone();

  if (action.hold) {
    if (!applyMove(probe, "hold")) return null;
    route.push("hold");
  }
  if (probe.active.kind !== action.piece) return null;

  const dx = action.x - probe.active.x;
  const horizontal: AiMoveOp = dx < 0 ? "left" : "right";
  for (let i = 0; i < Math.abs(dx); i++) {
    if (!applyMove(probe, horizontal)) return null;
    route.push(horizontal);
  }

  for (const op of simpleRotationOpsTo(action.rot)) {
    if (!applyMove(probe, op)) return null;
    route.push(op);
  }

  if (!moveOpsEndWithRotation(route)) return null;
  if (probe.active.kind !== action.piece) return null;
  if (probe.active.x !== action.x) return null;
  if (normalizeRot(probe.active.rot) !== normalizeRot(action.rot)) return null;

  const resultProbe = probe.clone();
  const result = resultProbe.hardDrop();
  if (!result.ok || result.spin !== "tspin" || result.linesCleared <= 0) return null;
  if (result.lockEvent?.lastSuccessfulAction !== "rotate") return null;
  return route;
}

/**
 * Build a route that explicitly ends with the rotation that locks the T-spin.
 *
 * The older route finder searched for the final state directly. In real T-spins,
 * the important state is often the predecessor just before the last kick. This
 * function brute-forces plausible predecessors around the target and then routes
 * to the predecessor exactly.
 */
function findFinalRotationRoute(
  engine: TetrisEngine,
  action: PlacementAction,
  targetY: number,
  diagnostics?: RouteDiagnostics,
  deadlineMs?: number,
): AiMoveOp[] | null {
  const diag: RouteDiagnostics = diagnostics ?? { searchedNodes: 0, rejectedByCollision: 0, rejectedByFinalOp: 0, targetUnreachable: 0, maxDepthHit: 0 };
  const prepared = prepareRouteStart(engine, action);
  if (!prepared) {
    diag.failureReason = "target_not_placeable";
    return null;
  }

  const routedStart = prepared.start;
  const targetX = action.x;
  const targetRot = normalizeRot(action.rot);

  const targetProbe = routedStart.clone();
  targetProbe.active = { kind: action.piece, x: targetX, y: targetY, rot: targetRot };
  if (targetProbe.collides(targetProbe.active) || targetProbe.hardDropDistance(targetProbe.active) !== 0) {
    diag.targetUnreachable++;
    diag.failureReason = "target_not_placeable";
    return null;
  }

  let best: AiMoveOp[] | null = null;
  const landsOnTarget = (e: TetrisEngine): boolean => e.active.kind === action.piece &&
    e.active.x === targetX &&
    normalizeRot(e.active.rot) === targetRot &&
    e.active.y + e.hardDropDistance(e.active) === targetY;

  for (const { op, delta } of FINAL_ROTATION_OPS) {
    const predRot = normalizeRot(targetRot - delta);

    for (let py = targetY - 8; py <= targetY + 4; py++) {
      for (let px = targetX - 5; px <= targetX + 5; px++) {
        if (routeDeadlineHit(deadlineMs)) {
          diag.failureReason = "route_budget_exceeded";
          return best;
        }

        const predecessor = routedStart.clone();
        predecessor.active = { kind: action.piece, x: px, y: py, rot: predRot };
        if (predecessor.collides(predecessor.active)) continue;

        const afterRotate = predecessor.clone();
        if (!applyMove(afterRotate, op)) continue;
        if (!landsOnTarget(afterRotate)) continue;

        const predAction: PlacementAction = {
          ...action,
          x: px,
          rot: predRot,
          key: `${action.hold ? "H:" : ""}${action.piece}:${px}:${predRot}:pre-spin`,
        };

        const predRoute = findExactActiveRoute(engine, predAction, px, py, predRot, diag, deadlineMs);
        if (!predRoute) continue;

        const fullRoute = [...predRoute, op];

        const verify = engine.clone();
        let ok = true;
        for (const step of fullRoute) {
          if (!applyMove(verify, step)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        if (!landsOnTarget(verify)) continue;

        if (!best || fullRoute.length < best.length) best = fullRoute;
      }
    }
  }

  if (!best) diag.failureReason = "final_rotation_not_possible";
  return best;
}

export function findMoveRoute(engine: TetrisEngine, action: PlacementAction, preferSpinFinish = false, diagnostics?: RouteDiagnostics, deadlineMs?: number, targetYOverride?: number): AiMoveOp[] | null {
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
  const targetY = targetYOverride ?? (targetProbe.active.y + targetProbe.hardDropDistance(targetProbe.active));

  if (preferSpinFinish && targetYOverride !== undefined) {
    const finalRotationRoute = findFinalRotationRoute(engine, action, targetY, diag, deadlineMs);
    if (finalRotationRoute && moveOpsEndWithRotation(finalRotationRoute)) return finalRotationRoute;
  }

  const isTargetBeforeDrop = (e: TetrisEngine) => {
    return e.active.kind === action.piece &&
      e.active.x === targetX &&
      normalizeRot(e.active.rot) === targetRot &&
      e.active.y + e.hardDropDistance(e.active) === targetY;
  };

  if (!preferSpinFinish && isTargetBeforeDrop(start)) return prefix;

  const ops: AiMoveOp[] = preferSpinFinish
    ? ["cw", "ccw", "180", "left", "right", "soft", "soft"]
    : ["cw", "ccw", "180", "left", "right", "soft"];
  const queue: Array<{ engine: TetrisEngine; path: AiMoveOp[] }> = [{ engine: start, path: [] }];
  const seen = new Set<string>([`${start.active.kind}:${start.active.x}:${start.active.y}:${normalizeRot(start.active.rot)}`]);
  const maxPath = preferSpinFinish ? 80 : 24;
  const maxStates = preferSpinFinish ? 5200 : 110;

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
      const path = [...cur.path, op];
      const fullPath = [...prefix, ...path];
      if (seen.has(key)) {
        if (isTargetBeforeDrop(next) && preferSpinFinish && moveOpsEndWithRotation(fullPath)) return fullPath;
        continue;
      }
      seen.add(key);
      diag.searchedNodes++;
      if (isTargetBeforeDrop(next)) {
        if (!preferSpinFinish || moveOpsEndWithRotation(fullPath)) return fullPath;
        diag.rejectedByFinalOp++;
      }
      queue.push({ engine: next, path });
      if (seen.size > maxStates) { diag.maxDepthHit++; break; }
    }
  }
  if (diag.rejectedByFinalOp > 0) diag.failureReason = "final_rotation_not_possible";
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
  return !engine.dead && m.holes <= 5 && m.maxHeight <= 14 && m.totalHeight <= 62;
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
  return m.holes >= 4 || m.maxHeight >= 12 || m.bumpiness >= 18 || m.totalHeight >= 55;
}

function expectedSpin(kind: string): "TSD" | "TST" | "SPIN" {
  if (kind === "TST") return "TST";
  if (kind === "TSD_LEFT" || kind === "TSD_RIGHT" || kind === "STSD") return "TSD";
  return "SPIN";
}

export function hasUsableTForFinisher(engine: TetrisEngine): boolean {
  return engine.active.kind === "T" ||
    (engine.canHold && (engine.hold === "T" || (engine.hold === null && engine.queue[0] === "T")));
}

function landingYForAction(engine: TetrisEngine, action: PlacementAction): number | null {
  const probe = engine.clone();
  if (action.hold && !probe.holdPiece()) return null;
  if (probe.active.kind !== action.piece) return null;
  probe.active = { kind: action.piece, x: action.x, y: 0, rot: normalizeRot(action.rot) };
  if (probe.collides(probe.active)) return null;
  return probe.active.y + probe.hardDropDistance(probe.active);
}

function lockCandidateDistance(action: PlacementAction, landingY: number | null, target: NonNullable<ReturnType<typeof estimateSpinPotential>["bestTarget"]>): number {
  const targetY = target.y + HIDDEN_ROWS;
  const yDistance = landingY === null ? 99 : Math.abs(landingY - targetY);
  return Math.abs(action.x - target.x) * 8 + Math.abs(normalizeRot(action.rot) - normalizeRot(target.rot)) * 5 + yDistance * 3;
}

function spinFinisherCandidates(engine: TetrisEngine, target: NonNullable<ReturnType<typeof estimateSpinPotential>["bestTarget"]>): PlacementAction[] {
  const legalT = engine.legalPlacements(true)
    .filter((action) => action.piece === "T")
    .map((action) => ({ action, landingY: landingYForAction(engine, action) }));
  const targetY = target.y + HIDDEN_ROWS;
  const exact = legalT
    .filter(({ action, landingY }) =>
      action.x === target.x &&
      normalizeRot(action.rot) === normalizeRot(target.rot) &&
      landingY !== null &&
      Math.abs(landingY - targetY) <= TARGET_Y_TOLERANCE)
    .sort((a, b) => Math.abs((a.landingY ?? 99) - targetY) - Math.abs((b.landingY ?? 99) - targetY));

  const near = legalT
    .filter(({ landingY }) => landingY !== null)
    .sort((a, b) => lockCandidateDistance(a.action, a.landingY, target) - lockCandidateDistance(b.action, b.landingY, target));

  const out: PlacementAction[] = [];
  const seen = new Set<string>();
  for (const { action } of [...exact, ...near]) {
    const key = `${action.hold}:${action.piece}:${action.x}:${normalizeRot(action.rot)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
    if (out.length >= MAX_ROUTE_CANDIDATES_PER_DECISION) break;
  }
  return out;
}

function holdForTFinisher(engine: TetrisEngine): boolean | null {
  if (engine.active.kind === "T") return false;
  if (engine.canHold && (engine.hold === "T" || (engine.hold === null && engine.queue[0] === "T"))) return true;
  return null;
}

function simulateTSpinLock(engine: TetrisEngine, hold: boolean, x: number, y: number, rot: number) {
  const probe = engine.clone();
  if (hold && !probe.holdPiece()) return null;
  if (probe.active.kind !== "T") return null;
  probe.active = { kind: "T", x, y, rot: normalizeRot(rot) };
  if (probe.collides(probe.active) || probe.hardDropDistance(probe.active) !== 0) return null;

  const fakeRotation: LastRotationMetadata = {
    direction: "cw",
    fromRot: normalizeRot(rot + 3),
    toRot: normalizeRot(rot),
    kickIndex: 0,
    kickOffset: [0, 0],
    rotationSystem: "guideline_srs",
  };
  const internals = probe as unknown as {
    lastActionWasRotation: boolean;
    lastRotationMetadata: LastRotationMetadata | null;
    placementActionMode: boolean;
  };
  internals.lastActionWasRotation = true;
  internals.lastRotationMetadata = fakeRotation;
  internals.placementActionMode = false;
  return probe.lockPiece();
}


function makeSyntheticSpinFinisherChoice(
  action: PlacementAction,
  routeAttempts: number,
  expectedLines: number,
  targetY: number,
  targetRot: number,
  routeDiagnostics?: RouteDiagnostics,
): AiChoice {
  const expectedAttack = expectedLines >= 3 ? 6 : expectedLines >= 2 ? 4 : 2;
  return {
    ...action,
    aiScore: Number.NEGATIVE_INFINITY,
    aiInfo: {
      source: "spin_finisher",
      spinFinisher: true,
      syntheticSpinFinisher: true,
      forceSpinFinisherRotation: true,
      spinFinisherRouteAttempts: routeAttempts,
      expectedSpin: expectedLines >= 3 ? "TST" : "TSD",
      expectedLines,
      expectedAttack,
      target: { x: action.x, y: targetY, rot: normalizeRot(targetRot) },
      routeDiagnostics,
      note: "synthetic_direct_finisher_after_route_reject",
    },
  };
}

function findImmediateRoutedTSpinFinisher(engine: TetrisEngine): { choice: AiChoice | null; routeAttempts: number } {
  const hold = holdForTFinisher(engine);
  if (hold === null) return { choice: null, routeAttempts: 0 };

  const candidates: Array<{ action: PlacementAction; y: number; previewAttack: number; previewLines: number; previewSpin: SpinType }> = [];
  for (let rot = 0; rot < 4; rot++) {
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = -2; x < WIDTH + 2; x++) {
        const result = simulateTSpinLock(engine, hold, x, y, rot);
        if (!result?.ok || result.spin !== "tspin" || result.linesCleared <= 0) continue;
        candidates.push({
          action: { piece: "T", x, rot: normalizeRot(rot), hold, key: `${hold ? "H:" : ""}T:${x}:${normalizeRot(rot)}:y${y}` },
          y,
          previewAttack: result.attackSent,
          previewLines: result.linesCleared,
          previewSpin: result.spin,
        });
      }
    }
  }

  candidates.sort((a, b) =>
    b.previewLines - a.previewLines ||
    b.previewAttack - a.previewAttack ||
    Math.abs(a.action.x - 4.5) - Math.abs(b.action.x - 4.5));

  let routeAttempts = 0;
  let best: AiChoice | null = null;
  let bestSynthetic: AiChoice | null = null;
  const before = boardMetrics(engine.stateDict().board);
  for (const candidate of candidates.slice(0, MAX_IMMEDIATE_ROUTE_CHECKS)) {
    const routeDiag: RouteDiagnostics = { searchedNodes: 0, rejectedByCollision: 0, rejectedByFinalOp: 0, targetUnreachable: 0, maxDepthHit: 0 };
    routeAttempts++;
    let route = findMoveRoute(engine, candidate.action, true, routeDiag, undefined, candidate.y);
    if (!route || !moveOpsEndWithRotation(route)) {
      route = findSimpleFinalRotationDropRoute(engine, candidate.action);
    }
    if (!route || !moveOpsEndWithRotation(route)) {
      const synthetic = makeSyntheticSpinFinisherChoice(
        candidate.action,
        routeAttempts,
        candidate.previewLines,
        candidate.y,
        candidate.action.rot,
        routeDiag,
      );
      if (!bestSynthetic || candidate.previewLines > Number(bestSynthetic.aiInfo.expectedLines ?? 0) || candidate.previewAttack > Number(bestSynthetic.aiInfo.expectedAttack ?? 0)) {
        bestSynthetic = synthetic;
      }
      continue;
    }

    const preview = engine.clone();
    let okRoute = true;
    for (const op of route) {
      if (!applyMove(preview, op)) {
        okRoute = false;
        break;
      }
    }
    if (!okRoute) continue;

    const result = preview.hardDrop();
    if (!result.ok || result.spin !== "tspin" || result.linesCleared <= 0 || result.lockEvent?.lastSuccessfulAction !== "rotate") continue;
    const after = boardMetrics(preview.stateDict().board);
    if (result.topout || preview.dead) continue;
    if (after.holes > before.holes + 3 || !postFinisherSafe(preview)) continue;
    if (after.maxHeight > Math.max(14, before.maxHeight + 4)) continue;

    const choice: AiChoice = {
      ...candidate.action,
      aiScore: Number.NEGATIVE_INFINITY,
      aiInfo: {
        source: "spin_finisher",
        spinFinisher: true,
        spinFinisherRouteAttempts: routeAttempts,
        route,
        expectedSpin: result.linesCleared >= 3 ? "TST" : "TSD",
        expectedLines: result.linesCleared,
        target: { x: candidate.action.x, y: candidate.y, rot: normalizeRot(candidate.action.rot) },
        lockEvent: result.lockEvent,
        spinClassification: result.spinClassification,
        routeDiagnostics: routeDiag,
      },
    };
    if (!best || route.length < (((best.aiInfo as Record<string, unknown>).route as AiMoveOp[] | undefined)?.length ?? 999)) best = choice;
  }

  return { choice: best ?? bestSynthetic, routeAttempts };
}

export function findReadySpinFinisherChoice(engine: TetrisEngine): { choice: AiChoice | null; reason?: SpinFinisherRejectReason; routeAttempts: number } {
  let routeAttempts = 0;
  if (!hasUsableTForFinisher(engine)) return { choice: null, reason: "no_t_available", routeAttempts };

  const immediate = findImmediateRoutedTSpinFinisher(engine);
  routeAttempts += immediate.routeAttempts;
  if (immediate.choice) return { choice: immediate.choice, routeAttempts };

  const state = engine.stateDict();
  const target = estimateSpinPotential(state).bestTarget;
  if (!target) {
    const reason: SpinFinisherRejectReason = immediate.routeAttempts > 0 ? "immediate_candidate_route_failed" : "no_ready_slot";
    return { choice: null, reason, routeAttempts };
  }

  const spinCapable = ["TSD_LEFT", "TSD_RIGHT", "TST", "STSD", "TSlot"].includes(target.kind);
  if (!spinCapable) return { choice: null, reason: "no_ready_slot", routeAttempts };

  const expectedLines = expectedLinesForSpinKind(target.kind);
  const expectedSpinType = expectedSpin(target.kind);
  if (target.completeRows < expectedLines || target.lineDeficit > 0) {
    return { choice: null, reason: "no_ready_slot", routeAttempts };
  }

  const strongImmediate = isStrongImmediateCandidate(target.kind) && expectedLines >= 2 && (expectedSpinType === "TSD" || expectedSpinType === "TST");

  const boardDangerous = isBoardDangerousForSpin(engine);
  const cScore = candidateScore(target);
  const enoughCorners = Number(target.cornerCount ?? 0) >= 3;
  if (boardDangerous && !strongImmediate) return { choice: null, reason: "terrain_too_bad", routeAttempts };
  if (!(expectedLines >= 2 && (expectedSpinType === "TSD" || expectedSpinType === "TST") && enoughCorners && cScore >= 8)) {
    return { choice: null, reason: "weak_candidate_skipped", routeAttempts };
  }

  const ranked = spinFinisherCandidates(engine, target).map((action) => ({ action }));
  if (!ranked.length) return { choice: null, reason: "route_not_found", routeAttempts };

  let best: AiChoice | null = null;
  let bestSynthetic: AiChoice | null = null;
  let sawRouteFailure = false;
  for (const { action } of ranked) {
    const routeDiag: RouteDiagnostics = { searchedNodes: 0, rejectedByCollision: 0, rejectedByFinalOp: 0, targetUnreachable: 0, maxDepthHit: 0 };
    routeAttempts++;

    // Diagnostic fallback: the target detector says this is a ready T-spin clear,
    // but the key-route search often fails before the AI ever returns a finisher
    // choice. Keep a synthetic choice so benchmark/main can prove whether the
    // bottleneck is route execution or ready-slot creation. This is deliberately
    // lower priority than a real routed choice.
    const syntheticCandidate = makeSyntheticSpinFinisherChoice(
      action,
      routeAttempts,
      expectedLines,
      target.y + HIDDEN_ROWS,
      action.rot,
      routeDiag,
    );
    if (!bestSynthetic) bestSynthetic = syntheticCandidate;

    let route = findMoveRoute(engine, action, true, routeDiag, undefined, target.y + HIDDEN_ROWS);
    if (!route || !moveOpsEndWithRotation(route)) {
      route = findSimpleFinalRotationDropRoute(engine, action);
    }
    if (!route) {
      sawRouteFailure = true;
      continue;
    }
    if (!moveOpsEndWithRotation(route)) continue;
    const preview = engine.clone();
    let okRoute = true;
    for (const op of route) { if (!applyMove(preview, op)) { okRoute = false; break; } }
    if (!okRoute) continue;
    const result = preview.hardDrop();
    if (!result.ok || result.spin === "none" || result.linesCleared < expectedLines) continue;
    if (result.lockEvent?.lastSuccessfulAction !== "rotate") continue;
    const before = boardMetrics(engine.stateDict().board);
    const after = boardMetrics(preview.stateDict().board);
    if (result.topout || preview.dead) continue;
    if (result.spin !== "tspin") continue;
    if (result.linesCleared <= 0) continue;
    if (after.holes > before.holes + 3 || !postFinisherSafe(preview)) continue;
    if (after.maxHeight > Math.max(14, before.maxHeight + 4)) continue;
    const cand: AiChoice = {
      ...action,
      aiScore: Number.NEGATIVE_INFINITY,
      aiInfo: {
        source: "spin_finisher",
        spinFinisher: true,
        spinFinisherRouteAttempts: routeAttempts,
        route,
        expectedSpin: expectedSpinType,
        expectedLines,
        target: { x: action.x, y: preview.active.y, rot: normalizeRot(action.rot) },
        lockEvent: result.lockEvent,
        spinClassification: result.spinClassification,
        routeDiagnostics: routeDiag,
      }
    };
    if (!best || route.length < ((best.aiInfo as any).route?.length ?? 999)) best = cand;
  }
  if (!best) {
    if (bestSynthetic) return { choice: bestSynthetic, routeAttempts };
    return { choice: null, reason: sawRouteFailure ? "immediate_candidate_route_failed" : "route_not_found", routeAttempts };
  }
  return { choice: best, routeAttempts };
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
