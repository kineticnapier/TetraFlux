import {
  parseHeuristicWeightProfile,
  type HeuristicWeightProfileV1,
} from "./heuristicWeights";

export const ALLSPIN_FEATURE_SET = "allspin-derived-flat14-10-v1" as const;
export const ALLSPIN_PROFILE_FORMAT = "tetraflux_allspin_weights_v1" as const;

export const ALLSPIN_WEIGHT_KEYS = [
  "baseHeuristicScale",
  "spinClearBonus",
  "spinLineBonus",
  "spinAttackBonus",
  "mechanicalSetupBonus",
  "b2bBonus",
  "spinChainBonus",
  "routeLengthPenalty",
  "highStackPenalty",
  "heightRisePenalty",
] as const;

export type AllSpinWeightKey = typeof ALLSPIN_WEIGHT_KEYS[number];
export type AllSpinWeightVector = Record<AllSpinWeightKey, number>;

export interface AllSpinSearchProfile {
  depth: number;
  beamWidth: number;
  maxExpandedNodes: number;
  maxCandidatesPerNode: number;
  maxTwistCandidates: number;
  maxTwistStates: number;
  maxTwistPathLength: number;
}

export interface AllSpinWeightProfileV1 {
  format: typeof ALLSPIN_PROFILE_FORMAT;
  schemaVersion: 1;
  profileId: string;
  featureSet: typeof ALLSPIN_FEATURE_SET;
  scoreDirection: "min";
  createdAt: string;
  baseHeuristic: HeuristicWeightProfileV1;
  weights: AllSpinWeightVector;
  search: AllSpinSearchProfile;
  training?: {
    algorithm?: string;
    generation?: number;
    masterSeed?: number;
    fitness?: number;
    parentModelId?: string;
  };
  validation?: Record<string, number | boolean | string>;
}

export const DEFAULT_ALLSPIN_WEIGHTS: AllSpinWeightVector = {
  baseHeuristicScale: 1,
  spinClearBonus: 30,
  spinLineBonus: 20,
  spinAttackBonus: 15,
  mechanicalSetupBonus: 2.5,
  b2bBonus: 1.6,
  spinChainBonus: 18,
  routeLengthPenalty: 0.025,
  highStackPenalty: 14,
  heightRisePenalty: 7,
};

export const DEFAULT_ALLSPIN_SEARCH: AllSpinSearchProfile = {
  depth: 2,
  beamWidth: 32,
  maxExpandedNodes: 160,
  maxCandidatesPerNode: 36,
  maxTwistCandidates: 14,
  maxTwistStates: 1600,
  maxTwistPathLength: 44,
};

export const ALLSPIN_WEIGHT_LIMITS: Record<AllSpinWeightKey, { min: number; max: number }> = {
  baseHeuristicScale: { min: 0.1, max: 4 },
  spinClearBonus: { min: 0, max: 200 },
  spinLineBonus: { min: 0, max: 100 },
  spinAttackBonus: { min: 0, max: 100 },
  mechanicalSetupBonus: { min: 0, max: 30 },
  b2bBonus: { min: 0, max: 20 },
  spinChainBonus: { min: 0, max: 80 },
  routeLengthPenalty: { min: 0, max: 2 },
  highStackPenalty: { min: 0, max: 80 },
  heightRisePenalty: { min: 0, max: 50 },
};

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function normalizeAllSpinWeights(
  input?: Partial<Record<AllSpinWeightKey, unknown>>,
  fallback: AllSpinWeightVector = DEFAULT_ALLSPIN_WEIGHTS,
): AllSpinWeightVector {
  const out = {} as AllSpinWeightVector;
  for (const key of ALLSPIN_WEIGHT_KEYS) {
    const limits = ALLSPIN_WEIGHT_LIMITS[key];
    out[key] = Math.max(limits.min, Math.min(limits.max, finite(input?.[key], fallback[key])));
  }
  return out;
}

export function normalizeAllSpinSearch(input: Partial<AllSpinSearchProfile> = {}): AllSpinSearchProfile {
  return {
    depth: intInRange(input.depth, DEFAULT_ALLSPIN_SEARCH.depth, 1, 4),
    beamWidth: intInRange(input.beamWidth, DEFAULT_ALLSPIN_SEARCH.beamWidth, 1, 200),
    maxExpandedNodes: intInRange(input.maxExpandedNodes, DEFAULT_ALLSPIN_SEARCH.maxExpandedNodes, 16, 5000),
    maxCandidatesPerNode: intInRange(input.maxCandidatesPerNode, DEFAULT_ALLSPIN_SEARCH.maxCandidatesPerNode, 4, 160),
    maxTwistCandidates: intInRange(input.maxTwistCandidates, DEFAULT_ALLSPIN_SEARCH.maxTwistCandidates, 0, 80),
    maxTwistStates: intInRange(input.maxTwistStates, DEFAULT_ALLSPIN_SEARCH.maxTwistStates, 100, 12000),
    maxTwistPathLength: intInRange(input.maxTwistPathLength, DEFAULT_ALLSPIN_SEARCH.maxTwistPathLength, 4, 120),
  };
}

export function createAllSpinWeightProfile(input: {
  baseHeuristic: unknown;
  weights?: Partial<Record<AllSpinWeightKey, unknown>>;
  search?: Partial<AllSpinSearchProfile>;
  profileId?: string;
  createdAt?: string;
  training?: AllSpinWeightProfileV1["training"];
  validation?: AllSpinWeightProfileV1["validation"];
}): AllSpinWeightProfileV1 {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const generation = Math.max(0, Math.floor(Number(input.training?.generation) || 0));
  return {
    format: ALLSPIN_PROFILE_FORMAT,
    schemaVersion: 1,
    profileId: input.profileId ?? `allspin-g${generation.toString().padStart(4, "0")}-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
    featureSet: ALLSPIN_FEATURE_SET,
    scoreDirection: "min",
    createdAt,
    baseHeuristic: parseHeuristicWeightProfile(input.baseHeuristic),
    weights: normalizeAllSpinWeights(input.weights),
    search: normalizeAllSpinSearch(input.search),
    training: input.training,
    validation: input.validation,
  };
}

export function parseAllSpinWeightProfile(input: unknown): AllSpinWeightProfileV1 {
  if (!input || typeof input !== "object") throw new Error("All-Spin profile must be an object");
  const raw = input as Record<string, unknown>;
  if (raw.format !== ALLSPIN_PROFILE_FORMAT) {
    throw new Error(`Unsupported All-Spin profile format: ${String(raw.format ?? "missing")}`);
  }
  if (raw.featureSet !== ALLSPIN_FEATURE_SET) {
    throw new Error(`Unsupported All-Spin feature set: ${String(raw.featureSet ?? "missing")}`);
  }
  return createAllSpinWeightProfile({
    baseHeuristic: raw.baseHeuristic,
    weights: raw.weights && typeof raw.weights === "object"
      ? raw.weights as Partial<Record<AllSpinWeightKey, unknown>>
      : {},
    search: raw.search && typeof raw.search === "object" ? raw.search as Partial<AllSpinSearchProfile> : {},
    profileId: String(raw.profileId ?? "imported-allspin-v1"),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    training: raw.training && typeof raw.training === "object" ? raw.training as AllSpinWeightProfileV1["training"] : undefined,
    validation: raw.validation && typeof raw.validation === "object" ? raw.validation as AllSpinWeightProfileV1["validation"] : undefined,
  });
}
