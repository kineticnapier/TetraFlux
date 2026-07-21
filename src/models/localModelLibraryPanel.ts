import { deleteLocalModel, getLocalModel, renameLocalModel } from "./localModelLibrary";
import { exportLocalModelLibrary, importLocalModelLibrary } from "./localModelLibraryTransfer";
import type { ModelFamily } from "./modelEnvelope";

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function makeButton(text: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  return element;
}

export function mountLocalModelLibraryPanel(input: {
  family: ModelFamily;
  panelSelector: string;
  tokenSelector: string;
  saveSelector: string;
  latestSelector: string;
  refreshSelector: string;
  selectSelector: string;
  loadSelector: string;
  statusSelector: string;
}): void {
  const panel = document.querySelector<HTMLElement>(input.panelSelector);
  if (!panel || panel.dataset.localLibraryMounted === "true") return;
  panel.dataset.localLibraryMounted = "true";

  panel.querySelector<HTMLInputElement>(input.tokenSelector)?.closest("label")?.remove();
  const save = panel.querySelector<HTMLButtonElement>(input.saveSelector);
  const latest = panel.querySelector<HTMLButtonElement>(input.latestSelector);
  const refresh = panel.querySelector<HTMLButtonElement>(input.refreshSelector);
  const select = panel.querySelector<HTMLSelectElement>(input.selectSelector);
  const load = panel.querySelector<HTMLButtonElement>(input.loadSelector);
  const status = panel.querySelector<HTMLElement>(input.statusSelector);
  const controls = select?.closest<HTMLElement>(".bench-controls");
  if (!save || !latest || !refresh || !select || !load || !status || !controls) return;

  const summary = save.closest("details")?.querySelector("summary");
  if (summary) summary.textContent = "Local Model Library";
  save.textContent = "Save Snapshot";
  latest.textContent = "Load Active / Latest";
  refresh.textContent = "Refresh Library";
  load.textContent = "Set Active";
  status.textContent = "Local library ready.";

  const rename = makeButton("Rename");
  const remove = makeButton("Delete");
  const exportSelected = makeButton("Export Selected");
  const exportAll = makeButton("Export All");
  const importLabel = document.createElement("label");
  importLabel.className = "small-button";
  importLabel.textContent = "Import Library";
  const importFile = document.createElement("input");
  importFile.type = "file";
  importFile.accept = "application/json,.json";
  importFile.hidden = true;
  importLabel.appendChild(importFile);
  controls.append(rename, remove, exportSelected, exportAll, importLabel);

  const updateButtons = () => {
    const disabled = !select.value;
    rename.disabled = disabled;
    remove.disabled = disabled;
    exportSelected.disabled = disabled;
  };
  select.addEventListener("change", updateButtons);
  updateButtons();

  rename.addEventListener("click", async () => {
    const model = select.value ? await getLocalModel(select.value) : null;
    if (!model) return;
    const name = prompt("Model display name", model.displayName);
    if (name === null) return;
    try {
      await renameLocalModel(model.modelId, name);
      refresh.click();
      status.textContent = `Renamed ${model.modelId}`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  remove.addEventListener("click", async () => {
    const modelId = select.value;
    if (!modelId || !confirm(`Delete local model ${modelId}?`)) return;
    await deleteLocalModel(modelId);
    refresh.click();
    status.textContent = `Deleted ${modelId}`;
  });

  exportSelected.addEventListener("click", async () => {
    const model = select.value ? await getLocalModel(select.value) : null;
    if (model) downloadJson(`${model.modelId}.json`, model);
  });

  exportAll.addEventListener("click", async () => {
    downloadJson("tetraflux-model-library.json", await exportLocalModelLibrary());
  });

  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const bundle = await importLocalModelLibrary(JSON.parse(await file.text()));
      refresh.click();
      if (bundle.active[input.family]) latest.click();
      status.textContent = `Imported ${bundle.models.length} model(s).`;
    } catch (error) {
      status.textContent = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      importFile.value = "";
    }
  });
}
