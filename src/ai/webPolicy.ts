import { boardMetrics, TetrisEngine, type EngineState, type PlacementAction } from "../engine/tetris";
import { HeuristicAI, type AiChoice } from "./heuristic";

type Layer =
  | { type: "linear"; weight: number[][]; bias: number[] }
  | { type: "relu" }
  | { type: "layernorm"; weight: number[]; bias: number[]; eps: number };

export interface WebPolicyJson {
  format: "tetraflux_web_policy_json_v1";
  feature_version: string;

  model_id?: string;
  model_name?: string;
  exported_at?: string;
  checkpoint_name?: string;
  checkpoint_path?: string;
  checkpoint_mtime_utc?: string;
  checkpoint_size_bytes?: number;
  checkpoint_sha256_12?: string;
  training_summary?: unknown;

  input_dim: number;
  num_actions: number;
  actions: string[];
  layers: Layer[];
}

const PIECES = ["I", "J", "L", "O", "S", "T", "Z"] as const;
const PIECE_TO_IDX = new Map<string, number>(PIECES.map((p, i) => [p, i]));

const POLICY_TOP_K = 80;
const POLICY_RANK_PENALTY = 0.08;
const POLICY_LOGIT_GAP_PENALTY = 0.02;
const MAX_DEBUG_CANDIDATES = 5;

function onehotPiece(piece: unknown): number[] {
  const out = Array.from({ length: 7 }, () => 0);
  const p = String(piece ?? "").toUpperCase();
  const idx = PIECE_TO_IDX.get(p);
  if (idx !== undefined) out[idx] = 1;
  return out;
}

function normalizeBoard(board: unknown): string[] {
  const rows = Array.isArray(board) ? board.map((x) => String(x)) : [];
  const last = rows.slice(-20);
  while (last.length < 20) last.unshift("..........");
  return last.map((r) => (r + "..........").slice(0, 10));
}

function featurizeState(state: EngineState): number[] {
  const board = normalizeBoard(state.board);
  const feats: number[] = [];

  for (const row of board) {
    for (const c of row) feats.push(c === "." ? 0 : 1);
  }

  feats.push(...onehotPiece(state.active?.kind));
  feats.push(...onehotPiece(state.hold));

  const queue = Array.isArray(state.queue) ? state.queue : [];
  for (let i = 0; i < 6; i++) feats.push(...onehotPiece(queue[i]));

  feats.push(state.canHold ? 1 : 0);

  const metrics = boardMetrics(board);
  feats.push(metrics.holes / 200);
  feats.push(metrics.totalHeight / 200);
  feats.push(metrics.maxHeight / 20);
  feats.push(metrics.bumpiness / 100);
  feats.push(metrics.wells / 100);

  feats.push((state.pendingGarbage ?? 0) / 20);
  feats.push((state.combo ?? -1) / 20);
  feats.push((state.b2b ?? 0) / 20);

  return feats;
}

function linear(x: number[], weight: number[][], bias: number[]): number[] {
  const y = new Array(bias.length);
  for (let i = 0; i < bias.length; i++) {
    const row = weight[i];
    let s = bias[i];
    for (let j = 0; j < x.length; j++) s += row[j] * x[j];
    y[i] = s;
  }
  return y;
}

function relu(x: number[]): number[] {
  return x.map((v) => (v > 0 ? v : 0));
}

function layernorm(x: number[], gamma: number[], beta: number[], eps: number): number[] {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;

  let variance = 0;
  for (const v of x) {
    const d = v - mean;
    variance += d * d;
  }
  variance /= x.length;

  const inv = 1 / Math.sqrt(variance + eps);
  return x.map((v, i) => ((v - mean) * inv) * gamma[i] + beta[i]);
}

function actionKey(action: PlacementAction): string {
  return `${action.hold ? "H:" : ""}${action.piece}:${action.x}:${action.rot}`;
}

function short(text: unknown, max = 46): string {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function withCacheBuster(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${Date.now()}`;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function fmtInt(x: unknown): string | null {
  const n = num(x);
  return n === null ? null : Math.round(n).toLocaleString();
}

function fmtPct(x: unknown): string | null {
  const n = num(x);
  return n === null ? null : `${(n * 100).toFixed(1)}%`;
}

function trainingSummaryLines(summary: unknown): string[] {
  if (!isObj(summary)) return ["learned ops: unknown"];

  const trainN = num(summary.train_n);
  const valN = num(summary.val_n);
  const testN = num(summary.test_n);
  const totalN = (trainN ?? 0) + (valN ?? 0) + (testN ?? 0);

  const out: string[] = [];

  if (trainN !== null) out.push(`learned ops: ${trainN.toLocaleString()} train`);
  else out.push("learned ops: unknown");

  if (totalN > 0) {
    out.push(
      `dataset ops: ${totalN.toLocaleString()} total ` +
      `(tr ${fmtInt(trainN) ?? "?"} / va ${fmtInt(valN) ?? "?"} / te ${fmtInt(testN) ?? "?"})`
    );
  }

  const bestEpoch = fmtInt(summary.best_epoch);
  if (bestEpoch) out.push(`best epoch: ${bestEpoch}`);

  const test = isObj(summary.test) ? summary.test : null;
  if (test) {
    const top1 = fmtPct(test.top1);
    const top5 = fmtPct(test.top5);
    const softX1 = fmtPct(test.soft_x1);
    const piece = fmtPct(test.piece_acc);
    const xAcc = fmtPct(test.x_acc);

    const parts: string[] = [];
    if (top1) parts.push(`top1 ${top1}`);
    if (top5) parts.push(`top5 ${top5}`);
    if (softX1) parts.push(`softX1 ${softX1}`);
    if (parts.length) out.push(`test: ${parts.join(" / ")}`);

    const accParts: string[] = [];
    if (piece) accParts.push(`piece ${piece}`);
    if (xAcc) accParts.push(`x ${xAcc}`);
    if (accParts.length) out.push(`acc: ${accParts.join(" / ")}`);
  }

  return out;
}

interface PolicyCandidate {
  action: PlacementAction;
  key: string;
  logit: number;
  policyRank: number;
}

export class WebPolicyAI {
  actionToIndex: Map<string, number>;
  fallback = new HeuristicAI();
  loadedUrl = "";
  lastChoiceInfo: Record<string, unknown> = {};

  constructor(public model: WebPolicyJson) {
    this.actionToIndex = new Map(model.actions.map((a, i) => [a, i]));
  }

  static async load(url = "/models/web_policy.json"): Promise<WebPolicyAI | null> {
    try {
      const actualUrl = withCacheBuster(url);
      const res = await fetch(actualUrl, {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache",
          "pragma": "no-cache",
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as WebPolicyJson;
      if (data.format !== "tetraflux_web_policy_json_v1") return null;
      const ai = new WebPolicyAI(data);
      ai.loadedUrl = actualUrl;
      console.log("[TetraFlux] loaded web policy", {
        url: actualUrl,
        model_id: data.model_id,
        model_name: data.model_name,
        exported_at: data.exported_at,
        checkpoint_mtime_utc: data.checkpoint_mtime_utc,
        sha: data.checkpoint_sha256_12,
        training_summary: data.training_summary,
      });
      return ai;
    } catch (err) {
      console.warn("[TetraFlux] failed to load web policy", err);
      return null;
    }
  }

  displayName(): string {
    const id = this.model.model_id || this.model.model_name || this.model.checkpoint_name;
    return `HybridAI ${short(id || `${this.model.num_actions} actions`, 38)}`;
  }

  infoLines(): string[] {
    const out: string[] = [];
    if (this.model.model_id) out.push(`id: ${short(this.model.model_id, 52)}`);
    if (this.model.model_name) out.push(`name: ${short(this.model.model_name, 52)}`);
    if (this.model.exported_at) out.push(`export: ${this.model.exported_at}`);

    out.push("mode: policy top-k + heuristic rerank");
    out.push(`rerank: top${POLICY_TOP_K}, rankPenalty=${POLICY_RANK_PENALTY}`);

    out.push(...trainingSummaryLines(this.model.training_summary));

    if (this.model.checkpoint_sha256_12) out.push(`sha: ${this.model.checkpoint_sha256_12}`);
    out.push(`action classes: ${this.model.num_actions}`);

    if (this.loadedUrl) out.push(`url: ${short(this.loadedUrl, 52)}`);
    return out;
  }

  forward(feats: number[]): number[] {
    let x = feats;
    for (const layer of this.model.layers) {
      if (layer.type === "linear") x = linear(x, layer.weight, layer.bias);
      else if (layer.type === "relu") x = relu(x);
      else if (layer.type === "layernorm") x = layernorm(x, layer.weight, layer.bias, layer.eps ?? 1e-5);
    }
    return x;
  }

  private policyCandidates(engine: TetrisEngine, logits: number[]): PolicyCandidate[] {
    const legal = engine.legalPlacements(true);
    const out: PolicyCandidate[] = [];

    for (const action of legal) {
      const key = actionKey(action);
      const idx = this.actionToIndex.get(key);
      if (idx === undefined) continue;
      out.push({ action, key, logit: logits[idx], policyRank: 0 });
    }

    out.sort((a, b) => b.logit - a.logit);
    for (let i = 0; i < out.length; i++) out[i].policyRank = i;
    return out;
  }

  choose(engine: TetrisEngine): AiChoice | null {
    const feats = featurizeState(engine.stateDict());
    if (feats.length !== this.model.input_dim) {
      const fallbackChoice = this.fallback.choose(engine);
      if (fallbackChoice) {
        fallbackChoice.aiInfo = {
          ...fallbackChoice.aiInfo,
          source: "heuristic_fallback",
          reason: "feature_dim_mismatch",
          expected: this.model.input_dim,
          actual: feats.length,
        };
      }
      return fallbackChoice;
    }

    const logits = this.forward(feats);
    const allPolicy = this.policyCandidates(engine, logits);
    if (allPolicy.length === 0) {
      const fallbackChoice = this.fallback.choose(engine);
      if (fallbackChoice) {
        fallbackChoice.aiInfo = {
          ...fallbackChoice.aiInfo,
          source: "heuristic_fallback",
          reason: "no_policy_legal_candidates",
        };
      }
      return fallbackChoice;
    }

    const top = allPolicy.slice(0, Math.min(POLICY_TOP_K, allPolicy.length));
    const bestLogit = top[0]?.logit ?? 0;

    let best: {
      candidate: PolicyCandidate;
      combinedScore: number;
      heuristicScore: number;
      heuristicInfo: Record<string, unknown>;
    } | null = null;

    const debug: Array<Record<string, unknown>> = [];

    for (const c of top) {
      const { score: heuristicScore, info: heuristicInfo } = this.fallback.scoreAfter(engine, c.action);

      const rankPenalty = c.policyRank * POLICY_RANK_PENALTY;
      const logitGapPenalty = Math.max(0, bestLogit - c.logit) * POLICY_LOGIT_GAP_PENALTY;
      const combinedScore = heuristicScore + rankPenalty + logitGapPenalty;

      if (debug.length < MAX_DEBUG_CANDIDATES) {
        debug.push({
          key: c.key,
          rank: c.policyRank,
          logit: Number(c.logit.toFixed(3)),
          heuristic: Number(heuristicScore.toFixed(3)),
          combined: Number(combinedScore.toFixed(3)),
        });
      }

      if (!best || combinedScore < best.combinedScore) {
        best = { candidate: c, combinedScore, heuristicScore, heuristicInfo };
      }
    }

    if (!best) return this.fallback.choose(engine);

    this.lastChoiceInfo = {
      source: "policy_topk_heuristic_rerank",
      topK: top.length,
      legalPolicyCandidates: allPolicy.length,
      chosenPolicyRank: best.candidate.policyRank,
      chosenLogit: best.candidate.logit,
      combinedScore: best.combinedScore,
      heuristicScore: best.heuristicScore,
      debugTop: debug,
    };

    return {
      ...best.candidate.action,
      aiScore: best.combinedScore,
      aiInfo: {
        ...best.heuristicInfo,
        ...this.lastChoiceInfo,
      },
    };
  }
}
