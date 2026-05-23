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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function calcImmediateReward(before: EngineState, after: EngineState, opponentBefore: EngineState, opponentAfter: EngineState, result: LockResult): number {
  const b = boardMetrics(before.board);
  const a = boardMetrics(after.board);
  const ob = boardMetrics(opponentBefore.board);
  const oa = boardMetrics(opponentAfter.board);

  const holesDelta = a.holes - b.holes;
  const maxHeightDelta = a.maxHeight - b.maxHeight;
  const totalHeightDelta = a.totalHeight - b.totalHeight;
  const bumpDelta = a.bumpiness - b.bumpiness;

  const centerBefore = Math.max(b.heights[4] ?? 0, b.heights[5] ?? 0);
  const centerAfter = Math.max(a.heights[4] ?? 0, a.heights[5] ?? 0);
  const sideBefore = ((b.heights[0] ?? 0) + (b.heights[1] ?? 0) + (b.heights[8] ?? 0) + (b.heights[9] ?? 0)) / 4;
  const sideAfter = ((a.heights[0] ?? 0) + (a.heights[1] ?? 0) + (a.heights[8] ?? 0) + (a.heights[9] ?? 0)) / 4;
  const centerTowerBefore = Math.max(0, centerBefore - sideBefore);
  const centerTowerAfter = Math.max(0, centerAfter - sideAfter);
  const centerTowerDelta = centerTowerAfter - centerTowerBefore;

  const pendingBefore = Math.max(0, before.pendingGarbage ?? 0);
  const pendingAfter = Math.max(0, after.pendingGarbage ?? 0);
  const pendingDelta = pendingAfter - pendingBefore;
  const pendingRelief = Math.max(0, pendingBefore - pendingAfter);

  const oppPendingBefore = Math.max(0, opponentBefore.pendingGarbage ?? 0);
  const oppPendingAfter = Math.max(0, opponentAfter.pendingGarbage ?? 0);
  const oppHeightDelta = oa.maxHeight - ob.maxHeight;

  const badSpinTerrain = a.holes >= 8 || a.maxHeight >= 16 || a.bumpiness >= 26 || centerTowerAfter >= 4.5;

  let reward = 0;
  reward += result.linesCleared * 2.3;
  reward += result.attackSent * 3.25;
  reward += Math.max(0, oppPendingAfter - oppPendingBefore) * 1.2;
  reward += pendingRelief * 1.15;
  reward += Math.max(0, -holesDelta) * 4.0;
  reward += Math.max(0, -maxHeightDelta) * 2.0;
  reward += Math.max(0, -totalHeightDelta) * 0.5;

  if (result.spin && result.spin !== "none") {
    const cleanSpin = !badSpinTerrain && result.linesCleared > 0;
    reward += cleanSpin ? 7.0 + result.linesCleared * 3.5 : -6.5;
  }
  if (result.b2b > 0 && result.linesCleared > 0) reward += 1.6;
  if (result.combo > 0 && result.linesCleared > 0) reward += Math.min(5, result.combo) * 0.8;

  reward -= Math.max(0, holesDelta) * 11.0;
  reward -= a.holes * 1.25;
  reward -= Math.max(0, maxHeightDelta) * 3.2;
  reward -= Math.max(0, a.maxHeight - 12) * 0.95;
  reward -= Math.max(0, a.maxHeight - 15) ** 2 * 1.45;
  reward -= Math.max(0, bumpDelta) * 0.9;
  reward -= Math.max(0, a.bumpiness - 18) * 0.4;
  reward -= Math.max(0, a.totalHeight - 85) * 0.24;
  reward -= Math.max(0, centerTowerDelta) * 1.8;
  reward -= Math.max(0, centerTowerAfter - 3.25) * 1.3;
  reward -= pendingAfter * 0.75;
  reward -= Math.max(0, pendingDelta) * 1.5;

  if (pendingBefore >= 6 && result.linesCleared === 0 && holesDelta >= 0) reward -= 6.5;
  if (pendingBefore >= 8 && maxHeightDelta > 0) reward -= 7.0;
  if (badSpinTerrain && result.spin && result.spin !== "none" && result.linesCleared === 0) reward -= 5.0;

  reward += Math.max(0, oppHeightDelta) * 0.45;

  if (after.dead || result.topout) reward -= 220.0;

  reward = clamp(reward, -100, 100);
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

  persistLocal(): void {
    // Do not store full JSONL in localStorage.
    // FT15 human matches can exceed browser quota and throw QuotaExceededError,
    // which can stop the game loop if it happens during finishRound().
    try {
      localStorage.removeItem("tetraflux_last_match_log");
      localStorage.setItem("tetraflux_last_match_log_meta", JSON.stringify({
        matchId: this.matchId,
        records: this.records.length,
        currentRound: this.roundBuffer.length,
        updatedAt: Date.now()
      }));
    } catch (err) {
      console.warn("[TetraFlux] failed to persist human log metadata", err);
    }
  }

  clearLocal(): void {
    try {
      localStorage.removeItem("tetraflux_last_match_log");
      localStorage.removeItem("tetraflux_last_match_log_meta");
    } catch (err) {
      console.warn("[TetraFlux] failed to clear human log metadata", err);
    }
  }
}


const SELFPLAY_UPLOAD_MAX_ROWS = 3000;
const SELFPLAY_UPLOAD_STRIDE = 12;
const SELFPLAY_UPLOAD_LAST_ROWS_PER_ROUND = 16;
const SELFPLAY_UPLOAD_MIN_ROUND_ROWS = 16;
const SELFPLAY_UPLOAD_MAX_HOLES_SOFT = 32;
const SELFPLAY_UPLOAD_MAX_HEIGHT_SOFT = 19;
const SELFPLAY_UPLOAD_MAX_PENDING_SOFT = 16;

function rowBoardMetrics(row: SelfplayMoveLog) {
  return boardMetrics(row.state_after.board);
}

function rowIsTerminalOrEndgame(row: SelfplayMoveLog): boolean {
  return (
    row.result.topout ||
    row.round_winner !== null ||
    row.match_winner !== null ||
    row.terminal_reward !== null
  );
}

function rowIsTactical(row: SelfplayMoveLog): boolean {
  return (
    row.result.attack_sent > 0 ||
    row.result.raw_attack > 0 ||
    row.result.lines_cleared >= 2 ||
    (row.result.spin !== "none" && row.result.lines_cleared > 0)
  );
}

function rowIsTrainingCleanEnough(row: SelfplayMoveLog): boolean {
  const m = rowBoardMetrics(row);
  return (
    m.holes <= SELFPLAY_UPLOAD_MAX_HOLES_SOFT &&
    m.maxHeight <= SELFPLAY_UPLOAD_MAX_HEIGHT_SOFT &&
    row.state_after.pendingGarbage <= SELFPLAY_UPLOAD_MAX_PENDING_SOFT
  );
}

function groupSelfplayRowsByRound(rows: SelfplayMoveLog[]): Map<number, SelfplayMoveLog[]> {
  const rounds = new Map<number, SelfplayMoveLog[]>();
  for (const row of rows) {
    if (!rounds.has(row.round_index)) rounds.set(row.round_index, []);
    rounds.get(row.round_index)!.push(row);
  }
  return rounds;
}

function selfplayRowKey(row: SelfplayMoveLog): string {
  return `${row.round_index}:${row.step_index}:${row.side}`;
}

function clientThinSelfplayRowsForTrainingUpload(rows: SelfplayMoveLog[]): SelfplayMoveLog[] {
  if (rows.length <= SELFPLAY_UPLOAD_MAX_ROWS) return rows;

  const keep = new Map<string, SelfplayMoveLog>();
  const rounds = groupSelfplayRowsByRound(rows);

  for (const roundRows of rounds.values()) {
    if (roundRows.length < SELFPLAY_UPLOAD_MIN_ROUND_ROWS) continue;

    const sorted = [...roundRows].sort((a, b) => (a.step_index - b.step_index) || a.side.localeCompare(b.side));

    for (let localIndex = 0; localIndex < sorted.length; localIndex++) {
      const row = sorted[localIndex];

      const keepTerminal = rowIsTerminalOrEndgame(row);
      const keepTactical = rowIsTactical(row);
      const keepPeriodicClean = localIndex % SELFPLAY_UPLOAD_STRIDE === 0 && rowIsTrainingCleanEnough(row);

      if (keepTerminal || keepTactical || keepPeriodicClean) {
        keep.set(selfplayRowKey(row), row);
      }
    }

    for (const row of sorted.slice(-SELFPLAY_UPLOAD_LAST_ROWS_PER_ROUND)) {
      keep.set(selfplayRowKey(row), row);
    }
  }

  let out = [...keep.values()].sort((a, b) =>
    (a.round_index - b.round_index) ||
    (a.step_index - b.step_index) ||
    a.side.localeCompare(b.side)
  );

  if (out.length <= SELFPLAY_UPLOAD_MAX_ROWS) return out;

  // Preserve tactical/terminal rows first, then add a spread of clean periodic rows.
  const priority = out.filter((row) => rowIsTerminalOrEndgame(row) || rowIsTactical(row));
  const regular = out.filter((row) => !(rowIsTerminalOrEndgame(row) || rowIsTactical(row)));

  if (priority.length >= SELFPLAY_UPLOAD_MAX_ROWS) {
    const step = Math.ceil(priority.length / SELFPLAY_UPLOAD_MAX_ROWS);
    return priority.filter((_, i) => i % step === 0).slice(0, SELFPLAY_UPLOAD_MAX_ROWS);
  }

  const remaining = SELFPLAY_UPLOAD_MAX_ROWS - priority.length;
  const step = Math.max(1, Math.ceil(regular.length / Math.max(1, remaining)));
  const sampledRegular = regular.filter((_, i) => i % step === 0).slice(0, remaining);

  return [...priority, ...sampledRegular]
    .sort((a, b) =>
      (a.round_index - b.round_index) ||
      (a.step_index - b.step_index) ||
      a.side.localeCompare(b.side)
    )
    .slice(0, SELFPLAY_UPLOAD_MAX_ROWS);
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

    // Do not persist full selfplay logs to localStorage.
    // FT15 AI Battle can exceed browser localStorage quota around late rounds,
    // throwing QuotaExceededError and freezing auto-next.
  }

  toJsonl(includeCurrentRound = false): string {
    // Upload/export path: apply the same kind of thinning we would otherwise do
    // during dataset construction. This keeps R2 payloads small and avoids
    // sending tens of thousands of nearly identical selfplay rows.
    const rows = includeCurrentRound ? [...this.records, ...this.roundBuffer] : this.records;
    const thinned = clientThinSelfplayRowsForTrainingUpload(rows);
    return thinned.map((r) => JSON.stringify(r)).join("\n") + (thinned.length ? "\n" : "");
  }

  fullJsonl(includeCurrentRound = false): string {
    const rows = includeCurrentRound ? [...this.records, ...this.roundBuffer] : this.records;
    return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  }

  uploadRowCount(includeCurrentRound = false): number {
    const rows = includeCurrentRound ? [...this.records, ...this.roundBuffer] : this.records;
    return clientThinSelfplayRowsForTrainingUpload(rows).length;
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

  persistLocal(): void {
    // Keep only small metadata; full selfplay logs are too large for localStorage.
    try {
      localStorage.removeItem("tetraflux_last_selfplay_log");
      localStorage.setItem("tetraflux_last_selfplay_log_meta", JSON.stringify({
        matchId: this.matchId,
        records: this.records.length,
        currentRound: this.roundBuffer.length,
        updatedAt: Date.now()
      }));
    } catch (err) {
      console.warn("[TetraFlux] failed to persist selfplay log metadata", err);
    }
  }

  clearLocal(): void {
    try {
      localStorage.removeItem("tetraflux_last_selfplay_log");
      localStorage.removeItem("tetraflux_last_selfplay_log_meta");
    } catch (err) {
      console.warn("[TetraFlux] failed to clear selfplay log metadata", err);
    }
  }
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
