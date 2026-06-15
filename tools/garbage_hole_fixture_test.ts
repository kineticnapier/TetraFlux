import { analyzeGarbageHole, scoreGarbageHoleResponse } from "../src/ai/garbageHoleTracker";
import type { LockResult } from "../src/engine/tetris";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const empty = "..........";
const beforeBoard = Array(20).fill(empty) as string[];
beforeBoard[12] = "....X.....";
beforeBoard[13] = "....X.....";
beforeBoard[16] = "XXXX.XXXXX";
beforeBoard[17] = "XXXX.XXXXX";
beforeBoard[18] = "XXXX.XXXXX";
beforeBoard[19] = "XXXX.XXXXX";

const afterBoard = Array(20).fill(empty) as string[];
afterBoard[16] = "XXXX.XXXXX";
afterBoard[17] = "XXXX.XXXXX";
afterBoard[18] = "XXXX.XXXXX";
afterBoard[19] = "XXXX.XXXXX";

const before = analyzeGarbageHole(beforeBoard);
const after = analyzeGarbageHole(afterBoard);
assert(before.found, "should detect garbage hole before");
assert(after.found, "should detect garbage hole after");
assert(before.dominantColumn === 4, `expected column 4, got ${before.dominantColumn}`);
assert(before.blocksAboveTarget > after.blocksAboveTarget, "after should have fewer blocks above target hole");
assert(after.accessScore > before.accessScore, "after should improve access score");

const baseResult = {
  ok: true,
  reason: "",
  usedHold: false,
  linesCleared: 1,
  attackSent: 0,
  rawAttack: 0,
  combo: -1,
  b2b: 0,
  spin: "none",
  topout: false,
} as LockResult;

const score = scoreGarbageHoleResponse({
  before,
  after,
  pressure: { mode: "emergency", pendingGarbage: 4, danger: 12, topRowsBlocked: false, maxHeight: 12, holes: 4, totalHeight: 70, bumpiness: 12 },
  result: baseResult,
});

assert(score.penalty < 0, `hole progress should be rewarded, got penalty=${score.penalty}`);
assert(score.progress > 0, "progress should be positive");

const worseBoard = [...beforeBoard];
worseBoard[11] = "....X.....";
const worse = analyzeGarbageHole(worseBoard);
const worseScore = scoreGarbageHoleResponse({
  before,
  after: worse,
  pressure: { mode: "emergency", pendingGarbage: 4, danger: 12, topRowsBlocked: false, maxHeight: 12, holes: 4, totalHeight: 70, bumpiness: 12 },
  result: { ...baseResult, linesCleared: 0 },
});
assert(worseScore.penalty > score.penalty, "burying the hole lane should be worse than opening it");

console.log("garbage hole fixture ok", { column: before.dominantColumn, beforeBlocks: before.blocksAboveTarget, afterBlocks: after.blocksAboveTarget, penalty: score.penalty });
