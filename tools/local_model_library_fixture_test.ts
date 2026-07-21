import assert from "node:assert/strict";
import {
  createLocalModelLibraryBundle,
  parseLocalModelLibrary,
} from "../src/models/modelLibraryBundle";
import {
  createModelEnvelope,
  parseModelEnvelope,
} from "../src/models/modelEnvelope";

const flat = createModelEnvelope({
  family: "flat",
  generation: 8,
  payloadFormat: "tetraflux_heuristic_weights_v1",
  payload: { format: "tetraflux_heuristic_weights_v1", profileId: "flat-v1-gen-0008" },
  modelId: "flat-g0008-20260721T120000Z-a1b2",
  displayName: "Flat baseline",
});
const allspin = createModelEnvelope({
  family: "allspin",
  generation: 3,
  payloadFormat: "tetraflux_allspin_weights_v1",
  payload: { format: "tetraflux_allspin_weights_v1", profileId: "allspin-g0003" },
  modelId: "allspin-g0003-20260721T130000Z-c3d4",
  parentModelId: flat.modelId,
  displayName: "Derived All-Spin",
});

const bundle = createLocalModelLibraryBundle({
  models: [flat, allspin],
  active: { flat: flat.modelId, allspin: allspin.modelId },
  exportedAt: "2026-07-21T13:00:00.000Z",
});
const parsed = parseLocalModelLibrary(JSON.parse(JSON.stringify(bundle)));
assert.equal(parsed.models.length, 2);
assert.equal(parsed.active.flat, flat.modelId);
assert.equal(parsed.active.allspin, allspin.modelId);
assert.equal(parsed.models[1]?.parentModelId, flat.modelId);

const single = parseLocalModelLibrary(parseModelEnvelope(flat));
assert.equal(single.models.length, 1);
assert.equal(single.active.flat, flat.modelId);

const missingActive = createLocalModelLibraryBundle({
  models: [flat],
  active: { allspin: "allspin-missing-model" },
});
assert.equal(missingActive.active.allspin, undefined);

console.log("local model library fixture: ok");
