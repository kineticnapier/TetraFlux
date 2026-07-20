export const MODEL_ENVELOPE_FORMAT = "tetraflux_model_envelope_v1" as const;

export type ModelFamily = "flat" | "allspin";

export interface ModelEnvelopeV1<T = unknown> {
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
}

export interface CloudModelSummary {
  modelId: string;
  family: ModelFamily;
  displayName: string;
  createdAt: string;
  generation: number;
  parentModelId?: string;
  payloadFormat: string;
}

function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function randomSuffix(): string {
  const values = new Uint16Array(1);
  try {
    crypto.getRandomValues(values);
    return values[0].toString(16).padStart(4, "0");
  } catch {
    return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  }
}

export function modelFamilyLabel(family: ModelFamily): string {
  return family === "flat" ? "Flat Heuristic" : "All-Spin";
}

export function createReadableModelId(
  family: ModelFamily,
  generation: number,
  createdAt = new Date(),
): string {
  const generationPart = `g${Math.max(0, Math.floor(generation)).toString().padStart(4, "0")}`;
  return `${family}-${generationPart}-${compactTimestamp(createdAt)}-${randomSuffix()}`;
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
  const createdDate = new Date(createdAt);
  const modelId = input.modelId ?? createReadableModelId(input.family, generation, createdDate);
  return {
    format: MODEL_ENVELOPE_FORMAT,
    schemaVersion: 1,
    modelId,
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
  if (!input || typeof input !== "object") throw new Error("Cloud model must be an object");
  const raw = input as Record<string, unknown>;
  if (raw.format !== MODEL_ENVELOPE_FORMAT) {
    throw new Error(`Unsupported cloud model envelope: ${String(raw.format ?? "missing")}`);
  }
  if (raw.family !== "flat" && raw.family !== "allspin") {
    throw new Error(`Unsupported model family: ${String(raw.family ?? "missing")}`);
  }
  if (!raw.payload || typeof raw.payload !== "object") throw new Error("Cloud model payload is missing");
  const modelId = String(raw.modelId ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{2,95}$/.test(modelId)) throw new Error("Invalid cloud model ID");
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

export function modelSummary(model: ModelEnvelopeV1): CloudModelSummary {
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
