// src/ai/b2bPressure.ts
function finiteNumber(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function isDifficultB2BClear(result) {
  const lines = Math.max(0, Math.floor(finiteNumber(result.linesCleared, 0)));
  const spin = result.spin ?? "none";
  return lines >= 4 || spin !== "none" && lines > 0;
}
function estimateB2BReleaseAttack(b2b) {
  const chain = Math.max(0, Math.floor(finiteNumber(b2b, 0)));
  if (chain <= 0) return 0;
  const early = Math.min(chain, 8) * 0.35;
  const mid = Math.max(0, Math.min(chain - 8, 32)) * 0.55;
  const late = Math.max(0, chain - 40) * 0.85;
  return Number((early + mid + late).toFixed(3));
}
function scoreB2BPressureResponse(input) {
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
  const breakPenalty = lineClearBreaks ? (18 + Math.min(90, beforeB2B * 2.4) + estimateB2BReleaseAttack(beforeB2B) * 1.4) * Math.max(0.35, pressureScale) : 0;
  const greedyPressurePenalty = pending >= 4 && attack <= 0 && lines <= 0 ? Math.min(35, pending * (mode === "emergency" ? 3.5 : 1.8)) : 0;
  const terrainRiskPenalty = Math.max(0, finiteNumber(input.holeDelta, 0)) * (beforeB2B > 0 ? 5 : 2) + Math.max(0, finiteNumber(input.maxHeightDelta, 0) - 1) * (beforeB2B > 0 ? 4 : 1.5);
  const topoutPenalty = input.result.topout ? 1e5 : 0;
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
    maintainedB2B
  };
}

// tools/b2b_pressure_fixture_test.ts
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
var base = {
  ok: true,
  reason: "",
  usedHold: false,
  linesCleared: 0,
  attackSent: 0,
  rawAttack: 0,
  combo: -1,
  b2b: 0,
  spin: "none",
  topout: false
};
var preserve = scoreB2BPressureResponse({
  beforeB2B: 25,
  afterB2B: 26,
  result: { ...base, linesCleared: 2, attackSent: 4, spin: "tspin" },
  pressure: { mode: "normal", pendingGarbage: 0, danger: 0, topRowsBlocked: false, maxHeight: 4, holes: 0, totalHeight: 20, bumpiness: 6 }
});
var breaker = scoreB2BPressureResponse({
  beforeB2B: 25,
  afterB2B: 0,
  result: { ...base, linesCleared: 1, attackSent: 0, spin: "none" },
  pressure: { mode: "normal", pendingGarbage: 0, danger: 0, topRowsBlocked: false, maxHeight: 4, holes: 0, totalHeight: 20, bumpiness: 6 }
});
assert(estimateB2BReleaseAttack(100) > estimateB2BReleaseAttack(20), "release estimate should scale with B2B chain");
assert(preserve.penalty < 0, "B2B difficult clear should be rewarded");
assert(breaker.penalty > 25, "ordinary line clear should be penalized when B2B is active");
assert(breaker.brokeB2B, "breaker should mark brokeB2B");
assert(preserve.maintainedB2B, "preserve should mark maintainedB2B");
console.log("b2b pressure fixture ok", { preserve: preserve.penalty, breaker: breaker.penalty, release100: estimateB2BReleaseAttack(100) });
