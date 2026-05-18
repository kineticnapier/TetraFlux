import type { EngineState, PlacementAction } from "../engine/tetris";

type Layer =
  | { type: "linear"; weight: number[][]; bias: number[] }
  | { type: "relu" }
  | { type: "layernorm"; weight: number[]; bias: number[]; eps: number };

export interface WebValueJson {
  format: "tetraflux_web_value_json_v1";
  feature_version: "selfplay_value_v1";
  model_id?: string;
  model_name?: string;
  exported_at?: string;
  training_summary?: unknown;
  input_dim: number;
  layers: Layer[];
}

const PIECES = ["I", "J", "L", "O", "S", "T", "Z"] as const;
const PIECE_TO_IDX = new Map<string, number>(PIECES.map((p, i) => [p, i]));

function onehotPiece(piece: unknown): number[] {
  const out = Array.from({ length: 7 }, () => 0);
  const idx = PIECE_TO_IDX.get(String(piece ?? "").toUpperCase());
  if (idx !== undefined) out[idx] = 1;
  return out;
}

function boardBits(rows: unknown): number[] {
  const board = Array.isArray(rows) ? rows.map(String).slice(-20) : [];
  while (board.length < 20) board.unshift("..........");
  const out: number[] = [];
  for (const row of board) {
    const fixed = (row + "..........").slice(0, 10);
    for (const c of fixed) out.push(c === "." ? 0 : 1);
  }
  return out;
}

export function featurizeValueStateAction(state: EngineState, action: PlacementAction): number[] {
  const active = state.active ?? { kind: "" };
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const feats: number[] = [];

  feats.push(...boardBits(state.board));
  feats.push(...onehotPiece(active.kind));
  feats.push(...onehotPiece(state.hold));

  for (let i = 0; i < 6; i++) feats.push(...onehotPiece(queue[i]));

  feats.push(state.canHold ? 1 : 0);
  feats.push((state.pendingGarbage ?? 0) / 20);
  feats.push((state.combo ?? -1) / 20);
  feats.push((state.b2b ?? 0) / 20);
  feats.push((action.x ?? 0) / 10);
  feats.push((action.rot ?? 0) / 4);
  feats.push(action.hold ? 1 : 0);
  feats.push(...onehotPiece(action.piece));

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

function relu(x: number[]): number[] { return x.map((v) => (v > 0 ? v : 0)); }

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

function withCacheBuster(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${Date.now()}`;
}

function short(text: unknown, max = 36): string {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

export class WebValueModel {
  loadedUrl = "";

  constructor(public model: WebValueJson) {}

  static async load(url = "/models/web_value.json"): Promise<WebValueModel | null> {
    try {
      const actualUrl = withCacheBuster(url);
      const res = await fetch(actualUrl, {
        cache: "no-store",
        headers: { "cache-control": "no-cache", "pragma": "no-cache" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as WebValueJson;
      if (data.format !== "tetraflux_web_value_json_v1") return null;
      const value = new WebValueModel(data);
      value.loadedUrl = actualUrl;
      console.log("[TetraFlux] loaded web value model", data);
      return value;
    } catch (err) {
      console.warn("[TetraFlux] failed to load web value model", err);
      return null;
    }
  }

  displayName(): string {
    return `Value ${short(this.model.model_id || this.model.model_name || "selfplay", 32)}`;
  }

  infoLines(): string[] {
    const out: string[] = [];
    out.push(`value: ${short(this.model.model_id || this.model.model_name || "loaded", 38)}`);
    const s = this.model.training_summary;
    if (isObj(s)) {
      const n = num(s.train_n);
      const mae = num(s.test_mae);
      if (n !== null) out.push(`value ops: ${Math.round(n).toLocaleString()}`);
      if (mae !== null) out.push(`value mae: ${mae.toFixed(2)}`);
    }
    return out;
  }

  forward(feats: number[]): number {
    let x = feats;
    for (const layer of this.model.layers) {
      if (layer.type === "linear") x = linear(x, layer.weight, layer.bias);
      else if (layer.type === "relu") x = relu(x);
      else if (layer.type === "layernorm") x = layernorm(x, layer.weight, layer.bias, layer.eps ?? 1e-5);
    }
    return x[0] ?? 0;
  }

  evaluate(state: EngineState, action: PlacementAction): number {
    const feats = featurizeValueStateAction(state, action);
    if (feats.length !== this.model.input_dim) return 0;
    const raw = this.forward(feats);
    // Clamp to the training target range. This prevents one bad value prediction
    // from completely overwhelming heuristic survival checks.
    return Math.max(-150, Math.min(150, raw));
  }
}
