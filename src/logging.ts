import { boardMetrics, type EngineState, type LockResult, type PlacementAction } from "./engine/tetris";

export const TRAINER_VERSION = "web-ft5-0.2.0";

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getAnonymousPlayerId(): string {
  const key = "tetraflux_anonymous_player_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = uuid();
    localStorage.setItem(key, id);
  }
  return id;
}

export interface LoggedResult {
  ok: boolean;
  reason: string;
  lines_cleared: number;
  attack_sent: number;
  raw_attack: number;
  combo: number;
  b2b: number;
  spin: string;
  topout: boolean;
}

function compactResult(result: LockResult): LoggedResult {
  return {
    ok: result.ok,
    reason: result.reason,
    lines_cleared: result.linesCleared,
    attack_sent: result.attackSent,
    raw_attack: result.rawAttack,
    combo: result.combo,
    b2b: result.b2b,
    spin: result.spin,
    topout: result.topout,
  };
}

export interface HumanMoveLog {
  trainer_version: string;
  anonymous_player_id: string;
  match_id: string;
  source: "web_ft5_human_vs_ai";
  round_index: number;
  step_index: number;
  state: EngineState;
  ai_state: EngineState;
  human_action: PlacementAction;
  result: LoggedResult;
  round_winner: "human" | "ai" | null;
  match_score_after_round: { human: number; ai: number } | null;
  created_at_ms: number;
}

export type BattleSide = "left" | "right";

export interface SelfplayMoveLog {
  trainer_version: string;
  anonymous_player_id: string;
  match_id: string;
  source: "web_ft5_ai_battle";
  left_ai_name: string;
  right_ai_name: string;
  side: BattleSide;
  ai_name: string;
  opponent_ai_name: string;
  round_index: number;
  step_index: number;
  state: EngineState;
  opponent_state: EngineState;
  action: PlacementAction;
  result: LoggedResult;
  state_after: EngineState;
  opponent_state_after: EngineState;
  immediate_reward: number;
  terminal_reward: number | null;
  round_winner: BattleSide | null;
  match_winner: BattleSide | null;
  match_score_after_round: { left: number; right: number } | null;
  created_at_ms: number;
}

function calcImmediateReward(before: EngineState, after: EngineState, opponentBefore: EngineState, opponentAfter: EngineState, result: LockResult): number {
  const b = boardMetrics(before.board);
  const a = boardMetrics(after.board);
  const ob = boardMetrics(opponentBefore.board);
  const oa = boardMetrics(opponentAfter.board);
  const holesDelta = a.holes - b.holes;
  const heightDelta = a.maxHeight - b.maxHeight;
  const oppHeightDelta = oa.maxHeight - ob.maxHeight;
  let reward = 0;
  reward += result.linesCleared * 1.0;
  reward += result.attackSent * 2.0;
  reward += Math.max(0, opponentAfter.pendingGarbage - opponentBefore.pendingGarbage) * 1.0;
  if (result.spin && result.spin !== "none") reward += 3.0 + result.linesCleared * 2.0;
  if (result.b2b > 0 && result.linesCleared > 0) reward += 1.0;
  if (result.combo > 0 && result.linesCleared > 0) reward += Math.min(4, result.combo) * 0.5;
  reward -= Math.max(0, holesDelta) * 3.0;
  reward -= Math.max(0, heightDelta) * 0.9;
  reward += Math.max(0, -heightDelta) * 0.3;
  reward += Math.max(0, oppHeightDelta) * 0.4;
  if (result.topout || after.dead) reward -= 100.0;
  return Number(reward.toFixed(4));
}

export class MatchLogger {
  matchId = uuid();
  anonymousPlayerId = getAnonymousPlayerId();
  roundBuffer: HumanMoveLog[] = [];
  records: HumanMoveLog[] = [];

  logHumanMove(args: { roundIndex: number; stepIndex: number; state: EngineState; aiState: EngineState; action: PlacementAction; result: LockResult; }): void {
    this.roundBuffer.push({
      trainer_version: TRAINER_VERSION,
      anonymous_player_id: this.anonymousPlayerId,
      match_id: this.matchId,
      source: "web_ft5_human_vs_ai",
      round_index: args.roundIndex,
      step_index: args.stepIndex,
      state: args.state,
      ai_state: args.aiState,
      human_action: args.action,
      result: compactResult(args.result),
      round_winner: null,
      match_score_after_round: null,
      created_at_ms: Date.now()
    });
  }

  finishRound(winner: "human" | "ai", score: { human: number; ai: number }): void {
    for (const rec of this.roundBuffer) {
      rec.round_winner = winner;
      rec.match_score_after_round = { ...score };
      this.records.push(rec);
    }
    this.roundBuffer = [];
    this.persistLocal();
  }

  toJsonl(includeCurrentRound = false): string {
    const rows = includeCurrentRound ? [...this.records, ...this.roundBuffer] : this.records;
    return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  }

  download(filename = `tetraflux_${this.matchId}.jsonl`): void {
    const text = this.toJsonl(true);
    const blob = new Blob([text], { type: "application/x-ndjson;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  persistLocal(): void { localStorage.setItem("tetraflux_last_match_log", this.toJsonl(true)); }
  clearLocal(): void { localStorage.removeItem("tetraflux_last_match_log"); }
}

export class SelfplayLogger {
  matchId = uuid();
  anonymousPlayerId = getAnonymousPlayerId();
  roundBuffer: SelfplayMoveLog[] = [];
  records: SelfplayMoveLog[] = [];

  logMove(args: { leftAiName: string; rightAiName: string; side: BattleSide; roundIndex: number; stepIndex: number; state: EngineState; opponentState: EngineState; action: PlacementAction; result: LockResult; stateAfter: EngineState; opponentStateAfter: EngineState; }): void {
    const aiName = args.side === "left" ? args.leftAiName : args.rightAiName;
    const opponentAiName = args.side === "left" ? args.rightAiName : args.leftAiName;
    this.roundBuffer.push({
      trainer_version: TRAINER_VERSION,
      anonymous_player_id: this.anonymousPlayerId,
      match_id: this.matchId,
      source: "web_ft5_ai_battle",
      left_ai_name: args.leftAiName,
      right_ai_name: args.rightAiName,
      side: args.side,
      ai_name: aiName,
      opponent_ai_name: opponentAiName,
      round_index: args.roundIndex,
      step_index: args.stepIndex,
      state: args.state,
      opponent_state: args.opponentState,
      action: args.action,
      result: compactResult(args.result),
      state_after: args.stateAfter,
      opponent_state_after: args.opponentStateAfter,
      immediate_reward: calcImmediateReward(args.state, args.stateAfter, args.opponentState, args.opponentStateAfter, args.result),
      terminal_reward: null,
      round_winner: null,
      match_winner: null,
      match_score_after_round: null,
      created_at_ms: Date.now(),
    });
  }

  finishRound(winner: BattleSide, score: { left: number; right: number }, matchWinner: BattleSide | null): void {
    for (const rec of this.roundBuffer) {
      rec.round_winner = winner;
      rec.match_winner = matchWinner;
      rec.match_score_after_round = { ...score };
      rec.terminal_reward = rec.side === winner ? 100 : -100;
      this.records.push(rec);
    }
    this.roundBuffer = [];
    this.persistLocal();
  }

  toJsonl(includeCurrentRound = false): string {
    const rows = includeCurrentRound ? [...this.records, ...this.roundBuffer] : this.records;
    return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  }

  download(filename = `tetraflux_selfplay_${this.matchId}.jsonl`): void {
    const text = this.toJsonl(true);
    const blob = new Blob([text], { type: "application/x-ndjson;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  persistLocal(): void { localStorage.setItem("tetraflux_last_selfplay_log", this.toJsonl(true)); }
  clearLocal(): void { localStorage.removeItem("tetraflux_last_selfplay_log"); }
}

const UPLOAD_CHUNK_TARGET_BYTES = 3_400_000;

function endpointFor(pathname?: string): string {
  const endpoint = import.meta.env.VITE_LOG_UPLOAD_URL;
  if (!endpoint) throw new Error("VITE_LOG_UPLOAD_URL is not set. Download logs manually.");

  if (!pathname) return endpoint;

  const url = new URL(endpoint);
  url.pathname = pathname;
  url.search = "";
  return url.toString();
}

function byteLen(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function splitJsonlByBytes(jsonl: string, maxBytes = UPLOAD_CHUNK_TARGET_BYTES): string[] {
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentBytes = 0;

  for (const line of lines) {
    const lineWithNewline = `${line}\n`;
    const b = byteLen(lineWithNewline);

    if (b > maxBytes) {
      if (current.length) {
        chunks.push(current.join("\n") + "\n");
        current = [];
        currentBytes = 0;
      }
      chunks.push(lineWithNewline);
      continue;
    }

    if (current.length && currentBytes + b > maxBytes) {
      chunks.push(current.join("\n") + "\n");
      current = [];
      currentBytes = 0;
    }

    current.push(line);
    currentBytes += b;
  }

  if (current.length) chunks.push(current.join("\n") + "\n");
  return chunks;
}

async function uploadJsonlTo(endpoint: string, jsonl: string): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-ndjson" },
    body: jsonl
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Upload failed: ${res.status}`);
  return text;
}

async function uploadJsonlChunked(endpoint: string, jsonl: string, label: string): Promise<string> {
  const chunks = splitJsonlByBytes(jsonl);
  if (chunks.length === 0) throw new Error(`No ${label} logs to upload.`);

  if (chunks.length === 1) return uploadJsonlTo(endpoint, chunks[0]);

  const results: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const result = await uploadJsonlTo(endpoint, chunks[i]);
    results.push(result);
  }

  return JSON.stringify({
    ok: true,
    chunked: true,
    kind: label,
    chunks: chunks.length,
    responses: results.map((x) => {
      try {
        const parsed = JSON.parse(x);
        return { key: parsed.key, lines: parsed.lines, bytes: parsed.bytes, duplicate: parsed.duplicate };
      } catch {
        return { raw: x.slice(0, 160) };
      }
    })
  });
}

export async function uploadLogs(jsonl: string): Promise<string> {
  return uploadJsonlChunked(endpointFor(), jsonl, "human");
}

export async function uploadSelfplayLogs(jsonl: string): Promise<string> {
  return uploadJsonlChunked(endpointFor("/selfplay"), jsonl, "selfplay");
}
