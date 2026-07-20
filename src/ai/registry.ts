import { TetrisEngine } from "../engine/tetris";
import {
  applyHeuristicWeightProfile,
  parseHeuristicWeightProfile,
  type HeuristicWeightProfileV1,
} from "../training/heuristicWeights";
import { AllSpinAI } from "./allSpinAI";
import { HeuristicAI, type AiChoice } from "./heuristic";
import { LookaheadAI } from "./lookahead";
import { WebPolicyAI, type WebPolicyJson } from "./webPolicy";
import { WebValueModel, type WebValueJson } from "./webValue";

export interface AiLike {
  choose(engine: TetrisEngine): AiChoice | null;
}

export interface AiFactorySpec {
  id: string;
  name: string;
  make(): AiLike;
}

export interface AiRegistryEntry {
  id: string;
  name: string;
  ai: AiLike;
}

export type LearnedProfileProvider = () => unknown;

class WeightedHeuristicAI extends HeuristicAI {
  variantName: string;

  constructor(name: string, weights: Partial<HeuristicAI> = {}) {
    super();
    this.variantName = name;
    Object.assign(this, weights);
  }
}

class LearnedHeuristicAI extends HeuristicAI {
  readonly profileId: string | null;

  constructor(profileInput?: unknown) {
    super();
    let profile: HeuristicWeightProfileV1 | null = null;
    try {
      profile = profileInput ? parseHeuristicWeightProfile(profileInput) : null;
    } catch {
      profile = null;
    }
    if (profile) applyHeuristicWeightProfile(this, profile);
    this.profileId = profile?.profileId ?? null;
  }

  choose(engine: TetrisEngine): AiChoice | null {
    const choice = super.choose(engine);
    if (!choice) return null;
    return {
      ...choice,
      aiInfo: {
        ...choice.aiInfo,
        learnedHeuristic: true,
        learnedProfileLoaded: this.profileId !== null,
        learnedProfileId: this.profileId ?? "default-fallback",
      },
    };
  }
}

class NoisyAi implements AiLike {
  private rngState: number;

  constructor(private readonly base: AiLike, private readonly noise = 0.35, seed = seedNow()) {
    this.rngState = seed || 1;
  }

  private rand(): number {
    let t = (this.rngState += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  choose(engine: TetrisEngine): AiChoice | null {
    const choice = this.base.choose(engine);
    if (!choice) return null;
    if (this.rand() < this.noise * 0.22) {
      const fallback = new WeightedHeuristicAI("Noisy fallback", {
        garbagePressureSensitivity: 1.1,
        garbageHoleSensitivity: 1.15,
        b2bPressureSensitivity: 0.9,
        holeWeight: 7.4 + this.rand() * 1.6,
        heightWeight: 0.6 + this.rand() * 0.5,
        bumpWeight: 0.25 + this.rand() * 0.45,
        attackBonus: 1.4 + this.rand() * 1.8,
        lineBonus: 3.2 + this.rand() * 1.8,
      }).choose(engine);
      if (fallback) {
        fallback.aiInfo = { ...fallback.aiInfo, opponent: "NoisyHybrid fallback" };
        return fallback;
      }
    }
    return {
      ...choice,
      aiScore: choice.aiScore + (this.rand() - 0.5) * this.noise,
      aiInfo: { ...choice.aiInfo, opponent: "NoisyHybrid", noise: this.noise },
    };
  }
}

function seedNow(): number {
  return (Date.now() ^ Math.floor(Math.random() * 1_000_000_000)) >>> 0;
}

export function makeSpinAI(): AiLike {
  const ai = new LookaheadAI({
    depth: 2,
    beamWidth: 34,
    includeHold: true,
    spinBias: 1.25,
    maxCandidatesPerNode: 18,
    maxNodesPerDepth: 150,
    timeBudgetMs: 7.5,
    includeTwists: true,
    maxTwistCandidates: 10,
    twistTimeBudgetMs: 2.2,
    twistBias: 1.1,
    useGarbagePressure: true,
    garbagePressureSensitivity: 1.15,
    useB2BPressure: true,
    b2bPressureSensitivity: 1.35,
    useGarbageHoleTracking: true,
    garbageHoleSensitivity: 1.35,
  });
  Object.assign(ai, {
    holeWeight: 10.4,
    heightWeight: 0.88,
    maxHeightWeight: 2.35,
    bumpWeight: 0.56,
    wellWeight: 0.04,
    lineBonus: 3.7,
    attackBonus: 4.8,
    spinPotentialBonus: 2.8,
    spinClassificationBonus: 1.15,
    holdPenalty: 0.01,
    wastedTPenalty: 5.8,
    slotDestroyedPenalty: 4.8,
    nearReadySpinSlotBonus: 2.4,
    b2bPressureSensitivity: 1.35,
    useGarbageHoleTracking: true,
    garbageHoleSensitivity: 1.35,
  });
  return ai;
}

export function makeAllSpinAI(): AiLike {
  return new AllSpinAI({
    depth: 2,
    beamWidth: 42,
    includeHold: true,
    strictLineClears: true,
    timeBudgetMs: 16,
    maxCandidatesPerNode: 44,
    maxTwistCandidates: 18,
    maxTwistStates: 2400,
    maxTwistPathLength: 52,
    twistTimeBudgetMs: 4.5,
    includeNonClearingMechanical: false,
  });
}

export function makeLearnedHeuristicAI(profileInput?: unknown): AiLike {
  return new LearnedHeuristicAI(profileInput);
}

export function createBuiltinAiFactories(
  learnedProfileProvider: LearnedProfileProvider = () => undefined,
): AiFactorySpec[] {
  const create = (id: string): AiLike => {
    const spec = factories.find((item) => item.id === id) ?? factories[0];
    return spec.make();
  };
  const factories: AiFactorySpec[] = [
    { id: "heuristic", name: "HeuristicAI", make: () => new WeightedHeuristicAI("HeuristicAI", { garbagePressureSensitivity: 1.0, garbageHoleSensitivity: 1.0, b2bPressureSensitivity: 1.0 }) },
    { id: "learned_heuristic", name: "Learned Heuristic", make: () => makeLearnedHeuristicAI(learnedProfileProvider()) },
    { id: "lookahead", name: "LookaheadAI", make: () => new LookaheadAI({ depth: 3, beamWidth: 50, includeHold: true, spinBias: 1, maxCandidatesPerNode: 36, maxNodesPerDepth: 300, timeBudgetMs: 9, useGarbagePressure: true, garbagePressureSensitivity: 1.0, useGarbageHoleTracking: true, garbageHoleSensitivity: 1.1, useB2BPressure: true, b2bPressureSensitivity: 1.05 }) },
    { id: "spin", name: "SpinAI", make: makeSpinAI },
    { id: "allspin", name: "AllSpinAI (experimental)", make: makeAllSpinAI },
    { id: "aggressive", name: "Aggressive", make: () => new WeightedHeuristicAI("Aggressive", { garbagePressureSensitivity: 0.95, garbageHoleSensitivity: 1.05, b2bPressureSensitivity: 1.25, attackBonus: 5.2, lineBonus: 4.8, holeWeight: 6.4, heightWeight: 0.62, bumpWeight: 0.28, wellWeight: 0.08, holdPenalty: 0.02 }) },
    { id: "defensive", name: "Defensive", make: () => new WeightedHeuristicAI("Defensive", { garbagePressureSensitivity: 1.25, garbageHoleSensitivity: 1.45, b2bPressureSensitivity: 0.85, holeWeight: 13.0, heightWeight: 1.35, bumpWeight: 0.72, wellWeight: 0.28, lineBonus: 2.8, attackBonus: 0.9, holdPenalty: 0.03 }) },
    { id: "downstacker", name: "Downstacker", make: () => new WeightedHeuristicAI("Downstacker", { garbagePressureSensitivity: 1.35, garbageHoleSensitivity: 1.65, b2bPressureSensitivity: 0.75, holeWeight: 11.2, heightWeight: 1.05, bumpWeight: 0.45, wellWeight: 0.04, lineBonus: 5.0, attackBonus: 1.15, holdPenalty: 0.01 }) },
    { id: "combo", name: "Combo", make: () => new WeightedHeuristicAI("Combo", { garbagePressureSensitivity: 1.05, garbageHoleSensitivity: 1.2, b2bPressureSensitivity: 0.95, holeWeight: 7.2, heightWeight: 0.72, bumpWeight: 0.18, wellWeight: -0.12, lineBonus: 5.8, attackBonus: 1.65, holdPenalty: 0.02 }) },
    { id: "noisy_hybrid", name: "Noisy Hybrid", make: () => new NoisyAi(create("lookahead"), 0.55) },
  ];
  return factories;
}

export const BUILTIN_AI_FACTORIES: AiFactorySpec[] = createBuiltinAiFactories();

export function createBuiltinAi(
  id: string,
  learnedProfileProvider: LearnedProfileProvider = () => undefined,
): AiRegistryEntry {
  const factories = createBuiltinAiFactories(learnedProfileProvider);
  const spec = factories.find((item) => item.id === id) ?? factories[0];
  return { id: spec.id, name: spec.name, ai: spec.make() };
}

export function randomBuiltinAi(
  learnedProfileProvider: LearnedProfileProvider = () => undefined,
): AiRegistryEntry {
  const profile = learnedProfileProvider();
  const factories = createBuiltinAiFactories(() => profile)
    .filter((spec) => spec.id !== "learned_heuristic" || profile !== undefined && profile !== null);
  const spec = factories[Math.floor(Math.random() * factories.length)] ?? factories[0];
  return { id: spec.id, name: spec.name, ai: spec.make() };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function modelUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export async function buildBrowserAiEntries(
  ids?: string[],
  baseUrl = "/",
  learnedProfile?: unknown,
): Promise<AiRegistryEntry[]> {
  const requested = ids && ids.length > 0 ? new Set(ids) : null;
  let parsedProfile: HeuristicWeightProfileV1 | null = null;
  try {
    parsedProfile = learnedProfile ? parseHeuristicWeightProfile(learnedProfile) : null;
  } catch {
    parsedProfile = null;
  }
  const factories = createBuiltinAiFactories(() => parsedProfile ?? undefined);
  const entries = factories
    .filter((spec) => !requested || requested.has(spec.id))
    .map((spec) => {
      if (spec.id !== "learned_heuristic") return { id: spec.id, name: spec.name, ai: spec.make() };
      const suffix = parsedProfile ? ` (${parsedProfile.profileId})` : " (default fallback)";
      return { id: spec.id, name: `${spec.name}${suffix}`, ai: spec.make() };
    });

  const wantsPolicy = !requested || requested.has("web_policy") || requested.has("hybrid");
  if (!wantsPolicy) return entries;
  const [policyJson, valueJson] = await Promise.all([
    fetchJson<WebPolicyJson>(modelUrl(baseUrl, "models/web_policy.json")),
    fetchJson<WebValueJson>(modelUrl(baseUrl, "models/web_value.json")),
  ]);
  if (policyJson?.format !== "tetraflux_web_policy_json_v1") return entries;
  if (!requested || requested.has("web_policy")) {
    entries.push({ id: "web_policy", name: "WebPolicyAI", ai: new WebPolicyAI(policyJson) });
  }
  if (valueJson?.format === "tetraflux_web_value_json_v1" && (!requested || requested.has("hybrid"))) {
    const hybrid = new WebPolicyAI(policyJson);
    hybrid.setValueModel(new WebValueModel(valueJson));
    entries.push({ id: "hybrid", name: "HybridAI", ai: hybrid });
  }
  return entries;
}

export async function listBrowserAiOptions(
  baseUrl = "/",
  learnedProfile?: unknown,
): Promise<Array<{ id: string; name: string }>> {
  const entries = await buildBrowserAiEntries(undefined, baseUrl, learnedProfile);
  return entries.map(({ id, name }) => ({ id, name }));
}
