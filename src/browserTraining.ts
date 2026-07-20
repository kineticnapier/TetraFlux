import type { HeuristicTrainingConfig } from "./training/heuristicTrainer";
import { describeStoredHeuristicProfile } from "./training/browserHeuristicProfile";
import {
  BrowserTrainingController,
  type BrowserTrainingRunRequest,
} from "./training/browser/trainingController";

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

function automaticWorkerCount(): number {
  const cores = Math.max(1, Math.floor(navigator.hardwareConcurrency || 2));
  return Math.min(8, Math.max(1, cores - 1));
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
      <p class="hint">Candidate games run in a CPU Web Worker pool. The best profile is stored locally and becomes <b>Learned Heuristic</b> in AI Battle and Bench AI.</p>
      <div class="bench-controls">
        <label>generations <input id="trainGenerations" type="number" min="1" max="10000" step="1" value="10" /></label>
        <label>population <input id="trainPopulation" type="number" min="2" max="128" step="1" value="16" /></label>
        <label>elite <input id="trainElite" type="number" min="1" max="64" step="1" value="4" /></label>
        <label>games/candidate <input id="trainGames" type="number" min="1" max="256" step="1" value="8" /></label>
        <label>max pieces <input id="trainMaxPieces" type="number" min="20" max="5000" step="10" value="300" /></label>
        <label>seed <input id="trainSeed" type="number" step="1" placeholder="random" /></label>
        <label>sigma <input id="trainSigma" type="number" min="0.001" max="2" step="0.01" value="0.18" /></label>
        <label>parallel workers <input id="trainParallelWorkers" type="number" min="0" max="16" step="1" value="0" title="0 = Auto" /></label>
      </div>
      <div class="hint" id="trainWorkerHint">parallel workers: Auto</div>
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
      <pre id="trainOutput">Ready. Training runs in a dedicated coordinator worker.</pre>
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
  const workerHint = panel.querySelector<HTMLElement>("#trainWorkerHint")!;
  const generationsInput = panel.querySelector<HTMLInputElement>("#trainGenerations")!;
  const populationInput = panel.querySelector<HTMLInputElement>("#trainPopulation")!;
  const eliteInput = panel.querySelector<HTMLInputElement>("#trainElite")!;
  const gamesInput = panel.querySelector<HTMLInputElement>("#trainGames")!;
  const maxPiecesInput = panel.querySelector<HTMLInputElement>("#trainMaxPieces")!;
  const seedInput = panel.querySelector<HTMLInputElement>("#trainSeed")!;
  const sigmaInput = panel.querySelector<HTMLInputElement>("#trainSigma")!;
  const parallelWorkersInput = panel.querySelector<HTMLInputElement>("#trainParallelWorkers")!;

  const effectiveWorkerCount = (): number => {
    const requested = Math.floor(numberValue(parallelWorkersInput, 0, 0, 16));
    return requested === 0 ? automaticWorkerCount() : Math.max(1, requested);
  };

  const refreshWorkerHint = () => {
    const requested = Math.floor(numberValue(parallelWorkersInput, 0, 0, 16));
    workerHint.textContent = requested === 0
      ? `parallel workers: Auto → ${effectiveWorkerCount()} (logical CPU cores=${navigator.hardwareConcurrency || "unknown"})`
      : `parallel workers: ${effectiveWorkerCount()}`;
  };

  const readRunRequest = (): BrowserTrainingRunRequest => {
    const population = Math.floor(numberValue(populationInput, 16, 2, 128));
    const seedText = seedInput.value.trim();
    const seedRaw = Number(seedText);
    const config: Partial<HeuristicTrainingConfig> = {
      population,
      eliteCount: Math.floor(numberValue(eliteInput, 4, 1, Math.max(1, population - 1))),
      gamesPerCandidate: Math.floor(numberValue(gamesInput, 8, 1, 256)),
      maxPieces: Math.floor(numberValue(maxPiecesInput, 300, 20, 5000)),
      trainingSeedBase: seedText.length > 0 && Number.isFinite(seedRaw) ? Math.floor(seedRaw) >>> 0 : randomSeed(),
      initialSigma: numberValue(sigmaInput, 0.18, 0.001, 2),
      fixedKeys: ["holeWeight"],
    };
    return {
      generations: Math.floor(numberValue(generationsInput, 10, 1, 10_000)),
      parallelWorkers: effectiveWorkerCount(),
      config,
    };
  };

  const controller = new BrowserTrainingController({
    onState: (state) => {
      start.disabled = state.running;
      resume.disabled = state.running || !state.checkpoint;
      cancel.disabled = !state.running;
      downloadProfile.disabled = !state.profile;
      downloadCheckpoint.disabled = !state.checkpoint;
      clearSaved.disabled = state.running;
      profileSummary.textContent = describeStoredHeuristicProfile(state.profile);
    },
    onStarted: (message) => {
      output.textContent = `Training started\nscheduler=${message.scheduler} workers=${message.parallelWorkers}`;
    },
    onCandidate: (message) => {
      output.textContent = `Generation ${message.generation}: candidate ${message.completed}/${message.total}\nworker result candidate=${message.candidateIndex}\nfitness=${Number(message.fitness).toFixed(2)} survival=${(Number(message.survivalRate) * 100).toFixed(1)}%\nscheduler=${message.scheduler} workers=${message.parallelWorkers}`;
    },
    onGeneration: (message) => {
      const result = message.result;
      output.textContent = `Generation ${result.generation} complete\nbest fitness=${Number(result.best.fitness).toFixed(2)}\nsurvival=${(Number(result.best.aggregate.survivalRate) * 100).toFixed(1)}% topouts=${result.best.aggregate.topouts}/${result.best.aggregate.games}\nscheduler=${message.scheduler} workers=${message.parallelWorkers}\nSaved as Learned Heuristic.`;
    },
    onFinished: (message) => {
      output.textContent += message.type === "canceled"
        ? "\nTraining canceled. Last completed generation remains saved."
        : "\nTraining finished. Learned Heuristic is ready to use.";
    },
    onError: (message) => {
      output.textContent = `Training failed: ${message}\nSet parallel workers to 1 to test the sequential fallback.`;
    },
  });

  refreshWorkerHint();
  parallelWorkersInput.addEventListener("input", refreshWorkerHint);
  parallelWorkersInput.addEventListener("change", refreshWorkerHint);

  button.addEventListener("click", () => { panel.hidden = false; });
  close.addEventListener("click", () => { if (!controller.state.running) panel.hidden = true; });
  start.addEventListener("click", () => {
    const request = readRunRequest();
    output.textContent = `Starting new training...\nworkers=${request.parallelWorkers}`;
    controller.start(request);
  });
  resume.addEventListener("click", () => {
    const request = readRunRequest();
    output.textContent = `Resuming saved checkpoint...\nworkers=${request.parallelWorkers}`;
    controller.resume(request);
  });
  cancel.addEventListener("click", () => {
    controller.cancel();
    output.textContent += "\nCanceling active workers...";
  });
  downloadProfile.addEventListener("click", () => {
    const profile = controller.state.profile;
    if (profile) downloadJson("heuristic-flat-v1.json", profile);
  });
  downloadCheckpoint.addEventListener("click", () => {
    const checkpoint = controller.state.checkpoint;
    if (checkpoint) downloadJson("heuristic-flat-v1-checkpoint.json", checkpoint);
  });
  importProfile.addEventListener("change", async () => {
    const file = importProfile.files?.[0];
    if (!file) return;
    try {
      const profile = await controller.importProfile(JSON.parse(await file.text()));
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
      const checkpoint = await controller.importCheckpoint(JSON.parse(await file.text()));
      output.textContent = `Imported checkpoint at generation ${checkpoint.generation}.`;
    } catch (error) {
      output.textContent = `Checkpoint import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      importCheckpoint.value = "";
    }
  });
  clearSaved.addEventListener("click", async () => {
    try {
      await controller.clearSaved();
      output.textContent = "Saved checkpoint and Learned Heuristic profile cleared.";
    } catch (error) {
      output.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  window.addEventListener("beforeunload", () => controller.dispose());
}

ensureTrainingUi();
