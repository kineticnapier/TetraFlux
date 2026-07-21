import {
  META_STORE_NAME,
  MODEL_STORE_NAME,
  clearDbStore,
  deleteDbRecord,
  readAllDbRecords,
  readDbRecord,
  writeDbRecord,
  writeDbRecords,
} from "../storage/browserDatabase";
import {
  createModelEnvelope,
  modelSummary,
  parseModelEnvelope,
  type ModelEnvelopeV1,
  type ModelFamily,
  type ModelSummary,
} from "./modelEnvelope";

export const LOCAL_MODEL_LIBRARY_FORMAT = "tetraflux_model_library_v1" as const;
const ACTIVE_MODEL_STORAGE_PREFIX = "tetraflux:activeLocalModel:v1:";
const ACTIVE_META_PREFIX = "active-model:";

export interface LocalModelLibraryBundleV1 {
  format: typeof LOCAL_MODEL_LIBRARY_FORMAT;
  schemaVersion: 1;
  exportedAt: string;
  active: Partial<Record<ModelFamily, string>>;
  models: ModelEnvelopeV1[];
}

type MetaRecord = { key: string; value: string; updatedAt: string };

function browserStorage(): Storage | null {
  try {
    return (globalThis as unknown as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function activeStorageKey(family: ModelFamily): string {
  return `${ACTIVE_MODEL_STORAGE_PREFIX}${family}`;
}

function activeMetaKey(family: ModelFamily): string {
  return `${ACTIVE_META_PREFIX}${family}`;
}

export function readActiveLocalModelIdSync(family: ModelFamily): string | null {
  try {
    return browserStorage()?.getItem(activeStorageKey(family)) ?? null;
  } catch {
    return null;
  }
}

export async function readActiveLocalModelId(family: ModelFamily): Promise<string | null> {
  const local = readActiveLocalModelIdSync(family);
  if (local) return local;
  const record = await readDbRecord<MetaRecord>(META_STORE_NAME, activeMetaKey(family));
  const value = record?.value?.trim() || null;
  if (value) {
    try { browserStorage()?.setItem(activeStorageKey(family), value); } catch { /* no-op */ }
  }
  return value;
}

export async function setActiveLocalModelId(family: ModelFamily, modelId: string | null): Promise<void> {
  const normalized = modelId?.trim() || null;
  try {
    const storage = browserStorage();
    if (normalized) storage?.setItem(activeStorageKey(family), normalized);
    else storage?.removeItem(activeStorageKey(family));
  } catch {
    // IndexedDB remains the source of truth.
  }
  if (normalized) {
    await writeDbRecord(META_STORE_NAME, {
      key: activeMetaKey(family),
      value: normalized,
      updatedAt: new Date().toISOString(),
    } satisfies MetaRecord);
  } else {
    await deleteDbRecord(META_STORE_NAME, activeMetaKey(family));
  }
}

export async function saveLocalModel(input: unknown, setActive = false): Promise<ModelEnvelopeV1> {
  const model = parseModelEnvelope(input);
  const saved = await writeDbRecord(MODEL_STORE_NAME, model);
  if (!saved) throw new Error("IndexedDB model storage is unavailable");
  if (setActive) await setActiveLocalModelId(model.family, model.modelId);
  return model;
}

export async function getLocalModel(modelId: string): Promise<ModelEnvelopeV1 | null> {
  const raw = await readDbRecord<unknown>(MODEL_STORE_NAME, modelId);
  if (!raw) return null;
  try { return parseModelEnvelope(raw); } catch { return null; }
}

export async function listLocalModels(family?: ModelFamily): Promise<ModelSummary[]> {
  const raw = await readAllDbRecords<unknown>(MODEL_STORE_NAME);
  const models: ModelEnvelopeV1[] = [];
  for (const item of raw) {
    try {
      const model = parseModelEnvelope(item);
      if (!family || model.family === family) models.push(model);
    } catch {
      // Ignore corrupt records.
    }
  }
  return models
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.modelId.localeCompare(a.modelId))
    .map(modelSummary);
}

export async function renameLocalModel(modelId: string, displayName: string): Promise<ModelEnvelopeV1> {
  const model = await getLocalModel(modelId);
  if (!model) throw new Error(`Local model not found: ${modelId}`);
  const name = displayName.trim();
  if (!name) throw new Error("Display name cannot be empty");
  return saveLocalModel({ ...model, displayName: name });
}

export async function deleteLocalModel(modelId: string): Promise<boolean> {
  const model = await getLocalModel(modelId);
  if (!model) return false;
  const deleted = await deleteDbRecord(MODEL_STORE_NAME, modelId);
  if (readActiveLocalModelIdSync(model.family) === modelId) {
    await setActiveLocalModelId(model.family, null);
  }
  return deleted;
}

export function wrapModelPayload<T>(input: {
  family: ModelFamily;
  generation?: number;
  payloadFormat: string;
  payload: T;
  parentModelId?: string;
  displayName?: string;
  notes?: string;
}): ModelEnvelopeV1<T> {
  return createModelEnvelope(input);
}

export { clearDbStore, writeDbRecords };
