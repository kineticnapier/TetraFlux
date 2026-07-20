import "../style.css";
import "./toolPage.css";
import { bootstrapCloudModels } from "../models/bootstrapCloudModels";

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
}

async function startAllSpinTrainingPage(): Promise<void> {
  await bootstrapCloudModels();
  await import("../browserAllSpinTraining");
  mountAllSpinTrainingPage();
}

void startAllSpinTrainingPage();
