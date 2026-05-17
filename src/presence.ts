export interface PresenceResult {
  ok: boolean;
  online: number;
  active_window_ms?: number;
  error?: string;
}

function endpoint(path: string): string | null {
  const base = import.meta.env.VITE_LOG_UPLOAD_URL;
  if (!base) return null;
  const url = new URL(base);
  const normalized = path.startsWith("/") ? path : `/${path}`;
  url.pathname = normalized;
  url.search = "";
  return url.toString();
}

export class PresenceClient {
  online = 0;
  status = "not connected";
  private timer: number | null = null;

  constructor(private anonymousPlayerId: string) {}

  start(): void {
    this.stop();
    void this.ping();
    this.timer = window.setInterval(() => void this.ping(), 15000);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async ping(): Promise<void> {
    const url = endpoint("/presence");
    if (!url) {
      this.status = "presence disabled";
      return;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          anonymous_player_id: this.anonymousPlayerId,
          status: "playing",
          at: Date.now(),
        }),
      });

      const text = await res.text();
      const data = JSON.parse(text) as PresenceResult;

      if (!res.ok || !data.ok) {
        this.status = data.error ?? `presence failed: ${res.status}`;
        return;
      }

      this.online = data.online;
      this.status = `playing: ${data.online}`;
    } catch (err) {
      this.status = err instanceof Error ? err.message : String(err);
    }
  }
}
