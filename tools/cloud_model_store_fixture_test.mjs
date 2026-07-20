import assert from "node:assert/strict";
import {
  getLatestModel,
  getModel,
  latestMap,
  readIndex,
  saveModel,
  validateModel,
} from "../functions/_lib/modelStore.js";

class MockKv {
  constructor() {
    this.values = new Map();
  }

  async get(key, type) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }
}

function model(modelId, family, generation, payloadFormat) {
  return validateModel({
    format: "tetraflux_model_envelope_v1",
    schemaVersion: 1,
    modelId,
    family,
    displayName: `${family} G${generation}`,
    createdAt: `2026-07-21T00:00:0${generation}.000Z`,
    generation,
    payloadFormat,
    payload: { format: payloadFormat, schemaVersion: 1 },
  });
}

const kv = new MockKv();
const flat1 = model("flat-g0001-fixture", "flat", 1, "tetraflux_heuristic_weights_v1");
const flat2 = model("flat-g0002-fixture", "flat", 2, "tetraflux_heuristic_weights_v1");
const allspin1 = model("allspin-g0001-fixture", "allspin", 1, "tetraflux_allspin_weights_v1");
allspin1.parentModelId = flat2.modelId;

await saveModel(kv, flat1);
await saveModel(kv, flat2);
await saveModel(kv, allspin1);

assert.equal((await getModel(kv, flat1.modelId)).modelId, flat1.modelId);
assert.equal((await getLatestModel(kv, "flat")).modelId, flat2.modelId);
assert.equal((await getLatestModel(kv, "allspin")).parentModelId, flat2.modelId);
assert.deepEqual((await readIndex(kv, "flat")).map((item) => item.modelId), [flat2.modelId, flat1.modelId]);
assert.deepEqual(await latestMap(kv), { flat: flat2.modelId, allspin: allspin1.modelId });

await assert.rejects(() => saveModel(kv, flat1), /already exists/);
assert.throws(() => validateModel({ ...flat1, modelId: "INVALID ID" }), /Invalid modelId/);
assert.throws(() => validateModel({ ...flat1, payloadFormat: "wrong" }), /payloadFormat/);

console.log("cloud model store fixture: ok");
