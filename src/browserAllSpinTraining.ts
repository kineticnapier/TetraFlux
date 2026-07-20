import {
  fetchCloudModel,
  fetchLatestCloudModel,
  listCloudModels,
  readActiveCloudModelId,
  readCloudModelWriteToken,
  storeActiveCloudModelId,
  storeCloudModelWriteToken,
  uploadCloudModel,
  wrapModelPayload,
} from "./models/cloudModelClient";
import { describeStoredAllSpinProfile } from "./training/browserAllSpinProfile";
import {
  AllSpinTrainingController,
  type AllSpinTrainingRunRequest,
} from "./training/browser/allSpinTrainingController";
import type { AllSpinTrainingConfig } from "./training/allspinTrainer";
import {
  ALLSPIN_PROFILE_FORMAT,
  parseAllSpinWeightProfile,
  type AllSpinSearchProfile,
} from "./training/allspinWeights";

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
  return values[0] || 246813579;
}

function numberValue(input: HTMLInputElement, fallback: number, min: number, max: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function automaticWorkerCount(): number {
  const cores = Math.max(1, Math.floor(navigator.hardwareConcurrency || 2));
  return Math.min(8, Math.max(1, cores - 1));
}

function ensureAllSpinTrainingUi(): void {
  const toolbar = document.querySelector<HTMLDivElement>("#toolbar");
  if (!toolbar || document.querySelector("#trainAllSpinBrowser")) return;

  const trigger = document.createElement("button");
  trigger.id = "trainAllSpinBrowser";
  trigger.textContent = "Train All-Spin";
  toolbar.appendChild(trigger);

  const panel = document.createElement("div");
  panel.id = "trainAllSpinPanel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="bench-card" data-allspin-training-panel="true">
      <div class="bench-header">
        <h2>All-Spin Training</h2>
        <button id="allspinClose" class="small-button">×</button>
      </div>
      <p class="hint">The current <b>Learned Heuristic</b> is frozen as the parent board evaluator. CEM learns only the 10 All-Spin scoring weights. Candidate games use deterministic node budgets in CPU workers.</p>

      <section class="tool-section">
        <h3>Parent model</h3>
        <div id="allspinBaseSummary" class="hint">Learned Heuristic: none</div>
        <button id="allspinRefreshBase" type="button">Refresh parent profile</button>
      </section>

      <section class="tool-section">
        <h3>Training size</h3>
        <div class="bench-controls">
          <label>generations <input id="allspinGenerations" type="number" min="1" max="10000" step="1" value="10" /></label>
          <label>population <input id="allspinPopulation" type="number" min="2" max="64" step="1" value="8" /></label>
          <label>games/candidate <input id="allspinGames" type="number" min="1" max="32" step="1" value="2" /></label>
          <label>max pieces <input id="allspinMaxPieces" type="number" min="20" max="1000" step="10" value="100" /></label>
          <label>parallel workers <input id="allspinWorkers" type="number" min="0" max="16" step="1" value="0" title="0 = Auto" /></label>
        </div>
        <div id="allspinWorkerHint" class="hint">parallel workers: Auto</div>
      </section>

      <details class="tool-details">
        <summary>Deterministic search and optimizer settings</summary>
        <div class="bench-controls">
          <label>expanded nodes <input id="allspinNodes" type="number" min="16" max="5000" step="8" value="160" /></label>
          <label>depth <input id="allspinDepth" type="number" min="1" max="4" step="1" value="2" /></label>
          <label>beam <input id="allspinBeam" type="number" min="1" max="200" step="1" value="32" /></label>
          <label>candidates/node <input id="allspinCandidates" type="number" min="4" max="160" step="1" value="36" /></label>
          <label>twist choices <input id="allspinTwistChoices" type="number" min="0" max="80" step="1" value="14" /></label>
          <label>twist states <input id="allspinTwistStates" type="number" min="100" max="12000" step="100" value="1600" /></label>
          <label>route length <input id="allspinPath" type="number" min="4" max="120" step="1" value="44" /></label>
          <label>elite <input id="allspinElite" type="number" min="1" max="32" step="1" value="2" /></label>
          <label>seed <input id="allspinSeed" type="number" step="1" placeholder="random" /></label>
          <label>sigma <input id="allspinSigma" type="number" min="0.001" max="2" step="0.01" value="0.20" /></label>
        </div>
      </details>

      <section class="tool-section">
        <h3>Start mode</h3>
        <div class="bench-controls">
          <button id="allspinStartFromFlat">Start From Learned Heuristic</button>
          <button id="allspinStartFromProfile" disabled>Restart From Learned All-Spin</button>
          <button id="allspinResume" disabled>Resume Checkpoint</button>
          <button id="allspinCancel" disabled>Cancel</button>
        </div>
        <div id="allspinProfileSummary" class="hint">Learned All-Spin: none</div>
      </section>

      <details class="tool-details" open>
        <summary>Cloudflare model registry</summary>
        <div class="bench-controls">
          <label>write token <input id="allspinCloudToken" type="password" autocomplete="off" placeholder="MODEL_WRITE_TOKEN" /></label>
          <button id="allspinCloudUpload" disabled>Upload Current Model</button>
          <button id="allspinCloudLatest">Load Latest Cloud Model</button>
          <button id="allspinCloudRefresh">Refresh List</button>
          <select id="allspinCloudModels"><option value="">Cloud models...</option></select>
          <button id="allspinCloudLoadSelected" disabled>Load Selected</button>
        </div>
        <div id="allspinCloudStatus" class="hint">Cloud registry not checked.</div>
      </details>

      <details class="tool-details">
        <summary>Local profile and checkpoint files</summary>
        <div class="bench-controls">
          <button id="allspinDownloadProfile" disabled>Download Profile</button>
          <button id="allspinDownloadCheckpoint" disabled>Download Checkpoint</button>
          <label class="small-button">Import Profile<input id="allspinImportProfile" type="file" accept="application/json,.json" hidden /></label>
          <label class="small-button">Import Checkpoint<input id="allspinImportCheckpoint" type="file" accept="application/json,.json" hidden /></label>
          <button id="allspinClearSaved">Clear Local All-Spin</button>
        </div>
      </details>

      <pre id="allspinOutput">Ready. Start with a Learned Heuristic profile.</pre>
    </div>`;
  document.body.appendChild(panel);

  const q = <T extends Element>(selector: string) => panel.querySelector<T>(selector)!;
  const close = q<HTMLButtonElement>("#allspinClose");
  const refreshBase = q<HTMLButtonElement>("#allspinRefreshBase");
  const startFromFlat = q<HTMLButtonElement>("#allspinStartFromFlat");
  const startFromProfile = q<HTMLButtonElement>("#allspinStartFromProfile");
  const resume = q<HTMLButtonElement>("#allspinResume");
  const cancel = q<HTMLButtonElement>("#allspinCancel");
  const downloadProfile = q<HTMLButtonElement>("#allspinDownloadProfile");
  const downloadCheckpoint = q<HTMLButtonElement>("#allspinDownloadCheckpoint");
  const importProfile = q<HTMLInputElement>("#allspinImportProfile");
  const importCheckpoint = q<HTMLInputElement>("#allspinImportCheckpoint");
  const clearSaved = q<HTMLButtonElement>("#allspinClearSaved");
  const output = q<HTMLPreElement>("#allspinOutput");
  const baseSummary = q<HTMLElement>("#allspinBaseSummary");
  const profileSummary = q<HTMLElement>("#allspinProfileSummary");
  const workerHint = q<HTMLElement>("#allspinWorkerHint");
  const cloudToken = q<HTMLInputElement>("#allspinCloudToken");
  const cloudUpload = q<HTMLButtonElement>("#allspinCloudUpload");
  const cloudLatest = q<HTMLButtonElement>("#allspinCloudLatest");
  const cloudRefresh = q<HTMLButtonElement>("#allspinCloudRefresh");
  const cloudModels = q<HTMLSelectElement>("#allspinCloudModels");
  const cloudLoadSelected = q<HTMLButtonElement>("#allspinCloudLoadSelected");
  const cloudStatus = q<HTMLElement>("#allspinCloudStatus");

  const generations = q<HTMLInputElement>("#allspinGenerations");
  const population = q<HTMLInputElement>("#allspinPopulation");
  const games = q<HTMLInputElement>("#allspinGames");
  const maxPieces = q<HTMLInputElement>("#allspinMaxPieces");
  const workers = q<HTMLInputElement>("#allspinWorkers");
  const nodes = q<HTMLInputElement>("#allspinNodes");
  const depth = q<HTMLInputElement>("#allspinDepth");
  const beam = q<HTMLInputElement>("#allspinBeam");
  const candidates = q<HTMLInputElement>("#allspinCandidates");
  const twistChoices = q<HTMLInputElement>("#allspinTwistChoices");
  const twistStates = q<HTMLInputElement>("#allspinTwistStates");
  const path = q<HTMLInputElement>("#allspinPath");
  const elite = q<HTMLInputElement>("#allspinElite");
  const seed = q<HTMLInputElement>("#allspinSeed");
  const sigma = q<HTMLInputElement>("#allspinSigma");

  cloudToken.value = readCloudModelWriteToken();

  const effectiveWorkers = (): number => {
    const requested = Math.floor(numberValue(workers, 0, 0, 16));
    return requested === 0 ? automaticWorkerCount() : Math.max(1, requested);
  };
  const refreshWorkerHint = () => {
    const requested = Math.floor(numberValue(workers, 0, 0, 16));
    workerHint.textContent = requested === 0
      ? `parallel workers: Auto → ${effectiveWorkers()} (logical CPU cores=${navigator.hardwareConcurrency || "unknown"})`
      : `parallel workers: ${effectiveWorkers()}`;
  };

  const readRequest = (): AllSpinTrainingRunRequest => {
    const populationValue = Math.floor(numberValue(population, 8, 2, 64));
    const seedText = seed.value.trim();
    const seedValue = Number(seedText);
    const config: Partial<AllSpinTrainingConfig> = {
      population: populationValue,
      eliteCount: Math.floor(numberValue(elite, 2, 1, Math.max(1, populationValue - 1))),
      gamesPerCandidate: Math.floor(numberValue(games, 2, 1, 32)),
      maxPieces: Math.floor(numberValue(maxPieces, 100, 20, 1000)),
      trainingSeedBase: seedText && Number.isFinite(seedValue) ? Math.floor(seedValue) >>> 0 : randomSeed(),
      initialSigma: numberValue(sigma, 0.2, 0.001, 2),
    };
    const search: Partial<AllSpinSearchProfile> = {
      depth: Math.floor(numberValue(depth, 2, 1, 4)),
      beamWidth: Math.floor(numberValue(beam, 32, 1, 200)),
      maxExpandedNodes: Math.floor(numberValue(nodes, 160, 16, 5000)),
      maxCandidatesPerNode: Math.floor(numberValue(candidates, 36, 4, 160)),
      maxTwistCandidates: Math.floor(numberValue(twistChoices, 14, 0, 80)),
      maxTwistStates: Math.floor(numberValue(twistStates, 1600, 100, 12000)),
      maxTwistPathLength: Math.floor(numberValue(path, 44, 4, 120)),
    };
    return {
      generations: Math.floor(numberValue(generations, 10, 1, 10_000)),
      parallelWorkers: effectiveWorkers(),
      config,
      search,
      parentModelId: readActiveCloudModelId("flat") ?? undefined,
    };
  };

  const controller = new AllSpinTrainingController({
    onState: (state) => {
      baseSummary.textContent = state.baseProfile
        ? `Learned Heuristic: ${state.baseProfile.profileId}${readActiveCloudModelId("flat") ? ` · cloud=${readActiveCloudModelId("flat")}` : ""}`
        : "Learned Heuristic: none — train or load a Flat model first";
      profileSummary.textContent = describeStoredAllSpinProfile(state.profile);
      startFromFlat.disabled = state.running || !state.baseProfile;
      startFromProfile.disabled = state.running || !state.profile;
      resume.disabled = state.running || !state.checkpoint;
      cancel.disabled = !state.running;
      downloadProfile.disabled = !state.profile;
      downloadCheckpoint.disabled = !state.checkpoint;
      clearSaved.disabled = state.running;
      cloudUpload.disabled = state.running || !state.profile;
    },
    onStarted: (message) => {
      output.textContent = `All-Spin training started\nscheduler=${message.scheduler} workers=${message.parallelWorkers}`;
    },
    onCandidate: (message) => {
      output.textContent = `Candidate ${message.completed}/${message.total}\nfitness=${Number(message.fitness).toFixed(2)}\nsurvival=${(Number(message.survivalRate) * 100).toFixed(1)}%\nAll-Spin clears/piece=${Number(message.allSpinRate).toFixed(4)}\nscheduler=${message.scheduler} workers=${message.parallelWorkers}`;
    },
    onGeneration: (message) => {
      const result = message.result;
      const aggregate = result.best.aggregate;
      output.textContent = `Generation ${result.generation} complete\nbest fitness=${Number(result.best.fitness).toFixed(2)}\nsurvival=${(Number(aggregate.survivalRate) * 100).toFixed(1)}% topouts=${aggregate.topouts}/${aggregate.games}\nAll-Spin clears=${aggregate.allSpinClears} rate=${Number(aggregate.allSpinClearsPerPiece).toFixed(4)}\nspin pieces=${aggregate.uniqueSpinPieces}/6 max chain=${aggregate.maxSpinChain}\nSaved as Learned All-Spin.`;
    },
    onFinished: (message) => {
      output.textContent += message.type === "canceled"
        ? "\nTraining canceled. Last completed generation remains saved."
        : "\nTraining finished.";
    },
    onError: (message) => {
      output.textContent = `All-Spin training failed: ${message}\nTry parallel workers = 1 for diagnosis.`;
    },
  });

  async function refreshCloudList(): Promise<void> {
    cloudStatus.textContent = "Loading Cloudflare model list...";
    try {
      const response = await listCloudModels("allspin");
      cloudModels.textContent = "";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = response.models.length ? "Select an All-Spin model..." : "No All-Spin models uploaded";
      cloudModels.appendChild(empty);
      for (const model of response.models) {
        const option = document.createElement("option");
        option.value = model.modelId;
        option.textContent = `${model.displayName} · ${model.modelId}`;
        cloudModels.appendChild(option);
      }
      cloudStatus.textContent = `Cloudflare: ${response.models.length} All-Spin model(s). latest=${response.latest.allspin ?? "none"}`;
    } catch (error) {
      cloudStatus.textContent = `Cloud registry unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function loadEnvelope(modelId?: string): Promise<void> {
    cloudStatus.textContent = "Loading model from Cloudflare...";
    const envelope = modelId ? await fetchCloudModel(modelId) : await fetchLatestCloudModel("allspin");
    if (!envelope) throw new Error("No All-Spin model is stored in Cloudflare");
    if (envelope.family !== "allspin" || envelope.payloadFormat !== ALLSPIN_PROFILE_FORMAT) {
      throw new Error(`Cloud model ${envelope.modelId} is not an All-Spin v1 profile`);
    }
    const profile = parseAllSpinWeightProfile(envelope.payload);
    await controller.importProfile(profile);
    storeActiveCloudModelId("allspin", envelope.modelId);
    cloudStatus.textContent = `Loaded ${envelope.displayName} (${envelope.modelId})`;
  }

  refreshWorkerHint();
  workers.addEventListener("input", refreshWorkerHint);
  workers.addEventListener("change", refreshWorkerHint);
  trigger.addEventListener("click", () => { panel.hidden = false; });
  close.addEventListener("click", () => { if (!controller.state.running) panel.hidden = true; });
  refreshBase.addEventListener("click", () => controller.refreshBaseProfile());
  startFromFlat.addEventListener("click", () => {
    const request = readRequest();
    output.textContent = `Starting All-Spin from ${controller.state.baseProfile?.profileId ?? "missing Flat profile"}...`;
    controller.start(request);
  });
  startFromProfile.addEventListener("click", () => {
    const profile = controller.state.profile;
    if (!profile) return;
    const request = readRequest();
    output.textContent = `Restarting optimizer around ${profile.profileId}...`;
    controller.start({ ...request, initialProfile: profile });
  });
  resume.addEventListener("click", () => {
    const request = readRequest();
    output.textContent = "Resuming saved All-Spin checkpoint...";
    controller.resume(request);
  });
  cancel.addEventListener("click", () => {
    controller.cancel();
    output.textContent += "\nCanceling workers...";
  });
  downloadProfile.addEventListener("click", () => {
    const profile = controller.state.profile;
    if (profile) downloadJson(`${profile.profileId}.json`, profile);
  });
  downloadCheckpoint.addEventListener("click", () => {
    const checkpoint = controller.state.checkpoint;
    if (checkpoint) downloadJson("allspin-checkpoint-v1.json", checkpoint);
  });
  importProfile.addEventListener("change", async () => {
    const file = importProfile.files?.[0];
    if (!file) return;
    try {
      const profile = await controller.importProfile(JSON.parse(await file.text()));
      output.textContent = `Imported ${profile.profileId}.`;
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
      output.textContent = `Imported All-Spin checkpoint at generation ${checkpoint.generation}.`;
    } catch (error) {
      output.textContent = `Checkpoint import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      importCheckpoint.value = "";
    }
  });
  clearSaved.addEventListener("click", async () => {
    try {
      await controller.clearSaved();
      storeActiveCloudModelId("allspin", null);
      output.textContent = "Local All-Spin checkpoint/profile cleared.";
    } catch (error) {
      output.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  cloudToken.addEventListener("change", () => storeCloudModelWriteToken(cloudToken.value));
  cloudUpload.addEventListener("click", async () => {
    const profile = controller.state.profile;
    if (!profile) return;
    try {
      cloudStatus.textContent = "Uploading model to Cloudflare...";
      const generation = profile.training?.generation ?? 0;
      const envelope = wrapModelPayload({
        family: "allspin",
        generation,
        payloadFormat: profile.format,
        payload: profile,
        parentModelId: readActiveCloudModelId("flat") ?? profile.training?.parentModelId,
        displayName: `All-Spin G${generation} · base ${profile.baseHeuristic.profileId}`,
      });
      const saved = await uploadCloudModel(envelope, cloudToken.value);
      cloudStatus.textContent = `Uploaded ${saved.displayName} as ${saved.modelId}`;
      await refreshCloudList();
    } catch (error) {
      cloudStatus.textContent = `Upload failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  cloudLatest.addEventListener("click", async () => {
    try { await loadEnvelope(); } catch (error) { cloudStatus.textContent = error instanceof Error ? error.message : String(error); }
  });
  cloudRefresh.addEventListener("click", () => void refreshCloudList());
  cloudModels.addEventListener("change", () => { cloudLoadSelected.disabled = !cloudModels.value; });
  cloudLoadSelected.addEventListener("click", async () => {
    if (!cloudModels.value) return;
    try { await loadEnvelope(cloudModels.value); } catch (error) { cloudStatus.textContent = error instanceof Error ? error.message : String(error); }
  });
  window.addEventListener("beforeunload", () => controller.dispose());
  void refreshCloudList();
}

ensureAllSpinTrainingUi();
