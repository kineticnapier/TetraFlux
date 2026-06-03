import assert from "node:assert/strict";
import { executeBenchmarkAction } from "../src/ai/benchmarkRunner";
import { findReadySpinFinisherChoice, type AiMoveOp } from "../src/ai/spinFinisher";
import { estimateSpinPotential } from "../src/ai/spinPotential";
import { TetrisEngine } from "../src/engine/tetris";

function makeTsdReadyEngine(tSource: "active" | "hold" | "next" = "active"): TetrisEngine {
  const engine = new TetrisEngine(1, 2);
  for (let y = 0; y < engine.board.length; y++) {
    for (let x = 0; x < engine.board[y].length; x++) engine.board[y][x] = null;
  }

  // T rot=2 at x=4,y=18 completes rows 19 and 20. The bottom front
  // corners plus one upper back corner satisfy the engine's T-spin test.
  engine.board[18][4] = "G";
  for (let x = 0; x < 10; x++) if (x !== 4 && x !== 5 && x !== 6) engine.board[19][x] = "G";
  for (let x = 0; x < 10; x++) if (x !== 5) engine.board[20][x] = "G";

  engine.active = { kind: tSource === "active" ? "T" : "I", x: 3, y: 0, rot: 0 };
  engine.hold = tSource === "hold" ? "T" : null;
  engine.queue = tSource === "next" ? ["T", "O", "L", "J", "S", "Z", "I"] : ["I", "O", "L", "J", "S", "Z", "T"];
  engine.canHold = true;
  engine.dead = false;
  return engine;
}

function compactBoard(engine: TetrisEngine): string {
  return engine.stateDict().board.join("\n");
}

function assertReadySlotDetectorSeesSomething(engine: TetrisEngine, label: string): void {
  const potential = estimateSpinPotential(engine.stateDict());
  const target = potential.bestTarget;
  assert.ok(target, `${label}: ready-slot detector should return a bestTarget\n${compactBoard(engine)}`);
  assert.ok(
    target.kind === "TSD_LEFT" || target.kind === "TSD_RIGHT" || target.kind === "STSD" || target.kind === "TST",
    `${label}: expected a TSD/TST-like target, got ${target.kind}`,
  );
  assert.ok(target.cornerCount >= 3, `${label}: target should satisfy at least 3 corners`);
  assert.ok(target.completeRows >= 1, `${label}: target should be close to a line-clearing spin`);
}

function assertTsdFinisher(tSource: "active" | "hold" | "next"): void {
  const engine = makeTsdReadyEngine(tSource);
  assertReadySlotDetectorSeesSomething(engine, tSource);

  const found = findReadySpinFinisherChoice(engine);
  assert.equal(found.reason, undefined, `${tSource}: finisher should not reject`);
  assert.ok(found.choice, `${tSource}: finisher should return a choice`);
  assert.ok(found.routeAttempts > 0, `${tSource}: route checks should be counted`);

  const route = found.choice.aiInfo.route as AiMoveOp[] | undefined;
  assert.ok(Array.isArray(route) && route.length > 0, `${tSource}: route should be present`);
  assert.ok(["cw", "ccw", "180"].includes(route[route.length - 1]), `${tSource}: route should end with rotation`);

  const execution = executeBenchmarkAction(engine, found.choice);
  const lock = execution.result;
  assert.equal(execution.metrics.routeUsed, true, `${tSource}: route should execute as AI move`);
  assert.equal(execution.metrics.spinFinisherAttempt, true, `${tSource}: execution attempt should be counted`);
  assert.equal(execution.metrics.spinFinisherSuccess, true, `${tSource}: success should be counted`);
  assert.equal(lock.ok, true, `${tSource}: lock should succeed`);
  assert.equal(lock.spin, "tspin", `${tSource}: lock should classify as T-spin`);
  assert.equal(lock.linesCleared, 2, `${tSource}: lock should clear a TSD`);
  assert.equal(lock.lockEvent?.lastSuccessfulAction, "rotate", `${tSource}: last action should be rotate`);
  assert.equal(lock.lockEvent?.lastKickIndex, 0, `${tSource}: kick index should be recorded`);
  assert.equal(lock.lockEvent?.occupiedCorners?.front, 2, `${tSource}: front corners should be occupied`);
  assert.equal(lock.lockEvent?.occupiedCorners?.total, 3, `${tSource}: three corners should be occupied`);
}

for (const source of ["active", "hold", "next"] as const) assertTsdFinisher(source);

console.log("spin finisher fixture: ok");
