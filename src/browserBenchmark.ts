import { runForcedSpinFinisherProbe } from "./ai/spinFinisher";
import { listBrowserAiOptions } from "./ai/registry";
import {
  benchmarkGarbageConfigSummary,
  configureBenchmarkGarbageEnvironment,
  getBenchmarkGarbageEnvironmentConfig,
  type BenchmarkGarbageEnvironmentConfig,
} from "./ai/benchmarkEnvironment";
import { renderSummary, type BenchPayload } from "./bench/benchmarkCore";

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function randomSeedBase(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] || Math.floor(Math.random() * 0xFFFFFFFF);
}

function numberInputValue(input: HTMLInputElement, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(input.value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function readGarbageInputs(panel: HTMLDivElement): BenchmarkGarbageEnvironmentConfig {
  const enabled = panel.querySelector<HTMLInputElement>("#benchGarbageEnabled")!;
  const lines = panel.querySelector<HTMLInputElement>("#benchGarbageLines")!;
  const start = panel.querySelector<HTMLInputElement>("#benchGarbageStartBag")!;
  const max = panel.querySelector<HTMLInputElement>("#benchGarbageMaxBags")!;
  const apply = panel.querySelector<HTMLInputElement>("#benchGarbageApply")!;
  return configureBenchmarkGarbageEnvironment({
    enabled: enabled.checked,
    linesPerBag: numberInputValue(lines, 0, 0, 20),
    startBag: numberInputValue(start, 1, 1, 99),
    maxBags: numberInputValue(max, 0, 0, 999),
    applyAfterResponse: apply.checked,
  });
}

function writeGarbageInputs(panel: HTMLDivElement, config = getBenchmarkGarbageEnvironmentConfig()): void {
  const enabled = panel.querySelector<HTMLInputElement>("#benchGarbageEnabled")!;
  const lines = panel.querySelector<HTMLInputElement>("#benchGarbageLines")!;
  const start = panel.querySelector<HTMLInputElement>("#benchGarbageStartBag")!;
  const max = panel.querySelector<HTMLInputElement>("#benchGarbageMaxBags")!;
  const apply = panel.querySelector<HTMLInputElement>("#benchGarbageApply")!;
  const summary = panel.querySelector<HTMLElement>("#benchGarbageSummary")!;
  enabled.checked = config.enabled;
  lines.value = String(config.linesPerBag);
  start.value = String(config.startBag);
  max.value = String(config.maxBags);
  apply.checked = config.applyAfterResponse;
  summary.textContent = benchmarkGarbageConfigSummary(config);
}

function ensureBenchmarkUi(): void {
  const toolbar = document.querySelector<HTMLDivElement>("#toolbar");
  if (!toolbar || document.querySelector("#benchAiBrowser")) return;
  const button = document.createElement("button");
  button.id = "benchAiBrowser";
  button.textContent = "Bench AI";
  toolbar.appendChild(button);

  const panel = document.createElement("div");
  panel.id = "benchPanel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="bench-card" data-benchmark-panel="true">
      <div class="bench-header">
        <h2>AI Benchmark</h2>
        <button id="benchClose" class="small-button">×</button>
      </div>
      <div class="bench-controls">
        <label>games <input id="benchGames" type="number" min="1" max="500" step="1" value="8" /></label>
        <label>max pieces <input id="benchMaxPieces" type="number" min="20" max="2000" step="10" value="250" /></label>
        <label>seed <input id="benchSeed" type="number" step="1" placeholder="random" /></label>
        <button id="benchRun">Run</button>
        <button id="benchCancel" disabled>Cancel</button>
        <button id="benchDownload" disabled>Download JSON</button>
        <button id="benchRestore">Restore Last Result</button>
        <button id="benchForcedSpin">Forced Spin Probe</button>
      </div>
      <fieldset class="bench-garbage-card" data-benchmark-garbage-host="true">
        <legend>Benchmark garbage</legend>
        <div class="bench-controls bench-garbage-controls">
          <label><input id="benchGarbageEnabled" type="checkbox" /> enabled</label>
          <label>lines/bag <input id="benchGarbageLines" type="number" min="0" max="20" step="1" value="0" /></label>
          <label>from bag <input id="benchGarbageStartBag" type="number" min="1" max="99" step="1" value="1" /></label>
          <label>max bags <input id="benchGarbageMaxBags" type="number" min="0" max="999" step="1" value="0" /></label>
          <label><input id="benchGarbageApply" type="checkbox" /> apply remaining</label>
        </div>
        <div id="benchGarbageSummary" class="hint">Bench garbage: OFF</div>
      </fieldset>
      <div id="benchAiChoices" class="bench-ai-choices"></div>
      <div>Runs in a Web Worker while this tab is open. Browsers may throttle it in background tabs.</div>
      <pre id="benchOutput">Ready. Browser benchmark runs in a worker and keeps UI responsive.</pre>
    </div>`;
  document.body.appendChild(panel);

  const closeBtn = panel.querySelector<HTMLButtonElement>("#benchClose")!;
  const runBtn = panel.querySelector<HTMLButtonElement>("#benchRun")!;
  const cancelBtn = panel.querySelector<HTMLButtonElement>("#benchCancel")!;
  const downloadBtn = panel.querySelector<HTMLButtonElement>("#benchDownload")!;
  const output = panel.querySelector<HTMLPreElement>("#benchOutput")!;
  const forcedBtn = panel.querySelector<HTMLButtonElement>("#benchForcedSpin")!;
  const restoreBtn = panel.querySelector<HTMLButtonElement>("#benchRestore")!;
  const gamesInput = panel.querySelector<HTMLInputElement>("#benchGames")!;
  const maxPiecesInput = panel.querySelector<HTMLInputElement>("#benchMaxPieces")!;
  const seedInput = panel.querySelector<HTMLInputElement>("#benchSeed")!;
  const aiChoices = panel.querySelector<HTMLDivElement>("#benchAiChoices")!;
  const garbageInputs = [
    panel.querySelector<HTMLInputElement>("#benchGarbageEnabled")!,
    panel.querySelector<HTMLInputElement>("#benchGarbageLines")!,
    panel.querySelector<HTMLInputElement>("#benchGarbageStartBag")!,
    panel.querySelector<HTMLInputElement>("#benchGarbageMaxBags")!,
    panel.querySelector<HTMLInputElement>("#benchGarbageApply")!,
  ];

  let worker: Worker | null = null;
  let latestPayload: BenchPayload | null = null;
  const stopWorker = () => {
    if (worker) {
      worker.postMessage({ type: "cancel" });
      worker.terminate();
      worker = null;
    }
    runBtn.disabled = false;
    cancelBtn.disabled = true;
  };

  writeGarbageInputs(panel);
  for (const input of garbageInputs) input.addEventListener("change", () => writeGarbageInputs(panel, readGarbageInputs(panel)));

  void listBrowserAiOptions().then((options) => {
    aiChoices.textContent = "";
    for (const option of options) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = option.id;
      input.checked = true;
      label.append(input, option.name);
      aiChoices.appendChild(label);
    }
  });

  button.addEventListener("click", () => {
    writeGarbageInputs(panel);
    panel.hidden = false;
  });
  closeBtn.addEventListener("click", () => { stopWorker(); panel.hidden = true; });
  cancelBtn.addEventListener("click", () => { output.textContent += "\nCanceling..."; stopWorker(); });
  downloadBtn.addEventListener("click", () => { if (latestPayload) downloadJson("tetraflux_browser_benchmark.json", latestPayload); });
  restoreBtn.addEventListener("click", () => {
    const raw = localStorage.getItem("tetraflux:lastBrowserBenchmark");
    if (!raw) { output.textContent = "No saved result."; return; }
    latestPayload = JSON.parse(raw) as BenchPayload;
    output.textContent = renderSummary(latestPayload);
    downloadBtn.disabled = false;
  });
  forcedBtn.addEventListener("click", () => {
    const probe = runForcedSpinFinisherProbe();
    output.textContent = `Forced spin probe: found=${probe.found} route=${probe.route} spin=${probe.spin} lines=${probe.linesCleared}${probe.reason ? ` reason=${probe.reason}` : ""}`;
  });
  runBtn.addEventListener("click", () => {
    const games = Math.max(1, Math.min(500, Math.floor(Number(gamesInput.value) || 8)));
    const maxPieces = Math.max(20, Math.min(2000, Math.floor(Number(maxPiecesInput.value) || 250)));
    const rawSeed = seedInput.value.trim();
    const parsedSeed = Number(rawSeed);
    const seedBase = rawSeed.length > 0 && Number.isFinite(parsedSeed) ? Math.floor(parsedSeed) : randomSeedBase();
    const aiIds = [...aiChoices.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked")].map((x) => x.value);
    const benchmarkGarbage = readGarbageInputs(panel);
    latestPayload = null;
    runBtn.disabled = true;
    cancelBtn.disabled = false;
    downloadBtn.disabled = true;
    output.textContent = `Starting worker benchmark...\ngames=${games} maxPieces=${maxPieces} seed=${seedBase}\n${benchmarkGarbageConfigSummary(benchmarkGarbage)}`;
    worker = new Worker(new URL("./bench/benchmarkWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<any>) => {
      const m = ev.data;
      if (m.type === "finished") {
        latestPayload = m.payload as BenchPayload;
        output.textContent = renderSummary(latestPayload);
        downloadBtn.disabled = false;
        localStorage.setItem("tetraflux:lastBrowserBenchmark", JSON.stringify(latestPayload));
        stopWorker();
        return;
      }
      if (m.type === "error") { output.textContent = `Benchmark failed: ${m.message}`; stopWorker(); return; }
      if (m.type === "game_progress" || m.type === "ai_started" || m.type === "ai_finished" || m.type === "started") output.textContent = `${m.message ?? m.type}\n${benchmarkGarbageConfigSummary(benchmarkGarbage)}\n\nRunning...`;
    };
    worker.onerror = (e) => { output.textContent = `Worker crashed: ${e.message}`; stopWorker(); };
    worker.postMessage({ type: "run", config: { games, maxPieces, seedBase, aiIds, benchmarkGarbage } });
  });
}

ensureBenchmarkUi();
