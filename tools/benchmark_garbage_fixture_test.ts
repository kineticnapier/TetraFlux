import assert from "node:assert/strict";
import { TetrisEngine } from "../src/engine/tetris";
import { executeBenchmarkAction } from "../src/ai/benchmarkRunner";
import { configureBenchmarkGarbageEnvironment, getBenchmarkGarbageEnvironmentConfig } from "../src/ai/benchmarkEnvironment";
import { createBuiltinAi } from "../src/ai/registry";
import { HeuristicAI } from "../src/ai/heuristic";

configureBenchmarkGarbageEnvironment({ enabled: true, linesPerBag: 4, startBag: 1, maxBags: 2, applyAfterResponse: true });
const cfg = getBenchmarkGarbageEnvironmentConfig();
assert.equal(cfg.enabled, true);
assert.equal(cfg.linesPerBag, 4);

const engine = new TetrisEngine(424242);
const ai = new HeuristicAI();

for (let i = 0; i < 7; i++) {
  const choice = ai.choose(engine);
  assert.ok(choice, `expected choice at piece ${i}`);
  const placement = executeBenchmarkAction(engine, choice);
  assert.ok(placement.result.ok, `expected lock ok at piece ${i}`);
}
assert.equal(engine.piecesLocked, 7);
assert.equal(engine.pendingGarbage, 4, "benchmark environment should queue garbage after each bag");

const pressureChoice = ai.choose(engine);
assert.ok(pressureChoice);
assert.equal(pressureChoice.aiInfo.pendingGarbage, 4);
assert.equal(pressureChoice.aiInfo.garbagePressureMode, "counter");
const pressurePlacement = executeBenchmarkAction(engine, pressureChoice);
assert.ok(pressurePlacement.metrics.benchmarkGarbage?.benchmarkGarbageEnabled);
assert.equal(pressurePlacement.metrics.benchmarkGarbage?.benchmarkGarbagePendingBefore, 4);
assert.ok((pressurePlacement.metrics.benchmarkGarbage?.benchmarkGarbageCancelled ?? 0) + (pressurePlacement.metrics.benchmarkGarbage?.benchmarkGarbageApplied ?? 0) >= 0);

for (const id of ["heuristic", "lookahead", "spin", "aggressive", "defensive", "downstacker", "combo", "noisy_hybrid"]) {
  const e = new TetrisEngine(1000 + id.length);
  e.queueGarbage(8);
  const entry = createBuiltinAi(id);
  const choice = entry.ai.choose(e);
  assert.ok(choice, `${id} should choose under garbage pressure`);
  assert.ok(choice.aiInfo.garbagePressureMode, `${id} should annotate garbage pressure mode`);
  assert.ok(Number(choice.aiInfo.pendingGarbage ?? 0) >= 8, `${id} should see pending garbage`);
}

console.log("benchmark garbage fixture passed");
