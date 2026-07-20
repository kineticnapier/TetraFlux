import { HeuristicAI } from "../ai/heuristic";

export const HEURISTIC_FEATURE_SET = "flat-14-v1" as const;
export const HEURISTIC_PROFILE_FORMAT = "tetraflux_heuristic_weights_v1" as const;

export const HEURISTIC_WEIGHT_KEYS = [
  "holeWeight",
  "coveredHoleWeight",
  "heightWeight",
  "maxHeightWeight",
  "centerTowerWeight",
  "bumpWeight",
  "wellWeight",
  "lineBonus",
  "attackBonus",
  "holdPenalty",
  "newHolePenaltyWeight",
  "maxHeightRisePenaltyWeight",
  "bumpRisePenaltyWeight",
  "centerTowerRisePenaltyWeight",
] as const;

export type HeuristicWeightKey = typeof HEURISTIC_WEIGHT_KEYS[number];
export type HeuristicWeightVector = Record<HeuristicWeightKey, number>;

export interface HeuristicWeightProfileV1 {
  format: typeof HEURISTIC_PROFILE_FORMAT;
  schemaVersion: 1;
  profileId: string;
  featureSet: typeof HEURISTIC_FEATURE_SET;
  scoreDirection: "min";
  createdAt: string;
  weights: HeuristicWeightVector;
  training?: {
    algorithm?: string;
    generation?: number;
    masterSeed?: number;
    fitness?: number;
  };
  validation?: Record<string, number | boolean | string>;
}

export const HEURISTIC_WEIGHT_LIMITS: Record<HeuristicWeightKey, { min: number; max: number }> = {
  holeWeight: { min: 0.1, max: 50 },
  coveredHoleWeight: { min: 0, max: 20 },
  heightWeight: { min: 0, max: 20 },
  maxHeightWeight: { min: 0, max: 30 },
  centerTowerWeight: { min: 0, max: 30 },
  bumpWeight: { min: 0, max: 20 },
  wellWeight: { min: -10, max: 20 },
  lineBonus: { min: -20, max: 30 },
  attackBonus: { min: -20, max: 50 },
  holdPenalty: { min: 0, max: 20 },
  newHolePenaltyWeight: { min: 0, max: 80 },
  maxHeightRisePenaltyWeight: { min: 0, max: 50 },
  bumpRisePenaltyWeight: { min: 0, max: 40 },
  centerTowerRisePenaltyWeight: { min: 0, max: 40 },
};

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampWeight(key: HeuristicWeightKey, value: unknown, fallback: number): number {
  const limits = HEURISTIC_WEIGHT_LIMITS[key];
  return Math.max(limits.min, Math.min(limits.max, finite(value, fallback)));
}

export function readHeuristicWeights(ai = new HeuristicAI()): HeuristicWeightVector {
  const out = {} as HeuristicWeightVector;
  for (const key of HEURISTIC_WEIGHT_KEYS) out[key] = Number(ai[key]);
  return out;
}

export const DEFAULT_HEURISTIC_WEIGHTS: HeuristicWeightVector = readHeuristicWeights();

export function normalizeHeuristicWeights(
  input?: Partial<Record<HeuristicWeightKey, unknown>>,
  fallback: HeuristicWeightVector = DEFAULT_HEURISTIC_WEIGHTS,
): HeuristicWeightVector {
  const out = {} as HeuristicWeightVector;
  for (const key of HEURISTIC_WEIGHT_KEYS) out[key] = clampWeight(key, input?.[key], fallback[key]);
  return out;
}

export function applyHeuristicWeights(ai: HeuristicAI, input: Partial<Record<HeuristicWeightKey, unknown>>): HeuristicWeightVector {
  const normalized = normalizeHeuristicWeights(input, readHeuristicWeights(ai));
  for (const key of HEURISTIC_WEIGHT_KEYS) ai[key] = normalized[key];
  return normalized;
}

export function createHeuristicWeightProfile(
  weights: Partial<Record<HeuristicWeightKey, unknown>>,
  metadata: Partial<Omit<HeuristicWeightProfileV1, "format" | "schemaVersion" | "featureSet" | "scoreDirection" | "weights" | "createdAt">> & { createdAt?: string } = {},
): HeuristicWeightProfileV1 {
  const createdAt = metadata.createdAt ?? new Date().toISOString();
  const profileId = metadata.profileId ?? `flat-v1-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
  return {
    format: HEURISTIC_PROFILE_FORMAT,
    schemaVersion: 1,
    profileId,
    featureSet: HEURISTIC_FEATURE_SET,
    scoreDirection: "min",
    createdAt,
    weights: normalizeHeuristicWeights(weights),
    training: metadata.training,
    validation: metadata.validation,
  };
}

export function parseHeuristicWeightProfile(input: unknown): HeuristicWeightProfileV1 {
  if (!input || typeof input !== "object") throw new Error("Heuristic profile must be an object");
  const raw = input as Record<string, unknown>;
  if (raw.format !== HEURISTIC_PROFILE_FORMAT) throw new Error(`Unsupported heuristic profile format: ${String(raw.format ?? "missing")}`);
  if (raw.featureSet !== HEURISTIC_FEATURE_SET) throw new Error(`Unsupported heuristic feature set: ${String(raw.featureSet ?? "missing")}`);
  const profile = createHeuristicWeightProfile(
    (raw.weights && typeof raw.weights === "object" ? raw.weights : {}) as Partial<Record<HeuristicWeightKey, unknown>>,
    {
      profileId: String(raw.profileId ?? "imported-flat-v1"),
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      training: raw.training && typeof raw.training === "object" ? raw.training as HeuristicWeightProfileV1["training"] : undefined,
      validation: raw.validation && typeof raw.validation === "object" ? raw.validation as Record<string, number | boolean | string> : undefined,
    },
  );
  return profile;
}

export function applyHeuristicWeightProfile(ai: HeuristicAI, profileInput: unknown): HeuristicWeightProfileV1 {
  const profile = parseHeuristicWeightProfile(profileInput);
  applyHeuristicWeights(ai, profile.weights);
  return profile;
}
