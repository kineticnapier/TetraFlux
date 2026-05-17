export interface Env {
  LOG_BUCKET: R2Bucket;
}

const MAX_BYTES = 1024 * 1024 * 2;

function cors(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function validLine(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const r = obj as Record<string, unknown>;
  return r.trainer_version === "web-ft5-0.2.0"
    && r.source === "web_ft5_human_vs_ai"
    && typeof r.match_id === "string"
    && typeof r.anonymous_player_id === "string"
    && typeof r.round_index === "number"
    && typeof r.step_index === "number"
    && typeof r.state === "object"
    && typeof r.human_action === "object";
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("", { headers: cors() });
    if (req.method !== "POST") return new Response("POST only", { status: 405, headers: cors() });

    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
      return new Response("too large", { status: 413, headers: cors() });
    }

    const lines = text.split(/\r?\n/).filter((x) => x.trim());
    if (lines.length === 0) return new Response("empty", { status: 400, headers: cors() });
    if (lines.length > 5000) return new Response("too many lines", { status: 413, headers: cors() });

    let matchId = "unknown";
    let ok = 0;
    for (const line of lines) {
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        return new Response("bad jsonl", { status: 400, headers: cors() });
      }
      if (!validLine(obj)) return new Response("schema invalid", { status: 400, headers: cors() });
      matchId = String((obj as Record<string, unknown>).match_id);
      ok++;
    }

    const key = `raw/${new Date().toISOString().slice(0, 10)}/${matchId}_${crypto.randomUUID()}.jsonl`;
    await env.LOG_BUCKET.put(key, text, {
      httpMetadata: { contentType: "application/x-ndjson; charset=utf-8" },
      customMetadata: { lines: String(ok), trainer_version: "web-ft5-0.2.0" }
    });

    return new Response(JSON.stringify({ ok: true, key, lines: ok }), {
      headers: { ...cors(), "content-type": "application/json" }
    });
  }
};
