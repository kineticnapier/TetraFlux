import {
  deleteLocalModel,
  getLocalModel,
  renameLocalModel,
} from "./localModelLibrary";
import {
  exportLocalModelLibrary,
  importLocalModelLibrary,
} from "./localModelLibraryTransfer";
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

function button(text: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  return element;
}

function localizeStatus(element: HTMLElement): void {
  const replace = () => {
    element.textContent = (element.textContent ?? "")
      .replaceAll("Cloudflare", "Local library")
      .replaceAll("Cloud registry", "Local library")
      .replaceAll("cloud=", "model=");
  };
  replace();
  new MutationObserver(replace).observe(element, { childList: true, characterData: true, subtree: true });
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

  const token = panel.querySelector<HTMLInputElement>(input.tokenSelector);
  token?.closest("label")?.remove();
  const save = panel.querySelector<HTMLButtonElement>(input.saveSelector);
  const latest = panel.querySelector<HTMLButtonElement>(input.latestSelector);
  const refresh = panel.querySelector<HTMLButtonElement>(input.refreshSelector);
  const select = panel.querySelector<HTMLSelectElement>(input.selectSelector);
  const load = panel.querySelector<HTMLButtonElement>(input.loadSelector);
  const status = panel.querySelector<HTMLElement>(input.statusSelector);
  const controls = select?.closest<HTMLElement>(".bench-controls");
  if (!save || !latest || !refresh || !select || !load || !status || !controls) return;

  const details = save.closest("details");
  const summary = details?.querySelector("summary");
  if (summary) summary.textContent = "Local Model Library";
  save.textContent = "Save Snapshot";
  latest.textContent = "Load Active / Latest";
  refresh.textContent = "Refresh Library";
  load.textContent = "Set Active";
  localizeStatus(status);

  const rename = button("Rename");
  const remove = button("Delete");
  const exportSelected = button("Export Selected");
  const exportAll = button("Export All");
  const importLabel = document.createElement("label");
  importLabel.className = "small-button";
  importLabel.textContent = "Import Library";
  const importFile = document.createElement("input");
  importFile.type = "file";
  importFile.accept = "application/json,.json";
  importFile.hidden = true;
  importLabel.appendChild(importFile);
  controls.append(rename, remove, exportSelected, exportAll, importLabel);

  const update = () => {
    const selected = Boolean(select.value);
    rename.disabled = !selected;
    remove.disabled = !selected;
    exportSelected.disabled = !selected;
  };
  select.addEventListener("change", update);
  update();

  rename.addEventListener("click", async () => {
    const modelId = select.value;
    if (!modelId) return;
    const model = await getLocalModel(modelId);
    if (!model) return;
    const name = prompt("Model display name", model.displayName);
    if (name === null) return;
    try {
      await renameLocalModel(modelId, name);
      refresh.click();
      status.textContent = `Renamed ${modelId}`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  remove.addEventListener("click", async () => {
    const modelId = select.value;
    if (!modelId || !confirm(`Delete local model ${modelId}?`)) return;
    try {
      await deleteLocalModel(modelId);
      refresh.click();
      status.textContent = `Deleted ${modelId}`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  exportSelected.addEventListener("click", async () => {
    const modelId = select.value;
    if (!modelId) return;
    const model = await getLocalModel(modelId);
    if (model) downloadJson(`${model.modelId}.json`, model);
  });

  exportAll.addEventListener("click", async () => {
    try {
      downloadJson("tetraflux-model-library.json", await exportLocalModelLibrary());
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
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
