import {
  checkpointBestProfile,
  createInitialHeuristicCheckpoint,
  parseHeuristicTrainingCheckpoint,
  type HeuristicTrainingCheckpoint,
  type HeuristicTrainingConfig,
} from "./training/heuristicTrainer";
import {
  parseHeuristicWeightProfile,
  type HeuristicWeightProfileV1,
} from "./training/heuristicWeights";
import {
  HEURISTIC_CHECKPOINT_STORAGE_KEY,
  clearStoredHeuristicProfile,
  describeStoredHeuristicProfile,
  readStoredHeuristicProfileSync,
  writeStoredHeuristicProfile,
} from "./training/browserHeuristicProfile";

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function randomSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || 123456789;
}

function numberValue(input: HTMLInputElement, fallback: number, min: number, max: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function readStoredCheckpoint(): HeuristicTrainingCheckpoint | null {
  try {
    const raw = localStorage.getItem(HEURISTIC_CHECKPOINT_STORAGE_KEY);
    return raw ? parseHeuristicTrainingCheckpoint(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function ensureTrainingUi(): void {
  const toolbar = document.querySelector<HTMLDivElement>("#toolbar");
  if (!toolbar || document.querySelector("#trainHeuristicBrowser")) return;
  const button = document.createElement("button");
  button.id = "trainHeuristicBrowser";
  button.textContent = "Train AI";
  toolbar.appendChild(button);

  const panel = document.createElement("div");
  panel.id = "trainHeuristicPanel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="bench-card" data-training-panel="true">
      <div class="bench-header">
        <h2>Heuristic Weight Training</h2>
        <button id="trainClose" class="small-button">×</button>
      </div>
      <p class="hint">Training is separate from AI Benchmark. The best profile is stored in this browser and becomes <b>Learned Heuristic</b> in AI Battle and Bench AI immediately.</p>
      <div class="bench-controls">
        <label>generations <input id="trainGenerations" type="number" min="1" max="10000" step="1" value="10" /></label>
        <label>population <input id="trainPopulation" type="number" min="2" max="128" step="1" value="12" /></label>
        <label>elite <input id="trainElite" type="number" min="1" max="64" step="1" value="3" /></label>
        <label>games/candidate <input id="trainGames" type="number" min="1" max="256" step="1" value="4" /></label>
        <label>max pieces <input id="trainMaxPieces" type="number" min="20" max="5000" step="10" value="200" /></label>
        <label>seed <input id="trainSeed" type="number" step="1" placeholder="random" /></label>
        <label>sigma <input id="trainSigma" type="number" min="0.001" max="2" step="0.01" value="0.18" /></label>
      </div>
      <div class="bench-controls">
        <button id="trainStart">Start New</button>
        <button id="trainResume">Resume Saved</button>
        <button id="trainCancel" disabled>Cancel</button>
        <button id="trainDownloadProfile" disabled>Download Best Profile</button>
        <button id="trainDownloadCheckpoint" disabled>Download Checkpoint</button>
        <label class="small-button">Import Profile<input id="trainImportProfile" type="file" accept="application/json,.json" hidden /></label>
        <label class="small-button">Import Checkpoint<input id="trainImportCheckpoint" type="file" accept="application/json,.json" hidden /></label>
        <button id="trainClearSaved">Clear Saved</button>
      </div>
      <div id="trainProfileSummary" class="hint">Learned profile: none</div>
      <pre id="trainOutput">Ready. The browser trainer runs in its own Web Worker.</pre>
    </div>`;
  document.body.appendChild(panel);

  const close = panel.querySelector<HTMLButtonElement>("#trainClose")!;
  const start = panel.querySelector<HTMLButtonElement>("#trainStart")!;
  const resume = panel.querySelector<HTMLButtonElement>("#trainResume")!;
  const cancel = panel.querySelector<HTMLButtonElement>("#trainCancel")!;
  const downloadProfile = panel.querySelector<HTMLButtonElement>("#trainDownloadProfile")!;
  const downloadCheckpoint = panel.querySelector<HTMLButtonElement>("#trainDownloadCheckpoint")!;
  const importProfile = panel.querySelector<HTMLInputElement>("#trainImportProfile")!;
  const importCheckpoint = panel.querySelector<HTMLInputElement>("#trainImportCheckpoint")!;
  const clearSaved = panel.querySelector<HTMLButtonElement>("#trainClearSaved")!;
  const profileSummary = panel.querySelector<HTMLElement>("#trainProfileSummary")!;
  const output = panel.querySelector<HTMLPreElement>("#trainOutput")!;
  const generationsInput = panel.querySelector<HTMLInputElement>("#trainGenerations")!;
  const populationInput = panel.querySelector<HTMLInputElement>("#trainPopulation")!;
  const eliteInput = panel.querySelector<HTMLInputElement>("#trainElite")!;
  const gamesInput = panel.querySelector<HTMLInputElement>("#trainGames")!;
  const maxPiecesInput = panel.querySelector<HTMLInputElement>("#trainMaxPieces")!;
  const seedInput = panel.querySelector<HTMLInputElement>("#trainSeed")!;
  const sigmaInput = panel.querySelector<HTMLInputElement>("#trainSigma")!;

  let worker: Worker | null = null;
  let latestCheckpoint: HeuristicTrainingCheckpoint | null = readStoredCheckpoint();
  let latestProfile: HeuristicWeightProfileV1 | null = readStoredHeuristicProfileSync()
    ?? (latestCheckpoint ? checkpointBestProfile(latestCheckpoint) : null);

  const refreshButtons = () => {
    resume.disabled = !latestCheckpoint || !!worker;
    downloadProfile.disabled = !latestProfile;
    downloadCheckpoint.disabled = !latestCheckpoint;
    profileSummary.textContent = describeStoredHeuristicProfile(latestProfile);
  };

  const stop = () => {
    worker?.terminate();
    worker = null;
    start.disabled = false;
    cancel.disabled = true;
    refreshButtons();
  };

  const saveProfile = async (profileInput: unknown): Promise<HeuristicWeightProfileV1> => {
    latestProfile = await writeStoredHeuristicProfile(profileInput);
    refreshButtons();
    return latestProfile;
  };

  const saveCheckpoint = async (checkpoint: HeuristicTrainingCheckpoint): Promise<void> => {
    latestCheckpoint = checkpoint;
    localStorage.setItem(HEURISTIC_CHECKPOINT_STORAGE_KEY, JSON.stringify(checkpoint));
    await saveProfile(checkpointBestProfile(checkpoint));
  };

  if (latestProfile) void saveProfile(latestProfile);

  const run = (checkpoint: HeuristicTrainingCheckpoint | null) => {
    const generations = Math.floor(numberValue(generationsInput, 10, 1, 10_000));
    const seedText = seedInput.value.trim();
    const seedRaw = Number(seedText);
    const seed = seedText.length > 0 && Number.isFinite(seedRaw) ? Math.floor(seedRaw) >>> 0 : randomSeed();
    const population = Math.floor(numberValue(populationInput, 12, 2, 128));
    const config: Partial<HeuristicTrainingConfig> = {
      population,
      eliteCount: Math.floor(numberValue(eliteInput, 3, 1, Math.max(1, population - 1))),
      gamesPerCandidate: Math.floor(numberValue(gamesInput, 4, 1, 256)),
      maxPieces: Math.floor(numberValue(maxPiecesInput, 200, 20, 5000)),
      trainingSeedBase: seed,
      initialSigma: numberValue(sigmaInput, 0.18, 0.001, 2),
      fixedKeys: ["holeWeight"],
    };
    const initial = checkpoint ?? createInitialHeuristicCheckpoint(config);
    worker = new Worker(new URL("./training/heuristicTrainingWorker.ts", import.meta.url), { type: "module" });
    start.disabled = true;
    resume.disabled = true;
    cancel.disabled = false;
    output.textContent = `Starting training...\ngenerations=${generations} population=${initial.config.population} games=${initial.config.gamesPerCandidate} maxPieces=${initial.config.maxPieces} seed=${initial.config.trainingSeedBase}`;
    worker.onmessage = async (event: MessageEvent<any>) => {
      const message = event.data;
      if (message.type === "candidate") {
        output.textContent = `Generation ${message.generation}: candidate ${message.completed}/${message.total}\nfitness=${Number(message.fitness).toFixed(2)} survival=${(Number(message.survivalRate) * 100).toFixed(1)}%`;
      } else if (message.type === "generation") {
        const result = message.result;
        await saveCheckpoint(result.checkpoint);
        output.textContent = `Generation ${result.generation} complete\nbest fitness=${Number(result.best.fitness).toFixed(2)}\nsurvival=${(Number(result.best.aggregate.survivalRate) * 100).toFixed(1)}% topouts=${result.best.aggregate.topouts}/${result.best.aggregate.games}\nSaved as Learned Heuristic for AI Battle and Bench AI.`;
      } else if (message.type === "finished") {
        await saveCheckpoint(message.checkpoint);
        output.textContent += "\nTraining finished. Learned Heuristic is ready to use.";
        stop();
      } else if (message.type === "error" || message.type === "canceled") {
        output.textContent += `\n${message.message ?? message.type}`;
        stop();
      }
    };
    worker.onerror = (event) => {
      output.textContent = `Training worker crashed: ${event.message}`;
      stop();
    };
    worker.postMessage({ type: "run", generations, config, checkpoint: initial });
  };

  button.addEventListener("click", () => { panel.hidden = false; refreshButtons(); });
  close.addEventListener("click", () => { if (!worker) panel.hidden = true; });
  start.addEventListener("click", () => run(null));
  resume.addEventListener("click", () => { if (latestCheckpoint) run(latestCheckpoint); });
  cancel.addEventListener("click", () => {
    worker?.postMessage({ type: "cancel" });
    output.textContent += "\nCanceling...";
  });
  downloadProfile.addEventListener("click", () => { if (latestProfile) downloadJson("heuristic-flat-v1.json", latestProfile); });
  downloadCheckpoint.addEventListener("click", () => { if (latestCheckpoint) downloadJson("heuristic-flat-v1-checkpoint.json", latestCheckpoint); });
  importProfile.addEventListener("change", async () => {
    const file = importProfile.files?.[0];
    if (!file) return;
    try {
      const profile = parseHeuristicWeightProfile(JSON.parse(await file.text()));
      await saveProfile(profile);
      output.textContent = `Imported ${profile.profileId}. It is now available as Learned Heuristic.`;
    } catch (error) {
      output.textContent = `Profile import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      importProfile.value = "";
    }
  });
  importCheckpoint.addEventListener("change", async () => {
    const file = importCheckpoint.files?.[0];
    if (!file) return;
    try {
      const checkpoint = parseHeuristicTrainingCheckpoint(JSON.parse(await file.text()));
      await saveCheckpoint(checkpoint);
      output.textContent = `Imported checkpoint at generation ${checkpoint.generation}.`;
    } catch (error) {
      output.textContent = `Checkpoint import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      importCheckpoint.value = "";
    }
  });
  clearSaved.addEventListener("click", async () => {
    localStorage.removeItem(HEURISTIC_CHECKPOINT_STORAGE_KEY);
    await clearStoredHeuristicProfile();
    latestCheckpoint = null;
    latestProfile = null;
    output.textContent = "Saved training checkpoint and Learned Heuristic profile cleared.";
    refreshButtons();
  });
  refreshButtons();
}

ensureTrainingUi();
