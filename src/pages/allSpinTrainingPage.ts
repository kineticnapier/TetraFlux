import "../style.css";
import "./toolPage.css";
import { bootstrapLocalModels } from "../models/bootstrapLocalModels";
import { mountLocalModelLibraryPanel } from "../models/localModelLibraryPanel";

function localizeElement(element: HTMLElement | null): void {
  if (!element) return;
  const update = () => {
    const current = element.textContent ?? "";
    const next = current
      .replaceAll("Cloudflare", "Local library")
      .replaceAll("Cloud registry", "Local library")
      .replaceAll("cloud=", "model=");
    if (next !== current) element.textContent = next;
  };
  update();
  new MutationObserver(update).observe(element, { childList: true, characterData: true, subtree: true });
}

function mountAllSpinTrainingPage(): void {
  const main = document.querySelector<HTMLElement>("#toolPageMain");
  const trigger = document.querySelector<HTMLButtonElement>("#trainAllSpinBrowser");
  const panel = document.querySelector<HTMLDivElement>("#trainAllSpinPanel");
  if (!main || !panel) throw new Error("All-Spin training page failed to initialize");

  trigger?.click();
  trigger?.remove();
  panel.hidden = false;
  main.appendChild(panel);

  const heading = panel.querySelector<HTMLHeadingElement>(".bench-header h2");
  if (heading) heading.textContent = "All-Spin training configuration";
  mountLocalModelLibraryPanel({
    family: "allspin",
    panelSelector: "#trainAllSpinPanel",
    tokenSelector: "#allspinCloudToken",
    saveSelector: "#allspinCloudUpload",
    latestSelector: "#allspinCloudLatest",
    refreshSelector: "#allspinCloudRefresh",
    selectSelector: "#allspinCloudModels",
    loadSelector: "#allspinCloudLoadSelected",
    statusSelector: "#allspinCloudStatus",
  });
  localizeElement(panel.querySelector<HTMLElement>("#allspinBaseSummary"));
  localizeElement(panel.querySelector<HTMLElement>("#allspinCloudStatus"));
}

async function startAllSpinTrainingPage(): Promise<void> {
  await bootstrapLocalModels();
  await import("../browserAllSpinTraining");
  mountAllSpinTrainingPage();
}

void startAllSpinTrainingPage();
