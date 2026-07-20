import {
  getLatestModel,
  json,
  modelsBinding,
  parseFamily,
} from "../../../_lib/modelStore.js";

export async function onRequestGet(context) {
  try {
    const family = parseFamily(context.params.family);
    if (!family) return json({ error: "family must be flat or allspin" }, 400);
    const model = await getLatestModel(modelsBinding(context.env), family);
    if (!model) return json({ error: "No model has been uploaded for this family" }, 404);
    return json(model, 200, { "Cache-Control": "public, max-age=30" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 503);
  }
}
