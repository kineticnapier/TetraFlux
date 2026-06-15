export interface BenchmarkTuningConfig {
  enabled: boolean;

  // Shared heuristic weights. These are applied to every AI object that exposes
  // compatible fields, including LookaheadAI because it extends HeuristicAI.
  holeWeight?: number;
  coveredHoleWeight?: number;
  heightWeight?: number;
  maxHeightWeight?: number;
  bumpWeight?: number;
  wellWeight?: number;
  lineBonus?: number;
  attackBonus?: number;
  spinPotentialBonus?: number;
  spinClassificationBonus?: number;
  holdPenalty?: number;
  newHolePenaltyWeight?: number;
  maxHeightRisePenaltyWeight?: number;
  bumpRisePenaltyWeight?: number;
  centerTowerRisePenaltyWeight?: number;
  wastedTPenalty?: number;
  slotDestroyedPenalty?: number;
  nearReadySpinSlotBonus?: number;

  // Pressure modules.
  useGarbagePressure?: boolean;
  garbagePressureSensitivity?: number;
  useGarbageHoleTracking?: boolean;
  garbageHoleSensitivity?: number;
  useB2BPressure?: boolean;
  b2bPressureSensitivity?: number;

  // Lookahead / twist options. These only affect AIs with a lookaheadOptions bag.
  depth?: number;
  beamWidth?: number;
  includeHold?: boolean;
  spinBias?: number;
  maxCandidatesPerNode?: number;
  maxNodesPerDepth?: number;
  timeBudgetMs?: number;
  includeTwists?: boolean;
  maxTwistCandidates?: number;
  twistTimeBudgetMs?: number;
  twistBias?: number;
}

export type BenchmarkTuningKey = Exclude<keyof BenchmarkTuningConfig, "enabled">;

const NUMBER_LIMITS: Record<string, { min: number; max: number; integer?: boolean }> = {
  holeWeight: { min: 0, max: 50 },
  coveredHoleWeight: { min: 0, max: 20 },
  heightWeight: { min: 0, max: 20 },
  maxHeightWeight: { min: 0, max: 30 },
  bumpWeight: { min: 0, max: 20 },
  wellWeight: { min: -10, max: 20 },
  lineBonus: { min: -20, max: 30 },
  attackBonus: { min: -20, max: 50 },
  spinPotentialBonus: { min: -20, max: 30 },
  spinClassificationBonus: { min: -20, max: 30 },
  holdPenalty: { min: 0, max: 20 },
  newHolePenaltyWeight: { min: 0, max: 80 },
  maxHeightRisePenaltyWeight: { min: 0, max: 50 },
  bumpRisePenaltyWeight: { min: 0, max: 40 },
  centerTowerRisePenaltyWeight: { min: 0, max: 40 },
  wastedTPenalty: { min: 0, max: 50 },
  slotDestroyedPenalty: { min: 0, max: 50 },
  nearReadySpinSlotBonus: { min: -20, max: 40 },
  garbagePressureSensitivity: { min: 0, max: 5 },
  garbageHoleSensitivity: { min: 0, max: 5 },
  b2bPressureSensitivity: { min: 0, max: 5 },
  depth: { min: 1, max: 6, integer: true },
  beamWidth: { min: 1, max: 400, integer: true },
  spinBias: { min: 0, max: 5 },
  maxCandidatesPerNode: { min: 1, max: 200, integer: true },
  maxNodesPerDepth: { min: 1, max: 2000, integer: true },
  timeBudgetMs: { min: 0.5, max: 100 },
  maxTwistCandidates: { min: 0, max: 80, integer: true },
  twistTimeBudgetMs: { min: 0, max: 50 },
  twistBias: { min: 0, max: 5 },
};

const HEURISTIC_NUMBER_KEYS = [
  "holeWeight",
  "coveredHoleWeight",
  "heightWeight",
  "maxHeightWeight",
  "bumpWeight",
  "wellWeight",
  "lineBonus",
  "attackBonus",
  "spinPotentialBonus",
  "spinClassificationBonus",
  "holdPenalty",
  "newHolePenaltyWeight",
  "maxHeightRisePenaltyWeight",
  "bumpRisePenaltyWeight",
  "centerTowerRisePenaltyWeight",
  "wastedTPenalty",
  "slotDestroyedPenalty",
  "nearReadySpinSlotBonus",
  "garbagePressureSensitivity",
  "garbageHoleSensitivity",
  "b2bPressureSensitivity",
] as const;

const HEURISTIC_BOOL_KEYS = [
  "useGarbagePressure",
  "useGarbageHoleTracking",
  "useB2BPressure",
] as const;

const LOOKAHEAD_NUMBER_KEYS = [
  "depth",
  "beamWidth",
  "spinBias",
  "maxCandidatesPerNode",
  "maxNodesPerDepth",
  "timeBudgetMs",
  "maxTwistCandidates",
  "twistTimeBudgetMs",
  "twistBias",
  "garbagePressureSensitivity",
  "garbageHoleSensitivity",
  "b2bPressureSensitivity",
] as const;

const LOOKAHEAD_BOOL_KEYS = [
  "includeHold",
  "includeTwists",
  "useGarbagePressure",
  "useGarbageHoleTracking",
  "useB2BPressure",
] as const;

function numberOrUndefined(value: unknown, key: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const limit = NUMBER_LIMITS[key];
  if (!limit) return n;
  const clamped = Math.max(limit.min, Math.min(limit.max, n));
  return limit.integer ? Math.floor(clamped) : clamped;
}

function boolOrUndefined(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(s)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(s)) return false;
  return undefined;
}

export function normalizeBenchmarkTuningConfig(input?: Partial<BenchmarkTuningConfig>): BenchmarkTuningConfig {
  const enabled = boolOrUndefined(input?.enabled) ?? false;
  const out: BenchmarkTuningConfig = { enabled };
  for (const key of Object.keys(NUMBER_LIMITS) as BenchmarkTuningKey[]) {
    const value = numberOrUndefined(input?.[key], key);
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  for (const key of [...HEURISTIC_BOOL_KEYS, ...LOOKAHEAD_BOOL_KEYS] as BenchmarkTuningKey[]) {
    const value = boolOrUndefined(input?.[key]);
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

export function benchmarkTuningSummary(input?: Partial<BenchmarkTuningConfig>): string {
  const config = normalizeBenchmarkTuningConfig(input);
  if (!config.enabled) return "AI tuning overrides: OFF";
  const changed = Object.entries(config).filter(([key, value]) => key !== "enabled" && value !== undefined);
  if (changed.length === 0) return "AI tuning overrides: ON, but no fields are overridden";
  return `AI tuning overrides: ${changed.map(([key, value]) => `${key}=${value}`).join(", ")}`;
}

function assignNumber(target: Record<string, unknown>, key: string, value: unknown): void {
  const n = numberOrUndefined(value, key);
  if (n !== undefined) target[key] = n;
}

function assignBoolean(target: Record<string, unknown>, key: string, value: unknown): void {
  const b = boolOrUndefined(value);
  if (b !== undefined) target[key] = b;
}

export function applyBenchmarkTuningToAi(ai: unknown, input?: Partial<BenchmarkTuningConfig>): void {
  const config = normalizeBenchmarkTuningConfig(input);
  if (!config.enabled || !ai || typeof ai !== "object") return;
  const target = ai as Record<string, unknown>;

  for (const key of HEURISTIC_NUMBER_KEYS) assignNumber(target, key, config[key]);
  for (const key of HEURISTIC_BOOL_KEYS) assignBoolean(target, key, config[key]);

  const lookaheadOptions = target.lookaheadOptions;
  if (lookaheadOptions && typeof lookaheadOptions === "object") {
    const options = lookaheadOptions as Record<string, unknown>;
    for (const key of LOOKAHEAD_NUMBER_KEYS) assignNumber(options, key, config[key]);
    for (const key of LOOKAHEAD_BOOL_KEYS) assignBoolean(options, key, config[key]);

    // LookaheadAI copies pressure values into inherited HeuristicAI fields in its
    // constructor, so mirror changed values back onto the instance too.
    for (const key of ["garbagePressureSensitivity", "garbageHoleSensitivity", "b2bPressureSensitivity"] as const) {
      assignNumber(target, key, config[key]);
    }
    for (const key of ["useGarbagePressure", "useGarbageHoleTracking", "useB2BPressure"] as const) {
      assignBoolean(target, key, config[key]);
    }
  }
}

export function benchmarkTuningChangedKeys(input?: Partial<BenchmarkTuningConfig>): string[] {
  const config = normalizeBenchmarkTuningConfig(input);
  if (!config.enabled) return [];
  return Object.keys(config).filter((key) => key !== "enabled" && (config as unknown as Record<string, unknown>)[key] !== undefined).sort();
}
