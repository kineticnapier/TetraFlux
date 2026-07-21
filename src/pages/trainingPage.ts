import "../style.css";
import "./toolPage.css";
import { bootstrapLocalModels } from "../models/bootstrapLocalModels";
import { mountLocalModelLibraryPanel } from "../models/localModelLibraryPanel";

function localizeStatus(element: HTMLElement | null): void {
  if (!element) return;
  const update = () => {
    const current = element.textContent ?? "";
    const next = current.replaceAll("Cloudflare", "Local library").replaceAll("Cloud registry", "Local library");
    if (next !== current) element.textContent = next;
  };
  update();
  new MutationObserver(update).observe(element, { childList: true, characterData: true, subtree: true });
}

function mountTrainingPage(): void {
  const main = document.querySelector<HTMLElement>("#toolPageMain");
  const trigger = document.querySelector<HTMLButtonElement>("#trainHeuristicBrowser");
  const panel = document.querySelector<HTMLDivElement>("#trainHeuristicPanel");
  if (!main || !panel) throw new Error("Training page failed to initialize");

  trigger?.click();
  trigger?.remove();
  panel.hidden = false;
  main.appendChild(panel);

  const heading = panel.querySelector<HTMLHeadingElement>(".bench-header h2");
  if (heading) heading.textContent = "Flat training configuration";
  const intro = panel.querySelector<HTMLElement>(".bench-card > p.hint");
  if (intro) intro.innerHTML = "Candidate games run entirely on this computer in a browser CPU Web Worker pool. Profiles, checkpoints and model history stay in <b>local browser storage</b>.";
  mountLocalModelLibraryPanel({
    family: "flat",
    panelSelector: "#trainHeuristicPanel",
    tokenSelector: "#flatCloudToken",
    saveSelector: "#flatCloudUpload",
    latestSelector: "#flatCloudLatest",
    refreshSelector: "#flatCloudRefresh",
    selectSelector: "#flatCloudModels",
    loadSelector: "#flatCloudLoadSelected",
    statusSelector: "#flatCloudStatus",
  });
  localizeStatus(panel.querySelector<HTMLElement>("#flatCloudStatus"));
}

async function startTrainingPage(): Promise<void> {
  await bootstrapLocalModels();
  await import("../browserTraining");
  mountTrainingPage();
}

void startTrainingPage();
