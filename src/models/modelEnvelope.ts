export const MODEL_ENVELOPE_FORMAT = "tetraflux_model_envelope_v1" as const;
export type ModelFamily = "flat" | "allspin";
export type ModelEnvelopeV1<T = unknown> = {
  format: typeof MODEL_ENVELOPE_FORMAT;
  schemaVersion: 1;
  modelId: string;
  family: ModelFamily;
  displayName: string;
  createdAt: string;
  generation: number;
  parentModelId?: string;
  payloadFormat: string;
  payload: T;
  notes?: string;
};
export type ModelSummary = Omit<ModelEnvelopeV1, "format" | "schemaVersion" | "payload" | "notes">;
export type CloudModelSummary = ModelSummary;

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const suffix = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");

export function modelFamilyLabel(family: ModelFamily): string {
  return family === "flat" ? "Flat Heuristic" : "All-Spin";
}

export function createReadableModelId(family: ModelFamily, generation: number, date = new Date()): string {
  return `${family}-g${Math.max(0, Math.floor(generation)).toString().padStart(4, "0")}-${stamp(date)}-${suffix()}`;
}

export function createModelEnvelope<T>(input: {
  family: ModelFamily;
  generation?: number;
  payloadFormat: string;
  payload: T;
  modelId?: string;
  displayName?: string;
  createdAt?: string;
  parentModelId?: string;
  notes?: string;
}): ModelEnvelopeV1<T> {
  const generation = Math.max(0, Math.floor(Number(input.generation) || 0));
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    format: MODEL_ENVELOPE_FORMAT,
    schemaVersion: 1,
    modelId: input.modelId ?? createReadableModelId(input.family, generation, new Date(createdAt)),
    family: input.family,
    displayName: input.displayName ?? `${modelFamilyLabel(input.family)} G${generation}`,
    createdAt,
    generation,
    parentModelId: input.parentModelId,
    payloadFormat: input.payloadFormat,
    payload: input.payload,
    notes: input.notes,
  };
}

export function parseModelEnvelope<T = unknown>(input: unknown): ModelEnvelopeV1<T> {
  if (!input || typeof input !== "object") throw new Error("Model envelope must be an object");
  const raw = input as Record<string, unknown>;
  if (raw.format !== MODEL_ENVELOPE_FORMAT) throw new Error("Unsupported model envelope");
  if (raw.family !== "flat" && raw.family !== "allspin") throw new Error("Unsupported model family");
  if (!raw.payload || typeof raw.payload !== "object") throw new Error("Model payload is missing");
  const modelId = String(raw.modelId ?? "").trim();
  if (!modelId || modelId.length > 96) throw new Error("Invalid model ID");
  return {
    format: MODEL_ENVELOPE_FORMAT,
    schemaVersion: 1,
    modelId,
    family: raw.family,
    displayName: String(raw.displayName ?? modelId),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    generation: Math.max(0, Math.floor(Number(raw.generation) || 0)),
    parentModelId: typeof raw.parentModelId === "string" ? raw.parentModelId : undefined,
    payloadFormat: String(raw.payloadFormat ?? "unknown"),
    payload: raw.payload as T,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
  };
}

export function modelSummary(model: ModelEnvelopeV1): ModelSummary {
  const { modelId, family, displayName, createdAt, generation, parentModelId, payloadFormat } = model;
  return { modelId, family, displayName, createdAt, generation, parentModelId, payloadFormat };
}
