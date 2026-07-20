import "../style.css";
import "./toolPage.css";
import "../training/browserHeuristicProfile";
import "../training/browserAllSpinProfile";

await import("../browserBenchmark");

function mountBenchmarkPage(): void {
  const main = document.querySelector<HTMLElement>("#toolPageMain");
  const trigger = document.querySelector<HTMLButtonElement>("#benchAiBrowser");
  const panel = document.querySelector<HTMLDivElement>("#benchPanel");
  if (!main || !panel) throw new Error("Benchmark page failed to initialize");

  trigger?.click();
  trigger?.remove();
  panel.hidden = false;
  main.appendChild(panel);

  const heading = panel.querySelector<HTMLHeadingElement>(".bench-header h2");
  if (heading) heading.textContent = "Benchmark configuration";
}

mountBenchmarkPage();
