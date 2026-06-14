import type { LockResult } from "../engine/tetris";
import type { GarbagePressureContext } from "./garbagePressure";

export interface B2BPressureContext {
  beforeB2B: number;
  afterB2B: number;
  pendingGarbage: number;
  mode: string;
}

export interface B2BPressureScore {
  penalty: number;
  preserveReward: number;
  growReward: number;
  releaseReward: number;
  breakPenalty: number;
  pressureScale: number;
  difficult: boolean;
  brokeB2B: boolean;
  maintainedB2B: boolean;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isDifficultB2BClear(result: Pick<LockResult, "linesCleared" | "spin">): boolean {
  const lines = Math.max(0, Math.floor(finiteNumber(result.linesCleared, 0)));
  const spin = result.spin ?? "none";
  return lines >= 4 || (spin !== "none" && lines > 0);
}

export function estimateB2BReleaseAttack(b2b: number): number {
  const chain = Math.max(0, Math.floor(finiteNumber(b2b, 0)));
  if (chain <= 0) return 0;
  // Soft approximation of TETR.IO-like B2B scaling. This is not applied to the
  // engine attack yet; it is an AI value signal and benchmark diagnostic.
  const early = Math.min(chain, 8) * 0.35;
  const mid = Math.max(0, Math.min(chain - 8, 32)) * 0.55;
  const late = Math.max(0, chain - 40) * 0.85;
  return Number((early + mid + late).toFixed(3));
}

export function scoreB2BPressureResponse(input: {
  beforeB2B: number;
  afterB2B: number;
  result: Pick<LockResult, "linesCleared" | "attackSent" | "spin" | "topout">;
  pressure?: GarbagePressureContext | null;
  maxHeightDelta?: number;
  holeDelta?: number;
}): B2BPressureScore {
  const beforeB2B = Math.max(0, Math.floor(finiteNumber(input.beforeB2B, 0)));
  const afterB2B = Math.max(0, Math.floor(finiteNumber(input.afterB2B, 0)));
  const lines = Math.max(0, Math.floor(finiteNumber(input.result.linesCleared, 0)));
  const attack = Math.max(0, Math.floor(finiteNumber(input.result.attackSent, 0)));
  const difficult = isDifficultB2BClear(input.result);
  const lineClearBreaks = beforeB2B > 0 && lines > 0 && !difficult;
  const maintainedB2B = difficult && afterB2B >= beforeB2B;
  const grewB2B = difficult && afterB2B > beforeB2B;

  const mode = input.pressure?.mode ?? "normal";
  const pending = Math.max(0, Math.floor(finiteNumber(input.pressure?.pendingGarbage, 0)));
  const pressureScale = mode === "emergency" ? 0.35 : mode === "downstack" ? 0.55 : mode === "counter" ? 0.8 : 1;
  const chainScale = Math.min(4.5, 1 + beforeB2B / 18);

  const preserveReward = maintainedB2B ? (2.5 + Math.min(18, beforeB2B * 0.45)) * pressureScale : 0;
  const growReward = grewB2B ? (5 + Math.min(32, afterB2B * 0.7)) * pressureScale : 0;
  const releaseReward = difficult ? estimateB2BReleaseAttack(afterB2B) * (0.8 + pressureScale * 0.65) : 0;

  const breakPenalty = lineClearBreaks
    ? (18 + Math.min(90, beforeB2B * 2.4) + estimateB2BReleaseAttack(beforeB2B) * 1.4) * Math.max(0.35, pressureScale)
    : 0;

  // In pressure, B2B is good only if it also helps us survive. Penalize greedy
  // non-clears that keep the chain but let garbage pressure remain unhandled.
  const greedyPressurePenalty = pending >= 4 && attack <= 0 && lines <= 0
    ? Math.min(35, pending * (mode === "emergency" ? 3.5 : 1.8))
    : 0;
  const terrainRiskPenalty = Math.max(0, finiteNumber(input.holeDelta, 0)) * (beforeB2B > 0 ? 5 : 2)
    + Math.max(0, finiteNumber(input.maxHeightDelta, 0) - 1) * (beforeB2B > 0 ? 4 : 1.5);
  const topoutPenalty = input.result.topout ? 100000 : 0;

  const penalty = breakPenalty + greedyPressurePenalty + terrainRiskPenalty + topoutPenalty - preserveReward - growReward - releaseReward;
  return {
    penalty,
    preserveReward,
    growReward,
    releaseReward,
    breakPenalty: breakPenalty + greedyPressurePenalty + terrainRiskPenalty + topoutPenalty,
    pressureScale,
    difficult,
    brokeB2B: lineClearBreaks,
    maintainedB2B,
  };
}
