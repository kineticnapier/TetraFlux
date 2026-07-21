import "../style.css";
import "./toolPage.css";
import { bootstrapLocalModels } from "../models/bootstrapLocalModels";
import { mountLocalModelLibraryPanel } from "../models/localModelLibraryPanel";

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
}

async function startTrainingPage(): Promise<void> {
  await bootstrapLocalModels();
  await import("../browserTraining");
  mountTrainingPage();
}

void startTrainingPage();
