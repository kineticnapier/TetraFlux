import "../style.css";
import "./toolPage.css";
import { bootstrapCloudModels } from "../models/bootstrapCloudModels";

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
}

async function startTrainingPage(): Promise<void> {
  await bootstrapCloudModels();
  await import("../browserTraining");
  mountTrainingPage();
}

void startTrainingPage();
