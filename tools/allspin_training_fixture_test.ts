import assert from "node:assert/strict";
import {
  createInitialAllSpinCheckpoint,
  evaluateAllSpinWeights,
  sampleAllSpinPopulation,
} from "../src/training/allspinTrainer";
import {
  createAllSpinWeightProfile,
  parseAllSpinWeightProfile,
} from "../src/training/allspinWeights";
import { createHeuristicWeightProfile } from "../src/training/heuristicWeights";
import {
  createModelEnvelope,
  parseModelEnvelope,
} from "../src/models/modelEnvelope";

const base = createHeuristicWeightProfile({
  holeWeight: 13,
  attackBonus: 2.2,
  lineBonus: 4.1,
}, { profileId: "flat-fixture-g0001" });

const checkpoint = createInitialAllSpinCheckpoint({
  baseHeuristic: base,
  config: {
    population: 2,
    eliteCount: 1,
    gamesPerCandidate: 1,
    maxPieces: 20,
    trainingSeedBase: 123456,
    initialSigma: 0.05,
  },
  search: {
    depth: 1,
    beamWidth: 8,
    maxExpandedNodes: 16,
    maxCandidatesPerNode: 8,
    maxTwistCandidates: 2,
    maxTwistStates: 100,
    maxTwistPathLength: 12,
  },
  parentModelId: "flat-g0001-fixture",
});

const sampledA = sampleAllSpinPopulation(checkpoint);
const sampledB = sampleAllSpinPopulation(checkpoint);
assert.deepEqual(sampledA, sampledB, "All-Spin candidate sampling must be deterministic");
assert.equal(checkpoint.baseHeuristic.profileId, "flat-fixture-g0001");

const evaluationInput = {
  baseHeuristic: checkpoint.baseHeuristic,
  weights: sampledA.candidates[0].weights,
  search: checkpoint.search,
  games: 1,
  maxPieces: 5,
  seedBase: 777,
};
const first = await evaluateAllSpinWeights(evaluationInput);
const second = await evaluateAllSpinWeights(evaluationInput);
assert.deepEqual(first, second, "node-budget All-Spin evaluation must be deterministic");
assert.equal(first.ordinaryClearViolations, 0, "strict All-Spin must reject ordinary clears");

const profile = createAllSpinWeightProfile({
  baseHeuristic: base,
  weights: sampledA.candidates[0].weights,
  search: checkpoint.search,
  training: { generation: 1, parentModelId: checkpoint.parentModelId },
});
const parsedProfile = parseAllSpinWeightProfile(JSON.parse(JSON.stringify(profile)));
assert.equal(parsedProfile.baseHeuristic.profileId, base.profileId);

const envelope = createModelEnvelope({
  family: "allspin",
  generation: 1,
  payloadFormat: profile.format,
  payload: profile,
  parentModelId: checkpoint.parentModelId,
  modelId: "allspin-g0001-fixture",
});
const parsedEnvelope = parseModelEnvelope(JSON.parse(JSON.stringify(envelope)));
assert.equal(parsedEnvelope.family, "allspin");
assert.equal(parsedEnvelope.parentModelId, "flat-g0001-fixture");

console.log("all-spin training fixture: ok");
