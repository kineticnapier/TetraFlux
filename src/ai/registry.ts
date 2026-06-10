import { TetrisEngine } from "../engine/tetris";
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

class WeightedHeuristicAI extends HeuristicAI {
  variantName: string;

  constructor(name: string, weights: Partial<HeuristicAI> = {}) {
    super();
    this.variantName = name;
    Object.assign(this, weights);
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
      const h = new WeightedHeuristicAI("Noisy fallback", {
        holeWeight: 7.4 + this.rand() * 1.6,
        heightWeight: 0.6 + this.rand() * 0.5,
        bumpWeight: 0.25 + this.rand() * 0.45,
        attackBonus: 1.4 + this.rand() * 1.8,
        lineBonus: 3.2 + this.rand() * 1.8,
      });
      const fallback = h.choose(engine);
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
    garbagePressureSensitivity: 1.35,
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
  });
  return ai;
}

export const BUILTIN_AI_FACTORIES: AiFactorySpec[] = [
  { id: "heuristic", name: "HeuristicAI", make: () => new HeuristicAI() },
  { id: "lookahead", name: "LookaheadAI", make: () => new LookaheadAI({ depth: 3, beamWidth: 50, includeHold: true, spinBias: 1, maxCandidatesPerNode: 36, maxNodesPerDepth: 300, timeBudgetMs: 9 }) },
  { id: "spin", name: "SpinAI", make: makeSpinAI },
  { id: "aggressive", name: "Aggressive", make: () => new WeightedHeuristicAI("Aggressive", { attackBonus: 5.2, lineBonus: 4.8, holeWeight: 6.4, heightWeight: 0.62, bumpWeight: 0.28, wellWeight: 0.08, holdPenalty: 0.02 }) },
  { id: "defensive", name: "Defensive", make: () => new WeightedHeuristicAI("Defensive", { holeWeight: 13.0, heightWeight: 1.35, bumpWeight: 0.72, wellWeight: 0.28, lineBonus: 2.8, attackBonus: 0.9, holdPenalty: 0.03 }) },
  { id: "downstacker", name: "Downstacker", make: () => new WeightedHeuristicAI("Downstacker", { holeWeight: 11.2, heightWeight: 1.05, bumpWeight: 0.45, wellWeight: 0.04, lineBonus: 5.0, attackBonus: 1.15, holdPenalty: 0.01 }) },
  { id: "combo", name: "Combo", make: () => new WeightedHeuristicAI("Combo", { holeWeight: 7.2, heightWeight: 0.72, bumpWeight: 0.18, wellWeight: -0.12, lineBonus: 5.8, attackBonus: 1.65, holdPenalty: 0.02 }) },
  { id: "noisy_hybrid", name: "Noisy Hybrid", make: () => new NoisyAi(createBuiltinAi("lookahead").ai, 0.55) },
];

export function createBuiltinAi(id: string): AiRegistryEntry {
  const spec = BUILTIN_AI_FACTORIES.find((x) => x.id === id) ?? BUILTIN_AI_FACTORIES[0];
  return { id: spec.id, name: spec.name, ai: spec.make() };
}

export function randomBuiltinAi(): AiRegistryEntry {
  const spec = BUILTIN_AI_FACTORIES[Math.floor(Math.random() * BUILTIN_AI_FACTORIES.length)] ?? BUILTIN_AI_FACTORIES[0];
  return { id: spec.id, name: spec.name, ai: spec.make() };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

function modelUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export async function buildBrowserAiEntries(ids?: string[], baseUrl = "/"): Promise<AiRegistryEntry[]> {
  const requested = ids && ids.length > 0 ? new Set(ids) : null;
  const entries = BUILTIN_AI_FACTORIES
    .filter((spec) => !requested || requested.has(spec.id))
    .map((spec) => ({ id: spec.id, name: spec.name, ai: spec.make() }));

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

export async function listBrowserAiOptions(baseUrl = "/"): Promise<Array<{ id: string; name: string }>> {
  const entries = await buildBrowserAiEntries(undefined, baseUrl);
  return entries.map(({ id, name }) => ({ id, name }));
}
