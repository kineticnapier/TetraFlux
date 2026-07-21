import {
  parseModelEnvelope,
  type ModelEnvelopeV1,
  type ModelFamily,
} from "./modelEnvelope";

export const LOCAL_MODEL_LIBRARY_FORMAT = "tetraflux_model_library_v1" as const;

export interface LocalModelLibraryBundleV1 {
  format: typeof LOCAL_MODEL_LIBRARY_FORMAT;
  schemaVersion: 1;
  exportedAt: string;
  active: Partial<Record<ModelFamily, string>>;
  models: ModelEnvelopeV1[];
}

export function createLocalModelLibraryBundle(input: {
  models: ModelEnvelopeV1[];
  active?: Partial<Record<ModelFamily, string>>;
  exportedAt?: string;
}): LocalModelLibraryBundleV1 {
  const models = input.models.map((model) => parseModelEnvelope(model));
  const ids = new Set(models.map((model) => model.modelId));
  const active: Partial<Record<ModelFamily, string>> = {};
  for (const family of ["flat", "allspin"] as const) {
    const modelId = input.active?.[family]?.trim();
    if (modelId && ids.has(modelId)) active[family] = modelId;
  }
  return {
    format: LOCAL_MODEL_LIBRARY_FORMAT,
    schemaVersion: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    active,
    models,
  };
}

export function parseLocalModelLibrary(input: unknown): LocalModelLibraryBundleV1 {
  if (input && typeof input === "object" && (input as Record<string, unknown>).format === "tetraflux_model_envelope_v1") {
    const model = parseModelEnvelope(input);
    return createLocalModelLibraryBundle({
      models: [model],
      active: { [model.family]: model.modelId },
    });
  }
  if (!input || typeof input !== "object") throw new Error("Model library must be an object");
  const raw = input as Record<string, unknown>;
  if (raw.format !== LOCAL_MODEL_LIBRARY_FORMAT) {
    throw new Error(`Unsupported model library: ${String(raw.format ?? "missing")}`);
  }
  const models = Array.isArray(raw.models) ? raw.models.map((item) => parseModelEnvelope(item)) : [];
  const activeRaw = raw.active && typeof raw.active === "object"
    ? raw.active as Partial<Record<ModelFamily, string>>
    : {};
  return createLocalModelLibraryBundle({
    models,
    active: activeRaw,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : undefined,
  });
}
