import assert from "node:assert/strict";
import { HeuristicAI } from "../src/ai/heuristic";
import { makeLearnedHeuristicAI } from "../src/ai/registry";
import { createInitialHeuristicCheckpoint, checkpointBestProfile, runHeuristicTrainingGeneration } from "../src/training/heuristicTrainer";
import { applyHeuristicWeightProfile, createHeuristicWeightProfile, parseHeuristicWeightProfile } from "../src/training/heuristicWeights";

const profile = createHeuristicWeightProfile({ holeWeight: 9.5, attackBonus: 3.1 });
const parsed = parseHeuristicWeightProfile(JSON.parse(JSON.stringify(profile)));
const ai = new HeuristicAI();
applyHeuristicWeightProfile(ai, parsed);
assert.equal(ai.holeWeight, 9.5);
assert.equal(ai.attackBonus, 3.1);

const learned = makeLearnedHeuristicAI(parsed) as HeuristicAI;
assert.equal(learned.holeWeight, 9.5, "Learned Heuristic should apply the supplied browser profile");
assert.equal(learned.attackBonus, 3.1);

const initial = createInitialHeuristicCheckpoint({
  population: 2,
  eliteCount: 1,
  gamesPerCandidate: 1,
  maxPieces: 20,
  trainingSeedBase: 1234,
  initialSigma: 0.05,
});
const generation = await runHeuristicTrainingGeneration(initial, { yieldEveryGame: false });
assert.equal(generation.generation, 1);
assert.equal(generation.candidates.length, 2);
assert.ok(Number.isFinite(generation.best.fitness));
assert.ok(generation.checkpoint.best);
assert.equal(checkpointBestProfile(generation.checkpoint).featureSet, "flat-14-v1");
console.log("heuristic training fixture passed");
