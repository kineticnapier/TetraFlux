import { estimateB2BReleaseAttack, scoreB2BPressureResponse } from "../src/ai/b2bPressure";
import type { LockResult } from "../src/engine/tetris";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const base = {
  ok: true,
  reason: "",
  usedHold: false,
  linesCleared: 0,
  attackSent: 0,
  rawAttack: 0,
  combo: -1,
  b2b: 0,
  spin: "none",
  topout: false,
} as LockResult;

const preserve = scoreB2BPressureResponse({
  beforeB2B: 25,
  afterB2B: 26,
  result: { ...base, linesCleared: 2, attackSent: 4, spin: "tspin" },
  pressure: { mode: "normal", pendingGarbage: 0, danger: 0, topRowsBlocked: false, maxHeight: 4, holes: 0, totalHeight: 20, bumpiness: 6 },
});

const breaker = scoreB2BPressureResponse({
  beforeB2B: 25,
  afterB2B: 0,
  result: { ...base, linesCleared: 1, attackSent: 0, spin: "none" },
  pressure: { mode: "normal", pendingGarbage: 0, danger: 0, topRowsBlocked: false, maxHeight: 4, holes: 0, totalHeight: 20, bumpiness: 6 },
});

assert(estimateB2BReleaseAttack(100) > estimateB2BReleaseAttack(20), "release estimate should scale with B2B chain");
assert(preserve.penalty < 0, "B2B difficult clear should be rewarded");
assert(breaker.penalty > 25, "ordinary line clear should be penalized when B2B is active");
assert(breaker.brokeB2B, "breaker should mark brokeB2B");
assert(preserve.maintainedB2B, "preserve should mark maintainedB2B");

console.log("b2b pressure fixture ok", { preserve: preserve.penalty, breaker: breaker.penalty, release100: estimateB2BReleaseAttack(100) });
