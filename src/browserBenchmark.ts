import { runForcedSpinFinisherProbe } from "./ai/spinFinisher";
import { listBrowserAiOptions } from "./ai/registry";
import {
  benchmarkGarbageConfigSummary,
  configureBenchmarkGarbageEnvironment,
  getBenchmarkGarbageEnvironmentConfig,
  type BenchmarkGarbageEnvironmentConfig,
} from "./ai/benchmarkEnvironment";
import { renderSummary, type BenchPayload } from "./bench/benchmarkCore";
import { benchmarkTuningSummary, normalizeBenchmarkTuningConfig, type BenchmarkTuningConfig, type BenchmarkTuningKey } from "./bench/benchmarkTuning";

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

function normalizeGarbageInputValues(panel: HTMLDivElement): void {
  const enabled = panel.querySelector<HTMLInputElement>("#benchGarbageEnabled")!;
  const lines = panel.querySelector<HTMLInputElement>("#benchGarbageLines")!;

  // The most common UX path is checking "enabled" and immediately pressing Run.
  // A 0-lines enabled state is effectively OFF, so promote it to a useful default.
  if (enabled.checked && numberInputValue(lines, 0, 0, 20) <= 0) {
    lines.value = "4";
  }
}

function readGarbageInputs(panel: HTMLDivElement): BenchmarkGarbageEnvironmentConfig {
  normalizeGarbageInputValues(panel);
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


function optionalNumberInputValue(input: HTMLInputElement, min: number, max: number, integer = false): number | undefined {
  const raw = input.value.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.max(min, Math.min(max, n));
  return integer ? Math.floor(clamped) : clamped;
}

function triStateValue(select: HTMLSelectElement): boolean | undefined {
  if (select.value === "on") return true;
  if (select.value === "off") return false;
  return undefined;
}

const TUNING_NUMBER_FIELDS: Array<{ id: string; key: BenchmarkTuningKey; min: number; max: number; integer?: boolean }> = [
  { id: "benchTuneGarbagePressure", key: "garbagePressureSensitivity", min: 0, max: 5 },
  { id: "benchTuneGarbageHole", key: "garbageHoleSensitivity", min: 0, max: 5 },
  { id: "benchTuneB2BPressure", key: "b2bPressureSensitivity", min: 0, max: 5 },
  { id: "benchTuneHoleWeight", key: "holeWeight", min: 0, max: 50 },
  { id: "benchTuneCoveredHoleWeight", key: "coveredHoleWeight", min: 0, max: 20 },
  { id: "benchTuneHeightWeight", key: "heightWeight", min: 0, max: 20 },
  { id: "benchTuneMaxHeightWeight", key: "maxHeightWeight", min: 0, max: 30 },
  { id: "benchTuneBumpWeight", key: "bumpWeight", min: 0, max: 20 },
  { id: "benchTuneWellWeight", key: "wellWeight", min: -10, max: 20 },
  { id: "benchTuneLineBonus", key: "lineBonus", min: -20, max: 30 },
  { id: "benchTuneAttackBonus", key: "attackBonus", min: -20, max: 50 },
  { id: "benchTuneSpinPotential", key: "spinPotentialBonus", min: -20, max: 30 },
  { id: "benchTuneSpinClass", key: "spinClassificationBonus", min: -20, max: 30 },
  { id: "benchTuneHoldPenalty", key: "holdPenalty", min: 0, max: 20 },
  { id: "benchTuneNewHole", key: "newHolePenaltyWeight", min: 0, max: 80 },
  { id: "benchTuneHeightRise", key: "maxHeightRisePenaltyWeight", min: 0, max: 50 },
  { id: "benchTuneBumpRise", key: "bumpRisePenaltyWeight", min: 0, max: 40 },
  { id: "benchTuneCenterRise", key: "centerTowerRisePenaltyWeight", min: 0, max: 40 },
  { id: "benchTuneWastedT", key: "wastedTPenalty", min: 0, max: 50 },
  { id: "benchTuneSlotDestroyed", key: "slotDestroyedPenalty", min: 0, max: 50 },
  { id: "benchTuneNearReadySlot", key: "nearReadySpinSlotBonus", min: -20, max: 40 },
  { id: "benchTuneDepth", key: "depth", min: 1, max: 6, integer: true },
  { id: "benchTuneBeamWidth", key: "beamWidth", min: 1, max: 400, integer: true },
  { id: "benchTuneSpinBias", key: "spinBias", min: 0, max: 5 },
  { id: "benchTuneMaxCandidates", key: "maxCandidatesPerNode", min: 1, max: 200, integer: true },
  { id: "benchTuneMaxNodes", key: "maxNodesPerDepth", min: 1, max: 2000, integer: true },
  { id: "benchTuneTimeBudget", key: "timeBudgetMs", min: 0.5, max: 100 },
  { id: "benchTuneMaxTwists", key: "maxTwistCandidates", min: 0, max: 80, integer: true },
  { id: "benchTuneTwistBudget", key: "twistTimeBudgetMs", min: 0, max: 50 },
  { id: "benchTuneTwistBias", key: "twistBias", min: 0, max: 5 },
];

const TUNING_BOOL_FIELDS: Array<{ id: string; key: BenchmarkTuningKey }> = [
  { id: "benchTuneUseGarbagePressure", key: "useGarbagePressure" },
  { id: "benchTuneUseGarbageHole", key: "useGarbageHoleTracking" },
  { id: "benchTuneUseB2B", key: "useB2BPressure" },
  { id: "benchTuneIncludeHold", key: "includeHold" },
  { id: "benchTuneIncludeTwists", key: "includeTwists" },
];

function readTuningInputs(panel: HTMLDivElement): BenchmarkTuningConfig {
  const enabled = panel.querySelector<HTMLInputElement>("#benchTuningEnabled")!;
  const raw: Partial<BenchmarkTuningConfig> = { enabled: enabled.checked };
  if (enabled.checked) {
    for (const field of TUNING_NUMBER_FIELDS) {
      const input = panel.querySelector<HTMLInputElement>(`#${field.id}`)!;
      const value = optionalNumberInputValue(input, field.min, field.max, field.integer);
      if (value !== undefined) (raw as Record<string, unknown>)[field.key] = value;
    }
    for (const field of TUNING_BOOL_FIELDS) {
      const select = panel.querySelector<HTMLSelectElement>(`#${field.id}`)!;
      const value = triStateValue(select);
      if (value !== undefined) (raw as Record<string, unknown>)[field.key] = value;
    }
  }
  return normalizeBenchmarkTuningConfig(raw);
}

function writeTuningSummary(panel: HTMLDivElement, config = readTuningInputs(panel)): void {
  const summary = panel.querySelector<HTMLElement>("#benchTuningSummary")!;
  summary.textContent = benchmarkTuningSummary(config);
}

function clearTuningInputs(panel: HTMLDivElement): void {
  panel.querySelector<HTMLInputElement>("#benchTuningEnabled")!.checked = false;
  for (const field of TUNING_NUMBER_FIELDS) panel.querySelector<HTMLInputElement>(`#${field.id}`)!.value = "";
  for (const field of TUNING_BOOL_FIELDS) panel.querySelector<HTMLSelectElement>(`#${field.id}`)!.value = "default";
  writeTuningSummary(panel);
}

function applyTuningPreset(panel: HTMLDivElement, preset: "balanced-garbage" | "low-hole" | "fast"): void {
  clearTuningInputs(panel);
  panel.querySelector<HTMLInputElement>("#benchTuningEnabled")!.checked = true;
  const set = (id: string, value: string) => { panel.querySelector<HTMLInputElement>(`#${id}`)!.value = value; };
  const sel = (id: string, value: string) => { panel.querySelector<HTMLSelectElement>(`#${id}`)!.value = value; };
  if (preset === "balanced-garbage") {
    set("benchTuneGarbagePressure", "1.05");
    set("benchTuneGarbageHole", "0.65");
    set("benchTuneB2BPressure", "1.0");
    set("benchTuneHoleWeight", "11.5");
    set("benchTuneHeightWeight", "1.0");
    set("benchTuneAttackBonus", "2.8");
    set("benchTuneLineBonus", "4.3");
    sel("benchTuneUseGarbagePressure", "on");
    sel("benchTuneUseGarbageHole", "on");
  } else if (preset === "low-hole") {
    set("benchTuneGarbagePressure", "1.2");
    set("benchTuneGarbageHole", "0.45");
    set("benchTuneHoleWeight", "15");
    set("benchTuneNewHole", "24");
    set("benchTuneHeightWeight", "1.25");
    set("benchTuneAttackBonus", "1.8");
  } else {
    set("benchTuneDepth", "2");
    set("benchTuneBeamWidth", "28");
    set("benchTuneMaxCandidates", "20");
    set("benchTuneMaxNodes", "120");
    set("benchTuneTimeBudget", "5");
    set("benchTuneMaxTwists", "4");
    set("benchTuneTwistBudget", "1.2");
  }
  writeTuningSummary(panel);
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
        <button id="benchHelpToggle">Help</button>
      </div>
      <fieldset class="bench-garbage-card" data-benchmark-garbage-host="true">
        <legend>Benchmark garbage</legend>
        <div class="bench-controls bench-garbage-controls">
          <label><input id="benchGarbageEnabled" type="checkbox" /> enabled</label>
          <label>lines/bag <input id="benchGarbageLines" type="number" min="0" max="20" step="1" value="4" /></label>
          <label>from bag <input id="benchGarbageStartBag" type="number" min="1" max="99" step="1" value="1" /></label>
          <label>max bags <input id="benchGarbageMaxBags" type="number" min="0" max="999" step="1" value="0" /></label>
          <label><input id="benchGarbageApply" type="checkbox" /> apply remaining</label>
        </div>
        <div id="benchGarbageSummary" class="hint">Bench garbage: OFF</div>
      </fieldset>
      <fieldset class="bench-tuning-card" data-benchmark-tuning-host="true">
        <legend>AI tuning overrides</legend>
        <div class="bench-controls bench-tuning-controls">
          <label><input id="benchTuningEnabled" type="checkbox" /> apply overrides</label>
          <button id="benchTuningPresetBalanced" type="button">Balanced garbage</button>
          <button id="benchTuningPresetLowHole" type="button">Low-hole</button>
          <button id="benchTuningPresetFast" type="button">Fast lookahead</button>
          <button id="benchTuningClear" type="button">Clear</button>
        </div>
        <details id="benchTuningDetails">
          <summary>Open tuning fields</summary>
          <div class="bench-tuning-grid">
            <label>garbage pressure <input id="benchTuneGarbagePressure" type="number" step="0.05" min="0" max="5" placeholder="default" /></label>
            <label>garbage hole <input id="benchTuneGarbageHole" type="number" step="0.05" min="0" max="5" placeholder="default" /></label>
            <label>B2B pressure <input id="benchTuneB2BPressure" type="number" step="0.05" min="0" max="5" placeholder="default" /></label>
            <label>use garbage pressure <select id="benchTuneUseGarbagePressure"><option value="default">default</option><option value="on">on</option><option value="off">off</option></select></label>
            <label>use garbage hole <select id="benchTuneUseGarbageHole"><option value="default">default</option><option value="on">on</option><option value="off">off</option></select></label>
            <label>use B2B <select id="benchTuneUseB2B"><option value="default">default</option><option value="on">on</option><option value="off">off</option></select></label>
            <label>hole weight <input id="benchTuneHoleWeight" type="number" step="0.1" placeholder="default" /></label>
            <label>covered hole <input id="benchTuneCoveredHoleWeight" type="number" step="0.1" placeholder="default" /></label>
            <label>height weight <input id="benchTuneHeightWeight" type="number" step="0.05" placeholder="default" /></label>
            <label>max height <input id="benchTuneMaxHeightWeight" type="number" step="0.05" placeholder="default" /></label>
            <label>bump weight <input id="benchTuneBumpWeight" type="number" step="0.05" placeholder="default" /></label>
            <label>well weight <input id="benchTuneWellWeight" type="number" step="0.05" placeholder="default" /></label>
            <label>line bonus <input id="benchTuneLineBonus" type="number" step="0.1" placeholder="default" /></label>
            <label>attack bonus <input id="benchTuneAttackBonus" type="number" step="0.1" placeholder="default" /></label>
            <label>spin potential <input id="benchTuneSpinPotential" type="number" step="0.1" placeholder="default" /></label>
            <label>spin class bonus <input id="benchTuneSpinClass" type="number" step="0.1" placeholder="default" /></label>
            <label>hold penalty <input id="benchTuneHoldPenalty" type="number" step="0.01" placeholder="default" /></label>
            <label>new hole penalty <input id="benchTuneNewHole" type="number" step="0.1" placeholder="default" /></label>
            <label>height rise penalty <input id="benchTuneHeightRise" type="number" step="0.1" placeholder="default" /></label>
            <label>bump rise penalty <input id="benchTuneBumpRise" type="number" step="0.1" placeholder="default" /></label>
            <label>center rise penalty <input id="benchTuneCenterRise" type="number" step="0.1" placeholder="default" /></label>
            <label>wasted T penalty <input id="benchTuneWastedT" type="number" step="0.1" placeholder="default" /></label>
            <label>slot destroyed penalty <input id="benchTuneSlotDestroyed" type="number" step="0.1" placeholder="default" /></label>
            <label>near-ready slot <input id="benchTuneNearReadySlot" type="number" step="0.1" placeholder="default" /></label>
            <label>depth <input id="benchTuneDepth" type="number" step="1" min="1" max="6" placeholder="default" /></label>
            <label>beam width <input id="benchTuneBeamWidth" type="number" step="1" min="1" placeholder="default" /></label>
            <label>spin bias <input id="benchTuneSpinBias" type="number" step="0.05" placeholder="default" /></label>
            <label>max candidates <input id="benchTuneMaxCandidates" type="number" step="1" min="1" placeholder="default" /></label>
            <label>max nodes <input id="benchTuneMaxNodes" type="number" step="1" min="1" placeholder="default" /></label>
            <label>time budget ms <input id="benchTuneTimeBudget" type="number" step="0.1" min="0.5" placeholder="default" /></label>
            <label>include hold <select id="benchTuneIncludeHold"><option value="default">default</option><option value="on">on</option><option value="off">off</option></select></label>
            <label>include twists <select id="benchTuneIncludeTwists"><option value="default">default</option><option value="on">on</option><option value="off">off</option></select></label>
            <label>max twists <input id="benchTuneMaxTwists" type="number" step="1" min="0" placeholder="default" /></label>
            <label>twist budget ms <input id="benchTuneTwistBudget" type="number" step="0.1" min="0" placeholder="default" /></label>
            <label>twist bias <input id="benchTuneTwistBias" type="number" step="0.05" min="0" placeholder="default" /></label>
          </div>
        </details>
        <div id="benchTuningSummary" class="hint">AI tuning overrides: OFF</div>
      </fieldset>
      <section id="benchHelpPanel" class="bench-help-card" hidden>
        <h3>Benchmark help</h3>
        <div class="bench-help-grid">
          <div>
            <strong>Benchmark garbage</strong>
            <p><b>enabled</b> queues garbage every bag. <b>lines/bag</b> is the amount queued after each 7 locked pieces. <b>from bag</b> delays the first queue. <b>max bags</b> limits the number of queued bags; 0 means unlimited. <b>apply remaining</b> applies uncountered pending garbage after the AI's response.</p>
          </div>
          <div>
            <strong>Useful garbage metrics</strong>
            <p><b>LinesQueued</b> is total sent by the benchmark. <b>LinesCancelled</b> is canceled by attack. <b>LinesApplied</b> actually entered the board. <b>MaxPending</b> is the largest pending queue seen.</p>
          </div>
          <div>
            <strong>Garbage hole metrics</strong>
            <p><b>gHole</b> in the summary is progress/worse turns. <b>garbageHoleBlocksReduced</b> counts blocks removed above the detected garbage hole column. <b>garbageHoleAccessDeltaTotal</b> shows whether the AI opened the lane toward the hole.</p>
          </div>
          <div>
            <strong>Spin / route metrics</strong>
            <p><b>routedPlacements</b> means the AI used a key-by-key route. <b>route_no_spin</b> means the route locked but did not count as a spin. <b>tspinCount / tsdCount</b> are actual scoring spin clears.</p>
          </div>
          <div>
            <strong>B2B metrics</strong>
            <p><b>b2bMax</b> is the highest B2B chain. <b>b2bBreaks</b> counts normal line clears that cut the chain. <b>b2bReleaseEstimateMax</b> is the current model's release-value estimate, not real attack yet.</p>
          </div>
          <div>
            <strong>AI tuning overrides</strong>
            <p>Leave fields blank to keep each AI's built-in value. When <b>apply overrides</b> is enabled, only filled fields are applied to all selected AIs. Use this to tune garbageHoleSensitivity, B2B pressure, heuristic weights, and Lookahead/Twist budgets without editing registry.ts.</p>
          </div>
        </div>
      </section>
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
  const helpToggleBtn = panel.querySelector<HTMLButtonElement>("#benchHelpToggle")!;
  const helpPanel = panel.querySelector<HTMLElement>("#benchHelpPanel")!;
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
  const tuningInputs = [
    panel.querySelector<HTMLInputElement>("#benchTuningEnabled")!,
    ...TUNING_NUMBER_FIELDS.map((field) => panel.querySelector<HTMLInputElement>(`#${field.id}`)!),
    ...TUNING_BOOL_FIELDS.map((field) => panel.querySelector<HTMLSelectElement>(`#${field.id}`)!),
  ];
  const tuningClearBtn = panel.querySelector<HTMLButtonElement>("#benchTuningClear")!;
  const tuningPresetBalancedBtn = panel.querySelector<HTMLButtonElement>("#benchTuningPresetBalanced")!;
  const tuningPresetLowHoleBtn = panel.querySelector<HTMLButtonElement>("#benchTuningPresetLowHole")!;
  const tuningPresetFastBtn = panel.querySelector<HTMLButtonElement>("#benchTuningPresetFast")!;

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
  writeTuningSummary(panel);
  for (const input of garbageInputs) {
    const update = () => writeGarbageInputs(panel, readGarbageInputs(panel));
    input.addEventListener("change", update);
    input.addEventListener("input", update);
  }
  for (const input of tuningInputs) {
    const update = () => writeTuningSummary(panel);
    input.addEventListener("change", update);
    input.addEventListener("input", update);
  }
  tuningClearBtn.addEventListener("click", () => clearTuningInputs(panel));
  tuningPresetBalancedBtn.addEventListener("click", () => applyTuningPreset(panel, "balanced-garbage"));
  tuningPresetLowHoleBtn.addEventListener("click", () => applyTuningPreset(panel, "low-hole"));
  tuningPresetFastBtn.addEventListener("click", () => applyTuningPreset(panel, "fast"));

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
    writeTuningSummary(panel);
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
  helpToggleBtn.addEventListener("click", () => {
    helpPanel.hidden = !helpPanel.hidden;
    helpToggleBtn.textContent = helpPanel.hidden ? "Help" : "Hide help";
  });
  runBtn.addEventListener("click", () => {
    const games = Math.max(1, Math.min(500, Math.floor(Number(gamesInput.value) || 8)));
    const maxPieces = Math.max(20, Math.min(2000, Math.floor(Number(maxPiecesInput.value) || 250)));
    const rawSeed = seedInput.value.trim();
    const parsedSeed = Number(rawSeed);
    const seedBase = rawSeed.length > 0 && Number.isFinite(parsedSeed) ? Math.floor(parsedSeed) : randomSeedBase();
    const aiIds = Array.from(aiChoices.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked")).map((x) => x.value);
    const benchmarkGarbage = readGarbageInputs(panel);
    const tuning = readTuningInputs(panel);
    latestPayload = null;
    runBtn.disabled = true;
    cancelBtn.disabled = false;
    downloadBtn.disabled = true;
    output.textContent = `Starting worker benchmark...\ngames=${games} maxPieces=${maxPieces} seed=${seedBase}\n${benchmarkGarbageConfigSummary(benchmarkGarbage)}\n${benchmarkTuningSummary(tuning)}`;
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
      if (m.type === "game_progress" || m.type === "ai_started" || m.type === "ai_finished" || m.type === "started") output.textContent = `${m.message ?? m.type}\n${benchmarkGarbageConfigSummary(benchmarkGarbage)}\n${benchmarkTuningSummary(tuning)}\n\nRunning...`;
    };
    worker.onerror = (e) => { output.textContent = `Worker crashed: ${e.message}`; stopWorker(); };
    worker.postMessage({ type: "run", config: { games, maxPieces, seedBase, aiIds, benchmarkGarbage, tuning } });
  });
}

ensureBenchmarkUi();
