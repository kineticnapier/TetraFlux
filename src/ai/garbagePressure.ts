import { boardMetrics, type LockResult, type TetrisEngine } from "../engine/tetris";

export type GarbagePressureMode = "normal" | "counter" | "downstack" | "emergency";

export interface GarbagePressureContext {
  mode: GarbagePressureMode;
  pendingGarbage: number;
  danger: number;
  topRowsBlocked: boolean;
  maxHeight: number;
  holes: number;
  totalHeight: number;
  bumpiness: number;
}

export interface GarbagePressureAdjustment {
  spinBias: number;
  maxTwistCandidates: number;
  twistTimeBudgetMs: number;
  maxCandidatesPerNode: number;
  maxNodesPerDepth: number;
  pressureMultiplier: number;
}

export interface GarbagePressureScore {
  penalty: number;
  cancelReward: number;
  clearReward: number;
  downstackReward: number;
  safetyPenalty: number;
  mode: GarbagePressureMode;
  pendingGarbage: number;
  estimatedRemainingGarbage: number;
}

export function getGarbagePressureContext(engine: TetrisEngine): GarbagePressureContext {
  const state = engine.stateDict();
  const metrics = boardMetrics(state.board);
  const pendingGarbage = Math.max(0, Math.floor(Number(state.pendingGarbage ?? 0)));
  const topRowsBlocked = state.board.slice(0, 6).some((row) => /[^.]/.test(row));

  const heightDanger = Math.max(0, metrics.maxHeight - 8) * 0.85;
  const holeDanger = Math.max(0, metrics.holes - 1) * 1.15;
  const roughDanger = Math.max(0, metrics.bumpiness - 12) * 0.12;
  const totalDanger = Math.max(0, metrics.totalHeight - 34) * 0.05;
  const garbageDanger = pendingGarbage * 1.05;
  const topDanger = topRowsBlocked ? 5.5 : 0;
  const danger = garbageDanger + heightDanger + holeDanger + roughDanger + totalDanger + topDanger;

  let mode: GarbagePressureMode = "normal";
  if (pendingGarbage >= 9 || danger >= 13 || topRowsBlocked || metrics.maxHeight >= 15) mode = "emergency";
  else if (pendingGarbage >= 6 || danger >= 8.5 || metrics.holes >= 4 || metrics.maxHeight >= 12) mode = "downstack";
  else if (pendingGarbage >= 2 || danger >= 4.5) mode = "counter";

  return {
    mode,
    pendingGarbage,
    danger: Number(danger.toFixed(3)),
    topRowsBlocked,
    maxHeight: metrics.maxHeight,
    holes: metrics.holes,
    totalHeight: metrics.totalHeight,
    bumpiness: metrics.bumpiness,
  };
}

export function adjustForGarbagePressure<T extends {
  spinBias: number;
  maxTwistCandidates: number;
  twistTimeBudgetMs: number;
  maxCandidatesPerNode: number;
  maxNodesPerDepth: number;
}>(options: T, pressure: GarbagePressureContext, sensitivity = 1): T & GarbagePressureAdjustment {
  const s = Math.max(0, sensitivity);
  if (pressure.mode === "normal" || s <= 0) {
    return {
      ...options,
      pressureMultiplier: 0,
    };
  }

  const level = pressure.mode === "counter" ? 1 : pressure.mode === "downstack" ? 2 : 3;
  const multiplier = level * s;
  const spinClamp = pressure.mode === "counter" ? 1.12 : 1.0;
  const twistScale = pressure.mode === "counter" ? 0.75 : pressure.mode === "downstack" ? 0.45 : 0.25;
  const nodeScale = pressure.mode === "counter" ? 0.9 : pressure.mode === "downstack" ? 0.75 : 0.6;

  return {
    ...options,
    spinBias: Math.min(options.spinBias, spinClamp),
    maxTwistCandidates: Math.max(1, Math.floor(options.maxTwistCandidates * twistScale)),
    twistTimeBudgetMs: Math.max(0.4, options.twistTimeBudgetMs * twistScale),
    maxCandidatesPerNode: Math.max(8, Math.floor(options.maxCandidatesPerNode * nodeScale)),
    maxNodesPerDepth: Math.max(48, Math.floor(options.maxNodesPerDepth * nodeScale)),
    pressureMultiplier: multiplier,
  };
}

export function shouldSkipSpeculativeFinisher(pressure: GarbagePressureContext): boolean {
  // Immediate verified TSDs can still be useful under pressure, but speculative
  // setup/unsafe synthetic finishers should not be allowed during downstack mode.
  return pressure.mode === "downstack" || pressure.mode === "emergency";
}

export function scoreGarbagePressureResponse(args: {
  before: GarbagePressureContext;
  result: LockResult;
  beforeMetrics: ReturnType<typeof boardMetrics>;
  afterMetrics: ReturnType<typeof boardMetrics>;
  holeDelta: number;
  maxHeightDelta: number;
  bumpinessDelta: number;
}): GarbagePressureScore {
  const { before, result, beforeMetrics, afterMetrics, holeDelta, maxHeightDelta, bumpinessDelta } = args;
  if (before.mode === "normal" || before.pendingGarbage <= 0) {
    return {
      penalty: 0,
      cancelReward: 0,
      clearReward: 0,
      downstackReward: 0,
      safetyPenalty: 0,
      mode: before.mode,
      pendingGarbage: before.pendingGarbage,
      estimatedRemainingGarbage: before.pendingGarbage,
    };
  }

  const level = before.mode === "counter" ? 1 : before.mode === "downstack" ? 2 : 3;
  const attack = Math.max(0, Number(result.attackSent ?? 0));
  const lines = Math.max(0, Number(result.linesCleared ?? 0));
  const cancel = Math.min(before.pendingGarbage, attack);
  const estimatedRemainingGarbage = Math.max(0, before.pendingGarbage - attack);

  // Under pressure, the AI should either cancel garbage with attack or create a
  // safer surface before the incoming garbage is applied.
  const cancelReward = cancel * (10 + level * 4);
  const overCounterReward = Math.max(0, attack - before.pendingGarbage) * (level === 1 ? 2.2 : 0.9);
  const clearReward = lines * (2.5 + level * 1.6);

  const heightDrop = Math.max(0, beforeMetrics.maxHeight - afterMetrics.maxHeight);
  const totalDrop = Math.max(0, beforeMetrics.totalHeight - afterMetrics.totalHeight);
  const holeDrop = Math.max(0, beforeMetrics.holes - afterMetrics.holes);
  const downstackReward = heightDrop * (3.2 + level * 1.2) + totalDrop * (0.55 + level * 0.2) + holeDrop * (6 + level * 2.5);

  const noCounterPenalty = attack <= 0 && lines <= 0 ? (before.pendingGarbage * (4 + level * 2.8)) : 0;
  const remainingPenalty = estimatedRemainingGarbage * (2.8 + level * 1.8);
  const safetyPenalty =
    Math.max(0, holeDelta) * (14 + level * 8) +
    Math.max(0, maxHeightDelta) * (7 + level * 4) +
    Math.max(0, bumpinessDelta - 1) * (1.4 + level * 0.75) +
    Math.max(0, afterMetrics.maxHeight - 12) * (8 + level * 4) +
    Math.max(0, afterMetrics.holes - 3) * (12 + level * 5) +
    (result.topout ? 100000 : 0);

  const penalty = safetyPenalty + noCounterPenalty + remainingPenalty - cancelReward - overCounterReward - clearReward - downstackReward;
  return {
    penalty,
    cancelReward,
    clearReward,
    downstackReward,
    safetyPenalty: safetyPenalty + noCounterPenalty + remainingPenalty,
    mode: before.mode,
    pendingGarbage: before.pendingGarbage,
    estimatedRemainingGarbage,
  };
}
