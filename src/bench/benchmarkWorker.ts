import { buildBrowserAis, runOneAi, type BenchConfig, type BenchPayload } from "./benchmarkCore";

type Msg = { type: "run"; config: BenchConfig } | { type: "cancel" };
let canceled = false;

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const msg = ev.data;
  if (msg.type === "cancel") { canceled = true; return; }
  if (msg.type !== "run") return;
  canceled = false;
  const started = performance.now();
  try {
    self.postMessage({ type: "started", message: "Worker benchmark started" });
    const ais = await buildBrowserAis();
    const results: BenchPayload["results"] = {};
    for (const entry of ais) {
      if (canceled) break;
      self.postMessage({ type: "ai_started", aiName: entry.name, message: `Running ${entry.name}...` });
      results[entry.name] = await runOneAi(entry, msg.config, () => canceled, (p) => self.postMessage(p));
      self.postMessage({ type: "ai_finished", aiName: entry.name });
    }
    const payload: BenchPayload = { generatedAt: new Date().toISOString(), environment: "browser", ...msg.config, aiCount: Object.keys(results).length, results, worker: true, canceled, elapsedMs: Math.round(performance.now() - started) };
    self.postMessage({ type: "finished", payload });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
