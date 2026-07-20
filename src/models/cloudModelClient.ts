import {
  createModelEnvelope,
  parseModelEnvelope,
  type CloudModelSummary,
  type ModelEnvelopeV1,
  type ModelFamily,
} from "./modelEnvelope";

const CLOUD_TOKEN_SESSION_KEY = "tetraflux:cloudModelWriteToken:v1";
const ACTIVE_MODEL_STORAGE_PREFIX = "tetraflux:activeCloudModel:v1:";

export interface CloudModelListResponse {
  models: CloudModelSummary[];
  latest: Partial<Record<ModelFamily, string>>;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 240));
  }
}

async function requireOk(response: Response): Promise<unknown> {
  const body = await readJsonResponse(response);
  if (!response.ok) {
    const message = body && typeof body === "object"
      ? String((body as Record<string, unknown>).error ?? response.statusText)
      : response.statusText;
    throw new Error(`Cloud model request failed (${response.status}): ${message}`);
  }
  return body;
}

export function readCloudModelWriteToken(): string {
  try {
    return sessionStorage.getItem(CLOUD_TOKEN_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeCloudModelWriteToken(token: string): void {
  try {
    if (token.trim()) sessionStorage.setItem(CLOUD_TOKEN_SESSION_KEY, token.trim());
    else sessionStorage.removeItem(CLOUD_TOKEN_SESSION_KEY);
  } catch {
    // Session storage is optional. The caller still keeps the input value.
  }
}

export function readActiveCloudModelId(family: ModelFamily): string | null {
  try {
    return localStorage.getItem(`${ACTIVE_MODEL_STORAGE_PREFIX}${family}`);
  } catch {
    return null;
  }
}

export function storeActiveCloudModelId(family: ModelFamily, modelId: string | null): void {
  try {
    const key = `${ACTIVE_MODEL_STORAGE_PREFIX}${family}`;
    if (modelId) localStorage.setItem(key, modelId);
    else localStorage.removeItem(key);
  } catch {
    // Local browser storage is optional.
  }
}

export async function listCloudModels(family?: ModelFamily): Promise<CloudModelListResponse> {
  const query = family ? `?family=${encodeURIComponent(family)}` : "";
  const response = await fetch(`/api/models/${query}`, { cache: "no-store" });
  const body = await requireOk(response);
  const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    models: Array.isArray(raw.models) ? raw.models as CloudModelSummary[] : [],
    latest: raw.latest && typeof raw.latest === "object"
      ? raw.latest as Partial<Record<ModelFamily, string>>
      : {},
  };
}

export async function fetchCloudModel(modelId: string): Promise<ModelEnvelopeV1> {
  const response = await fetch(`/api/models/${encodeURIComponent(modelId)}`, { cache: "no-store" });
  return parseModelEnvelope(await requireOk(response));
}

export async function fetchLatestCloudModel(family: ModelFamily): Promise<ModelEnvelopeV1 | null> {
  const response = await fetch(`/api/models/latest/${encodeURIComponent(family)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  return parseModelEnvelope(await requireOk(response));
}

export async function uploadCloudModel(
  modelInput: ModelEnvelopeV1,
  token = readCloudModelWriteToken(),
): Promise<ModelEnvelopeV1> {
  const model = parseModelEnvelope(modelInput);
  if (!token.trim()) throw new Error("Cloud model write token is required");
  storeCloudModelWriteToken(token);
  const response = await fetch("/api/models/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.trim()}`,
    },
    body: JSON.stringify(model),
  });
  const saved = parseModelEnvelope(await requireOk(response));
  storeActiveCloudModelId(saved.family, saved.modelId);
  return saved;
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
