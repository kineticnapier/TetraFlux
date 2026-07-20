import {
  json,
  latestMap,
  modelsBinding,
  parseFamily,
  readIndex,
  requireWriteAuthorization,
  saveModel,
  validateModel,
} from "../../_lib/modelStore.js";

export async function onRequestGet(context) {
  try {
    const kv = modelsBinding(context.env);
    const requestedFamily = new URL(context.request.url).searchParams.get("family");
    const family = requestedFamily ? parseFamily(requestedFamily) : null;
    if (requestedFamily && !family) return json({ error: "family must be flat or allspin" }, 400);
    const models = family
      ? await readIndex(kv, family)
      : (await Promise.all([readIndex(kv, "flat"), readIndex(kv, "allspin")])).flat?.concat?.([]) ?? [];
    const combined = family
      ? models
      : (await Promise.all([readIndex(kv, "flat"), readIndex(kv, "allspin")]))
        .flatMap((items) => items)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return json({ models: combined, latest: await latestMap(kv) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 503);
  }
}

export async function onRequestPost(context) {
  const authError = requireWriteAuthorization(context.request, context.env);
  if (authError) return authError;
  try {
    const kv = modelsBinding(context.env);
    const length = Number(context.request.headers.get("Content-Length") ?? 0);
    if (length > 1_000_000) return json({ error: "Model payload is too large" }, 413);
    const model = validateModel(await context.request.json());
    return json(await saveModel(kv, model), 201);
  } catch (error) {
    const status = Number(error?.status) || 400;
    return json({ error: error instanceof Error ? error.message : String(error) }, status);
  }
}
