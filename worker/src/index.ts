export interface Env {
  LOG_BUCKET: R2Bucket;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 5000;
const ALLOWED_VERSIONS = new Set([
  "web-ft5-0.2.0",
  "web-ft5-0.3.0"
]);

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400"
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function validBoard(board: unknown): boolean {
  if (!Array.isArray(board)) return false;
  if (board.length !== 20) return false;
  return board.every((row) => typeof row === "string" && row.length === 10);
}

function validAction(action: unknown): boolean {
  if (!isPlainObject(action)) return false;
  if (typeof action.key !== "string") return false;
  if (typeof action.piece !== "string") return false;
  if (typeof action.x !== "number") return false;
  if (typeof action.rot !== "number") return false;
  if (typeof action.hold !== "boolean") return false;
  return true;
}

function validateRecord(obj: unknown): { ok: true; matchId: string; version: string; anonymousId: string } | { ok: false; reason: string } {
  if (!isPlainObject(obj)) return { ok: false, reason: "record_not_object" };

  const version = obj.trainer_version;
  if (typeof version !== "string" || !ALLOWED_VERSIONS.has(version)) {
    return { ok: false, reason: "bad_trainer_version" };
  }

  if (obj.source !== "web_ft5_human_vs_ai") {
    return { ok: false, reason: "bad_source" };
  }

  const matchId = obj.match_id;
  const anonymousId = obj.anonymous_player_id;
  if (typeof matchId !== "string" || matchId.length < 8 || matchId.length > 128) {
    return { ok: false, reason: "bad_match_id" };
  }
  if (typeof anonymousId !== "string" || anonymousId.length < 8 || anonymousId.length > 128) {
    return { ok: false, reason: "bad_anonymous_player_id" };
  }

  if (typeof obj.round_index !== "number" || typeof obj.step_index !== "number") {
    return { ok: false, reason: "bad_indices" };
  }

  if (!isPlainObject(obj.state)) {
    return { ok: false, reason: "bad_state" };
  }
  if (!validBoard(obj.state.board)) {
    return { ok: false, reason: "bad_board" };
  }

  if (!validAction(obj.human_action)) {
    return { ok: false, reason: "bad_human_action" };
  }

  const winner = obj.round_winner;
  if (winner !== "human" && winner !== "ai" && winner !== null) {
    return { ok: false, reason: "bad_round_winner" };
  }

  return { ok: true, matchId, version, anonymousId };
}

async function sha256Hex12(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const bytes = [...new Uint8Array(digest)];
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("", { status: 204, headers: corsHeaders() });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "POST only" }, 405);
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/x-ndjson") && !contentType.includes("text/plain")) {
      return jsonResponse({ ok: false, error: "content-type must be application/x-ndjson" }, 415);
    }

    const text = await req.text();
    const bytes = textBytes(text);

    if (bytes <= 0) {
      return jsonResponse({ ok: false, error: "empty body" }, 400);
    }

    if (bytes > MAX_BYTES) {
      return jsonResponse({ ok: false, error: "too large", max_bytes: MAX_BYTES }, 413);
    }

    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= 0) {
      return jsonResponse({ ok: false, error: "empty jsonl" }, 400);
    }

    if (lines.length > MAX_LINES) {
      return jsonResponse({ ok: false, error: "too many lines", max_lines: MAX_LINES }, 413);
    }

    let matchId = "unknown";
    let anonymousId = "unknown";
    let version = "unknown";

    for (let i = 0; i < lines.length; i++) {
      let obj: unknown;
      try {
        obj = JSON.parse(lines[i]);
      } catch {
        return jsonResponse({ ok: false, error: "bad json", line: i + 1 }, 400);
      }

      const v = validateRecord(obj);
      if (!v.ok) {
        return jsonResponse({ ok: false, error: "schema invalid", reason: v.reason, line: i + 1 }, 400);
      }

      if (i === 0) {
        matchId = v.matchId;
        anonymousId = v.anonymousId;
        version = v.version;
      }
    }

    const hash = await sha256Hex12(text);
    const key = `raw/${todayUtc()}/${version}/${matchId}_${hash}.jsonl`;

    const existing = await env.LOG_BUCKET.head(key);
    if (existing) {
      return jsonResponse({
        ok: true,
        duplicate: true,
        key,
        lines: lines.length,
        bytes
      });
    }

    await env.LOG_BUCKET.put(key, text, {
      httpMetadata: {
        contentType: "application/x-ndjson; charset=utf-8"
      },
      customMetadata: {
        trainer_version: version,
        match_id: matchId,
        anonymous_player_id: anonymousId,
        lines: String(lines.length),
        bytes: String(bytes),
        sha256_12: hash,
        uploaded_at: new Date().toISOString()
      }
    });

    return jsonResponse({
      ok: true,
      duplicate: false,
      key,
      lines: lines.length,
      bytes
    });
  }
};
