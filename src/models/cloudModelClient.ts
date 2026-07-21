import {
  getLocalModel,
  listLocalModels,
  readActiveLocalModelId,
  readActiveLocalModelIdSync,
  saveLocalModel,
  setActiveLocalModelId,
  wrapModelPayload,
} from "./localModelLibrary";
import {
  type ModelEnvelopeV1,
  type ModelFamily,
  type ModelSummary,
} from "./modelEnvelope";

export interface CloudModelListResponse {
  models: ModelSummary[];
  latest: Partial<Record<ModelFamily, string>>;
}

/** Legacy compatibility: local-only mode has no write token. */
export function readCloudModelWriteToken(): string {
  return "";
}

/** Legacy compatibility: tokens are intentionally ignored in local-only mode. */
export function storeCloudModelWriteToken(_token: string): void {
  // no-op
}

export function readActiveCloudModelId(family: ModelFamily): string | null {
  return readActiveLocalModelIdSync(family);
}

export function storeActiveCloudModelId(family: ModelFamily, modelId: string | null): void {
  void setActiveLocalModelId(family, modelId);
}

export async function listCloudModels(family?: ModelFamily): Promise<CloudModelListResponse> {
  const models = await listLocalModels(family);
  const latest: Partial<Record<ModelFamily, string>> = {};
  const families = family ? [family] : ["flat", "allspin"] as const;
  for (const item of families) {
    const active = await readActiveLocalModelId(item);
    if (active) latest[item] = active;
  }
  return { models, latest };
}

export async function fetchCloudModel(modelId: string): Promise<ModelEnvelopeV1> {
  const model = await getLocalModel(modelId);
  if (!model) throw new Error(`Local model not found: ${modelId}`);
  return model;
}

export async function fetchLatestCloudModel(family: ModelFamily): Promise<ModelEnvelopeV1 | null> {
  const active = await readActiveLocalModelId(family);
  if (active) {
    const model = await getLocalModel(active);
    if (model) return model;
  }
  const [latest] = await listLocalModels(family);
  return latest ? getLocalModel(latest.modelId) : null;
}

export async function uploadCloudModel(
  modelInput: ModelEnvelopeV1,
  _token = "",
): Promise<ModelEnvelopeV1> {
  return saveLocalModel(modelInput, true);
}

export { wrapModelPayload };
