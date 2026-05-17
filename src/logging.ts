import type { EngineState, LockResult, PlacementAction } from "./engine/tetris";

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
  result: {
    ok: boolean;
    reason: string;
    lines_cleared: number;
    attack_sent: number;
    raw_attack: number;
    combo: number;
    b2b: number;
    spin: string;
    topout: boolean;
  };
  round_winner: "human" | "ai" | null;
  match_score_after_round: { human: number; ai: number } | null;
  created_at_ms: number;
}

export class MatchLogger {
  matchId = uuid();
  anonymousPlayerId = getAnonymousPlayerId();
  roundBuffer: HumanMoveLog[] = [];
  records: HumanMoveLog[] = [];

  logHumanMove(args: {
    roundIndex: number;
    stepIndex: number;
    state: EngineState;
    aiState: EngineState;
    action: PlacementAction;
    result: LockResult;
  }): void {
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
      result: {
        ok: args.result.ok,
        reason: args.result.reason,
        lines_cleared: args.result.linesCleared,
        attack_sent: args.result.attackSent,
        raw_attack: args.result.rawAttack,
        combo: args.result.combo,
        b2b: args.result.b2b,
        spin: args.result.spin,
        topout: args.result.topout
      },
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

  download(): void {
    const text = this.toJsonl(true);
    const blob = new Blob([text], { type: "application/x-ndjson;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tetraflux_${this.matchId}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  persistLocal(): void {
    localStorage.setItem("tetraflux_last_match_log", this.toJsonl(true));
  }

  clearLocal(): void {
    localStorage.removeItem("tetraflux_last_match_log");
  }
}

export async function uploadLogs(jsonl: string): Promise<string> {
  const endpoint = import.meta.env.VITE_LOG_UPLOAD_URL;
  if (!endpoint) throw new Error("VITE_LOG_UPLOAD_URL is not set. Download logs manually.");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-ndjson" },
    body: jsonl
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Upload failed: ${res.status}`);
  return text;
}
