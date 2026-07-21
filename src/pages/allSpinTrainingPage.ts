import "../style.css";
import "./toolPage.css";
import { bootstrapLocalModels } from "../models/bootstrapLocalModels";
import { mountLocalModelLibraryPanel } from "../models/localModelLibraryPanel";

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
  const baseSummary = panel.querySelector<HTMLElement>("#allspinBaseSummary");
  if (baseSummary) {
    const localize = () => {
      const current = baseSummary.textContent ?? "";
      if (current.includes("cloud=")) baseSummary.textContent = current.replaceAll("cloud=", "model=");
    };
    localize();
    new MutationObserver(localize).observe(baseSummary, { childList: true, characterData: true, subtree: true });
  }
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
}

async function startAllSpinTrainingPage(): Promise<void> {
  await bootstrapLocalModels();
  await import("../browserAllSpinTraining");
  mountAllSpinTrainingPage();
}

void startAllSpinTrainingPage();
