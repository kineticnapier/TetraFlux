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

export class WebPolicyAI {
  actionToIndex: Map<string, number>;
  fallback = new HeuristicAI();

  constructor(public model: WebPolicyJson) {
    this.actionToIndex = new Map(model.actions.map((a, i) => [a, i]));
  }

  displayName(): string {
    const id = this.model.model_id || this.model.model_name || this.model.checkpoint_name;
    return `WebPolicyAI ${short(id || `${this.model.num_actions} actions`, 38)}`;
  }

  infoLines(): string[] {
    const out: string[] = [];
    if (this.model.model_id) out.push(`id: ${short(this.model.model_id, 52)}`);
    if (this.model.model_name) out.push(`name: ${short(this.model.model_name, 52)}`);
    if (this.model.exported_at) out.push(`export: ${this.model.exported_at}`);
    if (this.model.checkpoint_name) out.push(`ckpt: ${short(this.model.checkpoint_name, 52)}`);
    if (this.model.checkpoint_mtime_utc) out.push(`ckpt time: ${this.model.checkpoint_mtime_utc}`);
    if (this.model.checkpoint_sha256_12) out.push(`sha: ${this.model.checkpoint_sha256_12}`);
    out.push(`actions: ${this.model.num_actions}`);
    return out;
  }

  static async load(url = "/models/web_policy.json"): Promise<WebPolicyAI | null> {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as WebPolicyJson;
      if (data.format !== "tetraflux_web_policy_json_v1") return null;
      return new WebPolicyAI(data);
    } catch {
      return null;
    }
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

  choose(engine: TetrisEngine): AiChoice | null {
    const legal = engine.legalPlacements(true);
    if (legal.length === 0) return null;

    const feats = featurizeState(engine.stateDict());
    if (feats.length !== this.model.input_dim) return this.fallback.choose(engine);

    const logits = this.forward(feats);
    const candidates: Array<{ logit: number; action: PlacementAction }> = [];

    for (const action of legal) {
      const idx = this.actionToIndex.get(actionKey(action));
      if (idx === undefined) continue;
      candidates.push({ logit: logits[idx], action });
    }

    if (candidates.length === 0) return this.fallback.choose(engine);
    candidates.sort((a, b) => b.logit - a.logit);

    // Safety filter: choose the best policy action that does not instantly topout.
    for (const c of candidates.slice(0, 40)) {
      const e = engine.clone();
      const result = e.applyAction(c.action);
      if (!e.dead && !result.topout) {
        return {
          ...c.action,
          aiScore: -c.logit,
          aiInfo: { source: "web_policy", logit: c.logit, safety: "safe_top40" },
        };
      }
    }

    const best = candidates[0];
    return {
      ...best.action,
      aiScore: -best.logit,
      aiInfo: { source: "web_policy", logit: best.logit, safety: "no_safe_candidate" },
    };
  }
}
