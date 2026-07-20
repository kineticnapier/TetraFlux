import assert from "node:assert/strict";
import { AllSpinAI } from "../src/ai/allSpinAI";
import { isAllSpinLineClear, violatesStrictAllSpin } from "../src/ai/allSpinRules";
import { executeChoiceWithOptionalRoute } from "../src/ai/twistMoveGenerator";
import { setAllSpinScoring } from "../src/engine/allSpinScoring";
import { TetrisEngine, type LockResult } from "../src/engine/tetris";

const mechanicalJDouble = {
  ok: true,
  piece: "J",
  linesCleared: 2,
  spin: "none",
  topout: false,
  attackSent: 1,
  rawAttack: 1,
  combo: -1,
  b2b: 0,
  usedHold: false,
  reason: "",
  lockEvent: { lastSuccessfulAction: "rotate", lastRotation: null },
  spinClassification: { scoring: "none", mechanical: "immobile", lastRotation: null },
} as LockResult;
assert.equal(isAllSpinLineClear(mechanicalJDouble), true);

const ordinaryDouble = {
  ...mechanicalJDouble,
  lockEvent: { lastSuccessfulAction: "direct" },
  spinClassification: { scoring: "none", mechanical: "none", lastRotation: null },
} as LockResult;
assert.equal(violatesStrictAllSpin(ordinaryDouble), true);

const oTwist = { ...mechanicalJDouble, piece: "O" } as LockResult;
assert.equal(isAllSpinLineClear(oTwist), false);

function makeISpinSingleEngine(enabled: boolean): TetrisEngine {
  const engine = new TetrisEngine(3, 4);
  for (let y = 0; y < engine.board.length; y++) {
    for (let x = 0; x < engine.board[y].length; x++) engine.board[y][x] = null;
  }

  const bottom = engine.board.length - 1;
  for (let x = 0; x < 10; x++) {
    if (x < 3 || x > 6) engine.board[bottom][x] = "G";
  }

  engine.active = { kind: "I", x: 3, y: 18, rot: 1 };
  engine.hold = null;
  engine.queue = ["T", "J", "L", "S", "Z", "O", "I"];
  engine.canHold = true;
  engine.dead = false;
  engine.combo = -1;
  engine.b2b = 0;
  setAllSpinScoring(engine, enabled);
  return engine;
}

const scoringEngine = makeISpinSingleEngine(true);
assert.equal(scoringEngine.rotateCcw(), true, "fixture rotation should succeed");
const scoringResult = scoringEngine.hardDrop();
assert.equal(scoringResult.linesCleared, 1);
assert.equal(scoringResult.spin, "spin", "I immobile clear should be classified before attack calculation");
assert.equal(scoringResult.spinClassification?.scoring, "spin");
assert.equal(scoringResult.attackBase, 1, "generic spin single should use the engine spin table");
assert.equal(scoringEngine.b2b, 1, "All-Spin clear should enter B2B through the normal lock path");

const normalEngine = makeISpinSingleEngine(false);
assert.equal(normalEngine.rotateCcw(), true, "normal fixture rotation should succeed");
const normalResult = normalEngine.hardDrop();
assert.equal(normalResult.linesCleared, 1);
assert.equal(normalResult.spin, "none", "normal rules must retain ordinary non-T scoring");
assert.equal(normalResult.attackBase, 0);
assert.equal(normalEngine.b2b, 0);

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
assert.equal(choice.aiInfo.strictAllSpin, true, "chosen action must carry strict All-Spin execution metadata");
const preview = engine.clone();
const result = executeChoiceWithOptionalRoute(preview, choice).result;
assert.equal(violatesStrictAllSpin(result), false, "strict AllSpinAI must not choose an ordinary line clear");

console.log("all-spin AI fixture: ok");
