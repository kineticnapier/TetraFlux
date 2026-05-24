import { HeuristicAI, type AiChoice } from "./ai/heuristic";
import { LookaheadAI } from "./ai/lookahead";
import { estimateSpinPotential } from "./ai/spinPotential";
import { executeBenchmarkAction } from "./ai/benchmarkRunner";
import { WebPolicyAI } from "./ai/webPolicy";
import { WebValueModel } from "./ai/webValue";
import { boardMetrics, TetrisEngine } from "./engine/tetris";

type AiLike = { choose(engine: TetrisEngine): AiChoice | null };

type Aggregate = {
  games: number;
  rounds: number;
  piecesSurvived: number;
  linesCleared: number;
  attackSent: number;
  topoutCount: number;
  avgHoles: number;
  avgMaxHeight: number;
  avgBumpiness: number;
  avgTotalHeight: number;
  tspinCount: number;
  tsdCount: number;
  tstCount: number;
  spinPotentialCreated: number;
  garbageHandled: number;
  avgDecisionTimeMs: number;
  maxDecisionTimeMs: number;
  spinFinisherAttempts: number;
  spinFinisherSuccesses: number;
  routeFailures: number;
  directPlacements: number;
  routedPlacements: number;
};

type BenchEntry = { name: string; ai: AiLike };

type BenchOptions = {
  games: number;
  maxPieces: number;
  seedBase: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
};

type BenchPayload = {
  generatedAt: string;
  environment: "browser";
  games: number;
  maxPieces: number;
  seedBase: number;
  aiCount: number;
  results: Record<string, Aggregate>;
};

function sleepFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "0";
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function buildBrowserAis(onProgress?: (message: string) => void): Promise<BenchEntry[]> {
  const ais: BenchEntry[] = [];
  ais.push({ name: "HeuristicAI", ai: new HeuristicAI() });
  ais.push({ name: "LookaheadAI", ai: new LookaheadAI({ depth: 3, beamWidth: 50, includeHold: true, spinBias: 1, maxCandidatesPerNode: 36, maxNodesPerDepth: 300, timeBudgetMs: 9 }) });

  const spinAi = new LookaheadAI({ depth: 4, beamWidth: 80, includeHold: true, spinBias: 1.75, maxCandidatesPerNode: 34, maxNodesPerDepth: 360, timeBudgetMs: 11.5 });
  Object.assign(spinAi, {
    holeWeight: 10.1,
    heightWeight: 0.88,
    maxHeightWeight: 2.35,
    bumpWeight: 0.55,
    wellWeight: 0.04,
    lineBonus: 3.7,
    attackBonus: 4.7,
    spinPotentialBonus: 2.95,
    holdPenalty: 0.01,
  });
  ais.push({ name: "SpinAI", ai: spinAi });

  onProgress?.("Loading browser policy/value models...");
  const [policy, value] = await Promise.all([
    WebPolicyAI.load("/models/web_policy.json"),
    WebValueModel.load("/models/web_value.json"),
  ]);

  if (policy) {
    ais.push({ name: "WebPolicyAI", ai: policy });
    if (value) {
      const hybrid = new WebPolicyAI(policy.model);
      hybrid.setValueModel(value);
      ais.push({ name: "HybridAI", ai: hybrid });
    }
  }

  return ais;
}

async function runOneAi(entry: BenchEntry, options: BenchOptions): Promise<Aggregate> {
  let piecesSurvived = 0;
  let linesCleared = 0;
  let attackSent = 0;
  let topoutCount = 0;
  let tspinCount = 0;
  let tsdCount = 0;
  let tstCount = 0;
  let holesSum = 0;
  let maxHeightSum = 0;
  let bumpinessSum = 0;
  let totalHeightSum = 0;
  let spinPotentialCreated = 0;
  let garbageHandled = 0;
  let decisionMsTotal = 0;
  let decisionMsMax = 0;
  let decisions = 0;
  let spinFinisherAttempts = 0;
  let spinFinisherSuccesses = 0;
  let routeFailures = 0;
  let directPlacements = 0;
  let routedPlacements = 0;

  for (let g = 0; g < options.games; g++) {
    if (options.signal?.aborted) throw new DOMException("Benchmark aborted", "AbortError");

    const seed = options.seedBase + g * 31;
    const engine = new TetrisEngine(seed, seed + 17);

    for (let p = 0; p < options.maxPieces && !engine.dead; p++) {
      if (options.signal?.aborted) throw new DOMException("Benchmark aborted", "AbortError");

      const beforePending = engine.pendingGarbage;
      const beforeState = engine.stateDict();
      const t0 = performance.now();
      const action = entry.ai.choose(engine);
      const dt = performance.now() - t0;
      decisionMsTotal += dt;
      decisionMsMax = Math.max(decisionMsMax, dt);
      decisions++;

      if (!action) {
        topoutCount++;
        break;
      }

      const execution = executeBenchmarkAction(engine, action);
      const result = execution.result;
      if (execution.metrics.spinFinisherAttempt) spinFinisherAttempts++;
      if (execution.metrics.spinFinisherSuccess) spinFinisherSuccesses++;
      if (execution.metrics.routeFailed) routeFailures++;
      if (execution.metrics.routeUsed) routedPlacements++;
      if (execution.metrics.usedDirectApply) directPlacements++;
      if (!result.ok) {
        topoutCount++;
        break;
      }

      piecesSurvived++;
      linesCleared += result.linesCleared;
      attackSent += result.attackSent;

      if (result.topout || engine.dead) topoutCount++;
      if (result.spin === "tspin") {
        tspinCount++;
        if (result.linesCleared === 2) tsdCount++;
        if (result.linesCleared === 3) tstCount++;
      }

      spinPotentialCreated += estimateSpinPotential(beforeState).bonus;
      const afterPending = engine.pendingGarbage;
      const canceled = Math.max(0, beforePending - afterPending);
      garbageHandled += canceled + Math.min(result.attackSent, beforePending);

      const metrics = boardMetrics(engine.stateDict().board);
      holesSum += metrics.holes;
      maxHeightSum += metrics.maxHeight;
      bumpinessSum += metrics.bumpiness;
      totalHeightSum += metrics.totalHeight;

      if ((p & 31) === 31) await sleepFrame();
    }

    options.onProgress?.(`${entry.name}: game ${g + 1}/${options.games}`);
    await sleepFrame();
  }

  const rounds = Math.max(1, piecesSurvived);
  return {
    games: options.games,
    rounds,
    piecesSurvived,
    linesCleared,
    attackSent,
    topoutCount,
    avgHoles: holesSum / rounds,
    avgMaxHeight: maxHeightSum / rounds,
    avgBumpiness: bumpinessSum / rounds,
    avgTotalHeight: totalHeightSum / rounds,
    tspinCount,
    tsdCount,
    tstCount,
    spinPotentialCreated,
    garbageHandled,
    avgDecisionTimeMs: decisions > 0 ? decisionMsTotal / decisions : 0,
    maxDecisionTimeMs: decisionMsMax,
    spinFinisherAttempts,
    spinFinisherSuccesses,
    routeFailures,
    directPlacements,
    routedPlacements,
  };
}

async function runBrowserAiBenchmark(options: BenchOptions): Promise<BenchPayload> {
  const ais = await buildBrowserAis(options.onProgress);
  const results: Record<string, Aggregate> = {};

  for (const entry of ais) {
    options.onProgress?.(`Running ${entry.name}...`);
    results[entry.name] = await runOneAi(entry, options);
    await sleepFrame();
  }

  return {
    generatedAt: new Date().toISOString(),
    environment: "browser",
    games: options.games,
    maxPieces: options.maxPieces,
    seedBase: options.seedBase,
    aiCount: ais.length,
    results,
  };
}

function renderSummary(payload: BenchPayload): string {
  const rows = Object.entries(payload.results)
    .map(([name, a]) => {
      return [
        name.padEnd(13),
        `pieces ${String(a.piecesSurvived).padStart(5)}`,
        `topout ${String(a.topoutCount).padStart(3)}`,
        `atk ${String(a.attackSent).padStart(5)}`,
        `holes ${fmt(a.avgHoles, 2).padStart(6)}`,
        `h ${fmt(a.avgMaxHeight, 2).padStart(5)}`,
        `bump ${fmt(a.avgBumpiness, 2).padStart(6)}`,
        `tsd ${String(a.tsdCount).padStart(3)}`,
        `tst ${String(a.tstCount).padStart(3)}`,
        `ms ${fmt(a.avgDecisionTimeMs, 2).padStart(6)}`,
      ].join(" | ");
    })
    .join("\n");

  return [
    `TetraFlux Browser AI Benchmark`,
    `generated: ${payload.generatedAt}`,
    `games=${payload.games} maxPieces=${payload.maxPieces} seed=${payload.seedBase} ai=${payload.aiCount}`,
    "",
    rows,
  ].join("\n");
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
    <div class="bench-card">
      <div class="bench-header">
        <h2>AI Benchmark</h2>
        <button id="benchClose" class="small-button">×</button>
      </div>
      <div class="bench-controls">
        <label>games <input id="benchGames" type="number" min="1" max="500" step="1" value="8" /></label>
        <label>max pieces <input id="benchMaxPieces" type="number" min="20" max="2000" step="10" value="250" /></label>
        <label>seed <input id="benchSeed" type="number" step="1" value="1337" /></label>
        <button id="benchRun">Run</button>
        <button id="benchCancel" disabled>Cancel</button>
        <button id="benchDownload" disabled>Download JSON</button>
      </div>
      <pre id="benchOutput">Ready. Browser benchmark uses the same engine/AI modules as the app. Defaults are intentionally small to avoid freezing.</pre>
    </div>
  `;
  document.body.appendChild(panel);

  const closeBtn = panel.querySelector<HTMLButtonElement>("#benchClose")!;
  const runBtn = panel.querySelector<HTMLButtonElement>("#benchRun")!;
  const cancelBtn = panel.querySelector<HTMLButtonElement>("#benchCancel")!;
  const downloadBtn = panel.querySelector<HTMLButtonElement>("#benchDownload")!;
  const output = panel.querySelector<HTMLPreElement>("#benchOutput")!;
  const gamesInput = panel.querySelector<HTMLInputElement>("#benchGames")!;
  const maxPiecesInput = panel.querySelector<HTMLInputElement>("#benchMaxPieces")!;
  const seedInput = panel.querySelector<HTMLInputElement>("#benchSeed")!;

  let aborter: AbortController | null = null;
  let latestPayload: BenchPayload | null = null;

  button.addEventListener("click", () => {
    panel.hidden = false;
  });

  closeBtn.addEventListener("click", () => {
    if (aborter) aborter.abort();
    panel.hidden = true;
  });

  cancelBtn.addEventListener("click", () => {
    aborter?.abort();
  });

  downloadBtn.addEventListener("click", () => {
    if (latestPayload) downloadJson("tetraflux_browser_benchmark.json", latestPayload);
  });

  runBtn.addEventListener("click", async () => {
    const games = Math.max(1, Math.min(500, Math.floor(Number(gamesInput.value) || 8)));
    const maxPieces = Math.max(20, Math.min(2000, Math.floor(Number(maxPiecesInput.value) || 250)));
    const seedBase = Math.floor(Number(seedInput.value) || 1337);

    aborter = new AbortController();
    latestPayload = null;
    runBtn.disabled = true;
    cancelBtn.disabled = false;
    downloadBtn.disabled = true;
    output.textContent = `Starting benchmark...\ngames=${games} maxPieces=${maxPieces} seed=${seedBase}`;

    try {
      const payload = await runBrowserAiBenchmark({
        games,
        maxPieces,
        seedBase,
        signal: aborter.signal,
        onProgress: (message) => {
          output.textContent = `${message}\n\n${latestPayload ? renderSummary(latestPayload) : "Running..."}`;
        },
      });
      latestPayload = payload;
      output.textContent = renderSummary(payload);
      downloadBtn.disabled = false;
    } catch (err) {
      output.textContent = err instanceof DOMException && err.name === "AbortError"
        ? "Benchmark canceled."
        : `Benchmark failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      aborter = null;
      runBtn.disabled = false;
      cancelBtn.disabled = true;
    }
  });
}

ensureBenchmarkUi();
