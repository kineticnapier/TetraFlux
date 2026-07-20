import { boardMetrics, TetrisEngine, type LockResult, type PlacementAction, type PieceKind } from "../engine/tetris";
import { promoteMechanicalAllSpin } from "./allSpinRules";
import type { AiChoice } from "./heuristic";
import { applyMove, moveOpsEndWithRotation, type AiMoveOp } from "./spinFinisher";

export interface TwistMoveGeneratorOptions {
  includeHold?: boolean;
  maxStates?: number;
  maxPathLength?: number;
  maxChoices?: number;
  deadlineMs?: number;
  includeNonClearingMechanical?: boolean;
  allowUnsafe?: boolean;
  allSpinScoring?: boolean;
}

export interface RoutedChoiceExecution {
  result: LockResult;
  routeUsed: boolean;
  routeFailed: boolean;
  routeFailureReason?: string;
}

type SearchNode = {
  engine: TetrisEngine;
  path: AiMoveOp[];
  lastTransitionKey: string;
};

type Candidate = {
  choice: AiChoice;
  result: LockResult;
  score: number;
  routeLength: number;
  targetY: number;
};

const DEFAULT_OPTIONS: Required<Omit<TwistMoveGeneratorOptions, "deadlineMs">> = {
  includeHold: true,
  maxStates: 1400,
  maxPathLength: 34,
  maxChoices: 14,
  includeNonClearingMechanical: false,
  allowUnsafe: false,
  allSpinScoring: false,
};

const SEARCH_OPS: AiMoveOp[] = ["left", "right", "soft", "cw", "ccw", "180"];

function normalizeRot(rot: number): number {
  return ((rot % 4) + 4) % 4;
}

function routeDeadlineHit(deadlineMs?: number): boolean {
  return deadlineMs !== undefined && performance.now() >= deadlineMs;
}

function transitionKey(before: TetrisEngine["active"], after: TetrisEngine["active"], op: AiMoveOp): string {
  if (op !== "cw" && op !== "ccw" && op !== "180") return "move";
  return `rotate:${op}:${normalizeRot(before.rot)}>${normalizeRot(after.rot)}:${after.x - before.x},${after.y - before.y}`;
}

function routeKey(engine: TetrisEngine, lastTransitionKey: string): string {
  const a = engine.active;
  // The same geometric state can score differently depending on whether the last
  // successful action was a rotation and which kick offset reached it. Preserve
  // that information so BFS does not discard valid all-spin routes.
  return `${a.kind}:${a.x}:${a.y}:${normalizeRot(a.rot)}:${engine.canHold}:${engine.hold ?? "."}:${lastTransitionKey}`;
}

function choiceKey(choice: PlacementAction, targetY: number, route: AiMoveOp[]): string {
  // y and route suffix matter for twists; x/rot alone is not enough.
  const suffix = route.slice(-4).join(",");
  return `${choice.hold}:${choice.piece}:${choice.x}:${targetY}:${normalizeRot(choice.rot)}:${suffix}`;
}

function cloneAndRunRoute(engine: TetrisEngine, route: AiMoveOp[], allSpinScoring: boolean): RoutedChoiceExecution {
  const b2bBefore = engine.b2b;
  for (const op of route) {
    if (!applyMove(engine, op)) {
      const fallback = engine.applyAction({ piece: engine.active.kind, x: engine.active.x, rot: normalizeRot(engine.active.rot), hold: false, key: "route_failed_fallback" });
      return {
        result: promoteMechanicalAllSpin(engine, fallback, b2bBefore, allSpinScoring),
        routeUsed: false,
        routeFailed: true,
        routeFailureReason: `route_op_failed:${op}`,
      };
    }
  }

  const result = engine.hardDrop();
  return {
    result: promoteMechanicalAllSpin(engine, result, b2bBefore, allSpinScoring),
    routeUsed: true,
    routeFailed: false,
  };
}

export function executeChoiceWithOptionalRoute(engine: TetrisEngine, action: PlacementAction): RoutedChoiceExecution {
  const info = ((action as AiChoice).aiInfo ?? {}) as Record<string, unknown>;
  const route = Array.isArray(info.route) ? info.route as AiMoveOp[] : null;
  const allSpinScoring = info.strictAllSpin === true || info.allSpinScoring === true;
  if (!route || route.length === 0) {
    const b2bBefore = engine.b2b;
    const result = engine.applyAction(action);
    return {
      result: promoteMechanicalAllSpin(engine, result, b2bBefore, allSpinScoring),
      routeUsed: false,
      routeFailed: false,
    };
  }
  return cloneAndRunRoute(engine, route, allSpinScoring);
}

function resultIsInterestingTwist(result: LockResult, includeNonClearingMechanical: boolean): boolean {
  if (!result.ok || result.topout) return false;
  if (result.lockEvent?.lastSuccessfulAction !== "rotate") return false;

  const scoringSpin = result.spin !== "none" && result.linesCleared > 0;
  if (scoringSpin) return true;

  const mechanical = result.spinClassification?.mechanical === "immobile";
  if (!mechanical) return false;

  // All-mino twists are useful, but no-clear mechanical twists can explode the
  // candidate set. Keep them opt-in until the evaluator has stronger route-value
  // training.
  if (result.linesCleared > 0) return true;
  return includeNonClearingMechanical;
}

function resultSafeEnough(before: TetrisEngine, after: TetrisEngine, result: LockResult, allowUnsafe: boolean): boolean {
  if (allowUnsafe) return true;
  if (!result.ok || result.topout || after.dead) return false;

  const beforeMetrics = boardMetrics(before.stateDict().board);
  const afterMetrics = boardMetrics(after.stateDict().board);

  if (afterMetrics.holes > beforeMetrics.holes + 2) return false;
  if (afterMetrics.maxHeight > Math.max(14, beforeMetrics.maxHeight + 4)) return false;
  if (afterMetrics.totalHeight > Math.max(58, beforeMetrics.totalHeight + 18)) return false;
  return true;
}

function twistKind(result: LockResult): string {
  if (result.spin === "tspin" && result.linesCleared === 3) return "TST";
  if (result.spin === "tspin" && result.linesCleared === 2) return "TSD";
  if (result.spin === "tspin" && result.linesCleared === 1) return "TSS";
  if (result.spin === "tspin-mini") return "T-spin mini";
  if (result.spin !== "none") return result.spin;
  if (result.spinClassification?.mechanical === "immobile") return "mechanical twist";
  return "route twist";
}

function scoreTwistCandidate(before: TetrisEngine, after: TetrisEngine, result: LockResult, routeLength: number): number {
  const beforeMetrics = boardMetrics(before.stateDict().board);
  const afterMetrics = boardMetrics(after.stateDict().board);
  const holeDelta = afterMetrics.holes - beforeMetrics.holes;
  const heightDelta = afterMetrics.maxHeight - beforeMetrics.maxHeight;

  const spinBonus = result.spin === "tspin" ? 32 : result.spin === "tspin-mini" ? 16 : result.spin !== "none" ? 18 : 0;
  const mechanicalBonus = result.spinClassification?.mechanical === "immobile" ? 7 : 0;
  const attackBonus = result.attackSent * 10;
  const clearBonus = result.linesCleared * 4;
  const safetyPenalty = Math.max(0, holeDelta) * 18 + Math.max(0, heightDelta - 1) * 7 + afterMetrics.bumpiness * 0.18 + routeLength * 0.08;

  return spinBonus + mechanicalBonus + attackBonus + clearBonus - safetyPenalty;
}

function choiceFromNode(root: TetrisEngine, node: SearchNode, afterEngine: TetrisEngine, result: LockResult): Candidate | null {
  const route = node.path;
  if (!moveOpsEndWithRotation(route)) return null;
  if (!result.piece || result.x === undefined || result.y === undefined || result.rot === undefined) return null;

  const targetY = result.y;
  const action: PlacementAction = {
    piece: result.piece,
    x: result.x,
    rot: normalizeRot(result.rot),
    hold: route[0] === "hold",
    key: `${route[0] === "hold" ? "H:" : ""}${result.piece}:${result.x}:${normalizeRot(result.rot)}:twist:y${targetY}`,
  };

  const score = scoreTwistCandidate(root, afterEngine, result, route.length);
  const choice: AiChoice = {
    ...action,
    aiScore: -score,
    aiInfo: {
      source: "twist_route",
      twistRoute: true,
      route,
      target: { x: result.x, y: targetY, rot: normalizeRot(result.rot) },
      twistKind: twistKind(result),
      expectedSpin: result.spin,
      expectedLines: result.linesCleared,
      expectedAttack: result.attackSent,
      lockEvent: result.lockEvent,
      spinClassification: result.spinClassification,
      routeLength: route.length,
      physicalRoute: true,
    },
  };

  return { choice, result, score, routeLength: route.length, targetY };
}

function seedRoots(engine: TetrisEngine, includeHold: boolean): SearchNode[] {
  const roots: SearchNode[] = [{ engine: engine.clone(), path: [], lastTransitionKey: "spawn" }];
  if (includeHold && engine.canHold) {
    const held = engine.clone();
    if (held.holdPiece() && !held.dead) roots.push({ engine: held, path: ["hold"], lastTransitionKey: "hold" });
  }
  return roots;
}

export function generateTwistChoices(engine: TetrisEngine, options: TwistMoveGeneratorOptions = {}): AiChoice[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const out: Candidate[] = [];
  const seenCandidates = new Set<string>();

  const queue: SearchNode[] = [];
  const seenStates = new Set<string>();
  for (const root of seedRoots(engine, opts.includeHold)) {
    const key = routeKey(root.engine, root.lastTransitionKey);
    if (seenStates.has(key)) continue;
    seenStates.add(key);
    queue.push(root);
  }

  for (let head = 0; head < queue.length && seenStates.size <= opts.maxStates; head++) {
    if (routeDeadlineHit(options.deadlineMs)) break;
    const node = queue[head];

    if (node.path.length > 0 && moveOpsEndWithRotation(node.path)) {
      const preview = node.engine.clone();
      const b2bBefore = preview.b2b;
      const rawResult = preview.hardDrop();
      const result = promoteMechanicalAllSpin(preview, rawResult, b2bBefore, opts.allSpinScoring);
      if (resultIsInterestingTwist(result, opts.includeNonClearingMechanical) && resultSafeEnough(engine, preview, result, opts.allowUnsafe)) {
        const candidate = choiceFromNode(engine, node, preview, result);
        if (candidate) {
          const key = choiceKey(candidate.choice, candidate.targetY, node.path);
          if (!seenCandidates.has(key)) {
            seenCandidates.add(key);
            out.push(candidate);
          }
        }
      }
    }

    if (node.path.length >= opts.maxPathLength) continue;

    for (const op of SEARCH_OPS) {
      if (routeDeadlineHit(options.deadlineMs)) break;
      const next = node.engine.clone();
      const before = { ...next.active };
      if (!applyMove(next, op)) continue;
      const lastTransitionKey = transitionKey(before, next.active, op);
      const key = routeKey(next, lastTransitionKey);
      if (seenStates.has(key)) continue;
      seenStates.add(key);
      queue.push({ engine: next, path: [...node.path, op], lastTransitionKey });
      if (seenStates.size > opts.maxStates) break;
    }
  }

  out.sort((a, b) => b.score - a.score || a.routeLength - b.routeLength);
  return out.slice(0, opts.maxChoices).map((x) => x.choice);
}

export function hasRouteInfo(action: PlacementAction): boolean {
  const info = ((action as AiChoice).aiInfo ?? {}) as Record<string, unknown>;
  return Array.isArray(info.route) && (info.route as unknown[]).length > 0;
}

export function choicePieceKind(action: PlacementAction): PieceKind {
  return action.piece;
}
