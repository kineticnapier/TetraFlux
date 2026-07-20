import { getModel, json, modelsBinding } from "../../_lib/modelStore.js";

export async function onRequestGet(context) {
  try {
    const modelId = String(context.params.modelId ?? "");
    if (!/^[a-z0-9][a-z0-9-]{2,95}$/.test(modelId)) return json({ error: "Invalid model ID" }, 400);
    const model = await getModel(modelsBinding(context.env), modelId);
    if (!model) return json({ error: "Model not found" }, 404);
    return json(model, 200, { "Cache-Control": "public, max-age=60" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 503);
  }
}
