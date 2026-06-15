import { applyBenchmarkTuningToAi, benchmarkTuningChangedKeys, benchmarkTuningSummary, normalizeBenchmarkTuningConfig } from "../src/bench/benchmarkTuning";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tuning = normalizeBenchmarkTuningConfig({
  enabled: true,
  garbageHoleSensitivity: 0.65,
  b2bPressureSensitivity: 1.4,
  holeWeight: 12.5,
  attackBonus: 3.2,
  depth: 2,
  beamWidth: 24,
  includeTwists: true,
  useGarbageHoleTracking: true,
});

assert(tuning.enabled === true, "tuning should be enabled");
assert(tuning.garbageHoleSensitivity === 0.65, "garbageHoleSensitivity should be normalized");
assert(tuning.depth === 2, "depth should be normalized");
assert(benchmarkTuningChangedKeys(tuning).includes("garbageHoleSensitivity"), "changed keys should include garbageHoleSensitivity");
assert(benchmarkTuningSummary(tuning).includes("garbageHoleSensitivity=0.65"), "summary should include changed field");

const ai: any = {
  holeWeight: 13,
  attackBonus: 2,
  garbageHoleSensitivity: 1,
  useGarbageHoleTracking: false,
  lookaheadOptions: {
    depth: 3,
    beamWidth: 50,
    includeTwists: false,
  },
};

applyBenchmarkTuningToAi(ai, tuning);
assert(ai.holeWeight === 12.5, "heuristic weight should be applied");
assert(ai.attackBonus === 3.2, "attack bonus should be applied");
assert(ai.garbageHoleSensitivity === 0.65, "shared pressure field should be mirrored to AI instance");
assert(ai.useGarbageHoleTracking === true, "boolean field should be mirrored to AI instance");
assert(ai.lookaheadOptions.depth === 2, "lookahead depth should be applied");
assert(ai.lookaheadOptions.beamWidth === 24, "lookahead beam width should be applied");
assert(ai.lookaheadOptions.includeTwists === true, "lookahead boolean should be applied");

console.log("benchmark tuning fixture passed");
