import assert from "node:assert/strict";
import { executeBenchmarkAction } from "../src/ai/benchmarkRunner";
import { generateTwistChoices } from "../src/ai/twistMoveGenerator";
import { TetrisEngine } from "../src/engine/tetris";

function makeTsdReadyEngine(): TetrisEngine {
  const engine = new TetrisEngine(1, 2);
  for (let y = 0; y < engine.board.length; y++) {
    for (let x = 0; x < engine.board[y].length; x++) engine.board[y][x] = null;
  }

  engine.board[18][4] = "G";
  for (let x = 0; x < 10; x++) if (x !== 4 && x !== 5 && x !== 6) engine.board[19][x] = "G";
  for (let x = 0; x < 10; x++) if (x !== 5) engine.board[20][x] = "G";

  engine.active = { kind: "T", x: 3, y: 0, rot: 0 };
  engine.hold = null;
  engine.queue = ["I", "O", "L", "J", "S", "Z", "T"];
  engine.canHold = true;
  engine.dead = false;
  return engine;
}

const engine = makeTsdReadyEngine();
const choices = generateTwistChoices(engine, { maxChoices: 10, maxStates: 5000, maxPathLength: 80, includeHold: true, allowUnsafe: true });
assert.ok(choices.length > 0, "twist generator should find at least one routed spin choice");
const best = choices[0];
assert.ok(Array.isArray(best.aiInfo.route), "best twist choice should include a route");

const execution = executeBenchmarkAction(engine, best);
assert.equal(execution.metrics.routeUsed, true, "benchmark execution should use the route");
assert.equal(execution.result.lockEvent?.lastSuccessfulAction, "rotate", "route should leave rotation as the last action");
assert.notEqual(execution.result.spin, "none", "fixture should produce a scoring spin");

console.log("twist move fixture: ok");
