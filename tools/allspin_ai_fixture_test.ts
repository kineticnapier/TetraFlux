import assert from "node:assert/strict";
import { AllSpinAI } from "../src/ai/allSpinAI";
import { isAllSpinLineClear, violatesStrictAllSpin } from "../src/ai/allSpinRules";
import { executeChoiceWithOptionalRoute } from "../src/ai/twistMoveGenerator";
import { TetrisEngine, type LockResult } from "../src/engine/tetris";

const mechanicalJDouble = {
  ok: true,
  piece: "J",
  linesCleared: 2,
  spin: "none",
  topout: false,
  attackSent: 0,
  lockEvent: { lastSuccessfulAction: "rotate" },
  spinClassification: { mechanical: "immobile" },
} as LockResult;
assert.equal(isAllSpinLineClear(mechanicalJDouble), true);

const ordinaryDouble = {
  ...mechanicalJDouble,
  lockEvent: { lastSuccessfulAction: "direct" },
  spinClassification: { mechanical: "none" },
} as LockResult;
assert.equal(violatesStrictAllSpin(ordinaryDouble), true);

const oTwist = { ...mechanicalJDouble, piece: "O" } as LockResult;
assert.equal(isAllSpinLineClear(oTwist), false);

const engine = new TetrisEngine(11, 12);
for (let y = 0; y < engine.board.length; y++) {
  for (let x = 0; x < engine.board[y].length; x++) engine.board[y][x] = null;
}
for (let x = 0; x < 10; x++) {
  if (x < 3 || x > 6) engine.board[engine.board.length - 1][x] = "G";
}
engine.active = { kind: "I", x: 3, y: 0, rot: 0 };
engine.hold = null;
engine.queue = ["T", "J", "L", "S", "Z", "O", "I"];
engine.canHold = true;
engine.dead = false;

const ai = new AllSpinAI({
  depth: 1,
  beamWidth: 20,
  timeBudgetMs: 50,
  maxCandidatesPerNode: 40,
  maxTwistCandidates: 12,
  maxTwistStates: 4000,
  maxTwistPathLength: 80,
  twistTimeBudgetMs: 20,
});
const choice = ai.choose(engine);
assert.ok(choice, "AllSpinAI should find a legal setup move");
const preview = engine.clone();
const result = executeChoiceWithOptionalRoute(preview, choice).result;
assert.equal(violatesStrictAllSpin(result), false, "strict AllSpinAI must not choose an ordinary line clear");

console.log("all-spin AI fixture: ok");
