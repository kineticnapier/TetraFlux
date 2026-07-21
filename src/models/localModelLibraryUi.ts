import {
  deleteLocalModel,
  getLocalModel,
  listLocalModels,
  readActiveLocalModelId,
  renameLocalModel,
  saveLocalModel,
  setActiveLocalModelId,
} from "./localModelLibrary";
import {
  exportLocalModelLibrary,
  importLocalModelLibrary,
} from "./localModelLibraryTransfer";
import type { ModelEnvelopeV1, ModelFamily } from "./modelEnvelope";

export interface LocalModelLibraryElements {
  save: HTMLButtonElement;
  select: HTMLSelectElement;
  load: HTMLButtonElement;
  rename: HTMLButtonElement;
  remove: HTMLButtonElement;
  exportSelected: HTMLButtonElement;
  exportAll: HTMLButtonElement;
  importFile: HTMLInputElement;
  status: HTMLElement;
}

export interface LocalModelLibraryUiOptions<T> {
  family: ModelFamily;
  payloadFormat: string;
  elements: LocalModelLibraryElements;
  getCurrentPayload: () => T | null;
  createEnvelope: (payload: T) => ModelEnvelopeV1<T>;
  activatePayload: (payload: unknown) => Promise<void>;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function wireLocalModelLibraryUi<T>(options: LocalModelLibraryUiOptions<T>): {
  refresh: () => Promise<void>;
  setSaveDisabled: (disabled: boolean) => void;
} {
  const { family, payloadFormat, elements } = options;

  const updateSelectionButtons = () => {
    const selected = Boolean(elements.select.value);
    elements.load.disabled = !selected;
    elements.rename.disabled = !selected;
    elements.remove.disabled = !selected;
    elements.exportSelected.disabled = !selected;
  };

  const refresh = async (): Promise<void> => {
    const [models, active] = await Promise.all([
      listLocalModels(family),
      readActiveLocalModelId(family),
    ]);
    const previous = elements.select.value;
    elements.select.textContent = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = models.length ? "Select a saved model..." : "No saved models";
    elements.select.appendChild(empty);
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.modelId;
      option.textContent = `${model.modelId === active ? "● " : ""}${model.displayName} · ${model.modelId}`;
      elements.select.appendChild(option);
    }
    if (previous && models.some((model) => model.modelId === previous)) elements.select.value = previous;
    else if (active && models.some((model) => model.modelId === active)) elements.select.value = active;
    elements.status.textContent = `Local library: ${models.length} ${family} model(s). active=${active ?? "unsaved current profile"}`;
    updateSelectionButtons();
  };

  const loadModel = async (modelId: string): Promise<void> => {
    const model = await getLocalModel(modelId);
    if (!model) throw new Error(`Local model not found: ${modelId}`);
    if (model.family !== family || model.payloadFormat !== payloadFormat) {
      throw new Error(`${model.modelId} is not a compatible ${family} model`);
    }
    await options.activatePayload(model.payload);
    await setActiveLocalModelId(family, model.modelId);
    elements.status.textContent = `Active model: ${model.displayName} (${model.modelId})`;
    await refresh();
  };

  elements.select.addEventListener("change", updateSelectionButtons);
  elements.save.addEventListener("click", async () => {
    const payload = options.getCurrentPayload();
    if (!payload) return;
    try {
      elements.status.textContent = "Saving snapshot to IndexedDB...";
      const saved = await saveLocalModel(options.createEnvelope(payload), true);
      elements.status.textContent = `Saved ${saved.displayName} as ${saved.modelId}`;
      await refresh();
      elements.select.value = saved.modelId;
      updateSelectionButtons();
    } catch (error) {
      elements.status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  elements.load.addEventListener("click", async () => {
    if (!elements.select.value) return;
    try { await loadModel(elements.select.value); }
    catch (error) { elements.status.textContent = error instanceof Error ? error.message : String(error); }
  });
  elements.rename.addEventListener("click", async () => {
    const modelId = elements.select.value;
    if (!modelId) return;
    const model = await getLocalModel(modelId);
    if (!model) return;
    const name = prompt("Model display name", model.displayName);
    if (name === null) return;
    try {
      await renameLocalModel(modelId, name);
      await refresh();
      elements.select.value = modelId;
      updateSelectionButtons();
    } catch (error) {
      elements.status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  elements.remove.addEventListener("click", async () => {
    const modelId = elements.select.value;
    if (!modelId || !confirm(`Delete local model ${modelId}?`)) return;
    try {
      await deleteLocalModel(modelId);
      elements.status.textContent = `Deleted ${modelId}`;
      await refresh();
    } catch (error) {
      elements.status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  elements.exportSelected.addEventListener("click", async () => {
    const modelId = elements.select.value;
    if (!modelId) return;
    const model = await getLocalModel(modelId);
    if (model) downloadJson(`${model.modelId}.json`, model);
  });
  elements.exportAll.addEventListener("click", async () => {
    try { downloadJson("tetraflux-model-library.json", await exportLocalModelLibrary()); }
    catch (error) { elements.status.textContent = error instanceof Error ? error.message : String(error); }
  });
  elements.importFile.addEventListener("change", async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    try {
      const bundle = await importLocalModelLibrary(JSON.parse(await file.text()));
      const active = bundle.active[family];
      if (active) await loadModel(active);
      else await refresh();
      elements.status.textContent = `Imported ${bundle.models.length} model(s).`;
    } catch (error) {
      elements.status.textContent = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      elements.importFile.value = "";
    }
  });

  void refresh();
  return {
    refresh,
    setSaveDisabled: (disabled: boolean) => { elements.save.disabled = disabled; },
  };
}
