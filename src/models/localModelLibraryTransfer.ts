import {
  MODEL_STORE_NAME,
  clearDbStore,
  readAllDbRecords,
  writeDbRecords,
} from "../storage/browserDatabase";
import {
  readActiveLocalModelId,
  setActiveLocalModelId,
} from "./localModelLibrary";
import {
  createLocalModelLibraryBundle,
  parseLocalModelLibrary,
  type LocalModelLibraryBundleV1,
} from "./modelLibraryBundle";
import {
  parseModelEnvelope,
  type ModelEnvelopeV1,
  type ModelFamily,
} from "./modelEnvelope";

export async function exportLocalModelLibrary(): Promise<LocalModelLibraryBundleV1> {
  const raw = await readAllDbRecords<unknown>(MODEL_STORE_NAME);
  const models: ModelEnvelopeV1[] = [];
  for (const item of raw) {
    try { models.push(parseModelEnvelope(item)); } catch { /* ignore corrupt records */ }
  }
  models.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.modelId.localeCompare(b.modelId));
  const active: Partial<Record<ModelFamily, string>> = {};
  const flat = await readActiveLocalModelId("flat");
  const allspin = await readActiveLocalModelId("allspin");
  if (flat) active.flat = flat;
  if (allspin) active.allspin = allspin;
  return createLocalModelLibraryBundle({ models, active });
}

export async function importLocalModelLibrary(
  input: unknown,
  options: { replace?: boolean; restoreActive?: boolean } = {},
): Promise<LocalModelLibraryBundleV1> {
  const bundle = parseLocalModelLibrary(input);
  if (options.replace) {
    await clearDbStore(MODEL_STORE_NAME);
    await setActiveLocalModelId("flat", null);
    await setActiveLocalModelId("allspin", null);
  }
  const written = await writeDbRecords(MODEL_STORE_NAME, bundle.models);
  if (!written && bundle.models.length > 0) throw new Error("IndexedDB model storage is unavailable");
  if (options.restoreActive !== false) {
    if (bundle.active.flat) await setActiveLocalModelId("flat", bundle.active.flat);
    if (bundle.active.allspin) await setActiveLocalModelId("allspin", bundle.active.allspin);
  }
  return bundle;
}

export async function clearLocalModelLibrary(): Promise<void> {
  await clearDbStore(MODEL_STORE_NAME);
  await setActiveLocalModelId("flat", null);
  await setActiveLocalModelId("allspin", null);
}
