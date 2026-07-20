import assert from "node:assert/strict";
import { HeuristicAI } from "../src/ai/heuristic";
import {
  createBuiltinAi,
  makeLearnedHeuristicAI,
  setDefaultLearnedProfileProvider,
} from "../src/ai/registry";
import {
  checkpointBestProfile,
  createInitialHeuristicCheckpoint,
  finalizeHeuristicGeneration,
  runHeuristicTrainingGeneration,
  sampleHeuristicPopulation,
} from "../src/training/heuristicTrainer";
import {
  applyHeuristicWeightProfile,
  createHeuristicWeightProfile,
  parseHeuristicWeightProfile,
} from "../src/training/heuristicWeights";

const profile = createHeuristicWeightProfile({ holeWeight: 9.5, attackBonus: 3.1 });
const parsed = parseHeuristicWeightProfile(JSON.parse(JSON.stringify(profile)));
const ai = new HeuristicAI();
applyHeuristicWeightProfile(ai, parsed);
assert.equal(ai.holeWeight, 9.5);
assert.equal(ai.attackBonus, 3.1);

const learned = makeLearnedHeuristicAI(parsed) as HeuristicAI;
assert.equal(learned.holeWeight, 9.5, "Learned Heuristic should apply the supplied browser profile");
assert.equal(learned.attackBonus, 3.1);

setDefaultLearnedProfileProvider(() => parsed);
const injected = createBuiltinAi("learned_heuristic").ai as HeuristicAI;
assert.equal(injected.holeWeight, 9.5, "browser profile provider should reach the game registry");
assert.equal(injected.attackBonus, 3.1);
setDefaultLearnedProfileProvider(() => undefined);

const initial = createInitialHeuristicCheckpoint({
  population: 2,
  eliteCount: 1,
  gamesPerCandidate: 1,
  maxPieces: 20,
  trainingSeedBase: 1234,
  initialSigma: 0.05,
});
const sampledA = sampleHeuristicPopulation(initial);
const sampledB = sampleHeuristicPopulation(initial);
assert.deepEqual(sampledA, sampledB, "candidate sampling must be deterministic");

const generation = await runHeuristicTrainingGeneration(initial, { yieldEveryGame: false });
assert.equal(generation.generation, 1);
assert.equal(generation.candidates.length, 2);
assert.ok(Number.isFinite(generation.best.fitness));
assert.ok(generation.checkpoint.best);
assert.equal(generation.checkpoint.rngState, sampledA.nextRngState);
assert.deepEqual(
  generation.candidates.map((candidate) => ({ index: candidate.index, weights: candidate.weights })).sort((a, b) => a.index - b.index),
  sampledA.candidates,
  "evaluated candidates must match the pre-sampled population",
);

const reordered = finalizeHeuristicGeneration(
  initial,
  [...generation.candidates].reverse(),
  1,
  initial.config.trainingSeedBase,
  sampledA.nextRngState,
);
assert.deepEqual(reordered.checkpoint.mean, generation.checkpoint.mean, "evaluation completion order must not change CEM mean");
assert.deepEqual(reordered.checkpoint.deviation, generation.checkpoint.deviation, "evaluation completion order must not change CEM deviation");
assert.deepEqual(reordered.checkpoint.best, generation.checkpoint.best, "evaluation completion order must not change the best candidate");
assert.equal(checkpointBestProfile(generation.checkpoint).featureSet, "flat-14-v1");
console.log("heuristic training fixture passed");
