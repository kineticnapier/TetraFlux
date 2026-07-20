const MODEL_FORMAT = "tetraflux_model_envelope_v1";
const FAMILIES = new Set(["flat", "allspin"]);
const INDEX_LIMIT = 100;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function modelsBinding(env) {
  const binding = env?.MODELS;
  if (!binding || typeof binding.get !== "function" || typeof binding.put !== "function") {
    throw new Error("Cloudflare KV binding MODELS is not configured");
  }
  return binding;
}

export function requireWriteAuthorization(request, env) {
  const expected = String(env?.MODEL_WRITE_TOKEN ?? "");
  if (!expected) return json({ error: "MODEL_WRITE_TOKEN secret is not configured" }, 503);
  const header = request.headers.get("Authorization") ?? "";
  const actual = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!actual || actual !== expected) return json({ error: "Unauthorized" }, 401);
  return null;
}

export function parseFamily(value) {
  const family = String(value ?? "").toLowerCase();
  return FAMILIES.has(family) ? family : null;
}

export function validateModel(input) {
  if (!input || typeof input !== "object") throw new Error("Model must be an object");
  if (input.format !== MODEL_FORMAT) throw new Error(`Unsupported model envelope: ${String(input.format ?? "missing")}`);
  const family = parseFamily(input.family);
  if (!family) throw new Error(`Unsupported model family: ${String(input.family ?? "missing")}`);
  const modelId = String(input.modelId ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{2,95}$/.test(modelId)) throw new Error("Invalid modelId");
  if (!input.payload || typeof input.payload !== "object") throw new Error("Model payload is missing");
  const payloadFormat = String(input.payloadFormat ?? "").trim();
  if (!payloadFormat || payloadFormat !== String(input.payload.format ?? "")) {
    throw new Error("payloadFormat must match payload.format");
  }
  const generation = Math.max(0, Math.floor(Number(input.generation) || 0));
  const createdAt = typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString();
  return {
    format: MODEL_FORMAT,
    schemaVersion: 1,
    modelId,
    family,
    displayName: String(input.displayName ?? modelId).slice(0, 120),
    createdAt,
    generation,
    parentModelId: typeof input.parentModelId === "string" ? input.parentModelId.slice(0, 96) : undefined,
    payloadFormat,
    payload: input.payload,
    notes: typeof input.notes === "string" ? input.notes.slice(0, 1000) : undefined,
  };
}

export function summary(model) {
  return {
    modelId: model.modelId,
    family: model.family,
    displayName: model.displayName,
    createdAt: model.createdAt,
    generation: model.generation,
    parentModelId: model.parentModelId,
    payloadFormat: model.payloadFormat,
  };
}

function modelKey(modelId) {
  return `model:${modelId}`;
}

function indexKey(family) {
  return `index:${family}`;
}

function latestKey(family) {
  return `latest:${family}`;
}

export async function getModel(kv, modelId) {
  return await kv.get(modelKey(modelId), "json");
}

export async function getLatestModel(kv, family) {
  const modelId = await kv.get(latestKey(family));
  if (!modelId) return null;
  return await getModel(kv, modelId);
}

export async function readIndex(kv, family) {
  const items = await kv.get(indexKey(family), "json");
  return Array.isArray(items) ? items : [];
}

export async function saveModel(kv, model) {
  const existing = await getModel(kv, model.modelId);
  if (existing) {
    const error = new Error(`Model ${model.modelId} already exists`);
    error.status = 409;
    throw error;
  }
  const item = summary(model);
  const current = await readIndex(kv, model.family);
  const next = [item, ...current.filter((entry) => entry?.modelId !== model.modelId)]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, INDEX_LIMIT);
  await Promise.all([
    kv.put(modelKey(model.modelId), JSON.stringify(model)),
    kv.put(indexKey(model.family), JSON.stringify(next)),
    kv.put(latestKey(model.family), model.modelId),
  ]);
  return model;
}

export async function latestMap(kv) {
  const [flat, allspin] = await Promise.all([
    kv.get(latestKey("flat")),
    kv.get(latestKey("allspin")),
  ]);
  return {
    ...(flat ? { flat } : {}),
    ...(allspin ? { allspin } : {}),
  };
}
