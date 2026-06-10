import assert from "node:assert/strict";
import { TetrisEngine } from "../src/engine/tetris";
import { adjustForGarbagePressure, getGarbagePressureContext, scoreGarbagePressureResponse } from "../src/ai/garbagePressure";

function baseOptions() {
  return {
    depth: 2,
    beamWidth: 20,
    includeHold: true,
    spinBias: 1.35,
    maxCandidatesPerNode: 20,
    maxNodesPerDepth: 120,
    timeBudgetMs: 8,
    includeTwists: true,
    maxTwistCandidates: 12,
    twistTimeBudgetMs: 3,
    twistBias: 1.1,
    useGarbagePressure: true,
    garbagePressureSensitivity: 1,
  };
}

const normal = new TetrisEngine(1234);
const normalPressure = getGarbagePressureContext(normal);
assert.equal(normalPressure.mode, "normal");

const counter = new TetrisEngine(1234);
counter.queueGarbage(3);
const counterPressure = getGarbagePressureContext(counter);
assert.equal(counterPressure.mode, "counter");
const counterOptions = adjustForGarbagePressure(baseOptions(), counterPressure, 1);
assert.ok(counterOptions.spinBias <= baseOptions().spinBias);
assert.ok(counterOptions.maxTwistCandidates < baseOptions().maxTwistCandidates);

const emergency = new TetrisEngine(1234);
emergency.queueGarbage(10);
const emergencyPressure = getGarbagePressureContext(emergency);
assert.equal(emergencyPressure.mode, "emergency");
const emergencyOptions = adjustForGarbagePressure(baseOptions(), emergencyPressure, 1);
assert.ok(emergencyOptions.spinBias <= 1.0);
assert.ok(emergencyOptions.maxTwistCandidates <= 3);

const safeResult = {
  ok: true,
  topout: false,
  linesCleared: 2,
  attackSent: 4,
} as any;
const beforeMetrics = { holes: 1, maxHeight: 8, totalHeight: 34, bumpiness: 10 } as any;
const afterMetrics = { holes: 1, maxHeight: 7, totalHeight: 28, bumpiness: 9 } as any;
const response = scoreGarbagePressureResponse({
  before: emergencyPressure,
  result: safeResult,
  beforeMetrics,
  afterMetrics,
  holeDelta: 0,
  maxHeightDelta: -1,
  bumpinessDelta: -1,
});
assert.ok(response.penalty < 0, `expected pressure response to reward cancel/downstack, got ${response.penalty}`);

console.log("garbage pressure fixture passed");
