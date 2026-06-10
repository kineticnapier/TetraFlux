import { type LockResult, type TetrisEngine } from "../engine/tetris";

export interface BenchmarkGarbageEnvironmentConfig {
  enabled: boolean;
  linesPerBag: number;
  startBag: number;
  maxBags: number;
  applyAfterResponse: boolean;
}

export interface BenchmarkGarbageStepMetrics {
  benchmarkGarbageEnabled: boolean;
  benchmarkGarbageLinesPerBag: number;
  benchmarkGarbagePendingBefore: number;
  benchmarkGarbageCancelled: number;
  benchmarkGarbageApplied: number;
  benchmarkGarbageQueued: number;
  benchmarkGarbageBagIndex?: number;
}

const STORAGE_KEYS = {
  enabled: "tetraflux.benchGarbage.enabled",
  linesPerBag: "tetraflux.benchGarbage.linesPerBag",
  startBag: "tetraflux.benchGarbage.startBag",
  maxBags: "tetraflux.benchGarbage.maxBags",
  applyAfterResponse: "tetraflux.benchGarbage.applyAfterResponse",
} as const;

const DEFAULT_CONFIG: BenchmarkGarbageEnvironmentConfig = {
  enabled: false,
  linesPerBag: 0,
  startBag: 1,
  maxBags: 0,
  applyAfterResponse: true,
};

let explicitConfig: Partial<BenchmarkGarbageEnvironmentConfig> | null = null;
const lastQueuedAtPiece = new WeakMap<TetrisEngine, number>();
let uiInstalled = false;

function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function intAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, Math.floor(finiteNumber(value, fallback)));
}

function boolValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  const s = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(s)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(s)) return false;
  return fallback;
}

function getUrlParams(): URLSearchParams | null {
  try {
    const href = (globalThis as unknown as { location?: { href?: string } }).location?.href;
    if (!href) return null;
    return new URL(href).searchParams;
  } catch {
    return null;
  }
}

function getStorage(): Storage | null {
  try {
    const storage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

function env(name: string): string | undefined {
  try {
    return (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  } catch {
    return undefined;
  }
}

function readRuntimeConfig(): BenchmarkGarbageEnvironmentConfig {
  const storage = getStorage();
  const params = getUrlParams();

  const envLines = env("TETRAFLUX_BENCH_GARBAGE_PER_BAG");
  const envEnabled = env("TETRAFLUX_BENCH_GARBAGE_ENABLED");
  const envStartBag = env("TETRAFLUX_BENCH_GARBAGE_START_BAG");
  const envMaxBags = env("TETRAFLUX_BENCH_GARBAGE_MAX_BAGS");
  const envApply = env("TETRAFLUX_BENCH_GARBAGE_APPLY_AFTER_RESPONSE");

  const urlLines = params?.get("benchGarbagePerBag") ?? params?.get("garbagePerBag") ?? null;
  const urlEnabled = params?.get("benchGarbage") ?? params?.get("garbageBench") ?? null;
  const urlStartBag = params?.get("benchGarbageStartBag") ?? null;
  const urlMaxBags = params?.get("benchGarbageMaxBags") ?? null;
  const urlApply = params?.get("benchGarbageApplyAfterResponse") ?? null;

  const storedLines = storage?.getItem(STORAGE_KEYS.linesPerBag) ?? null;
  const storedEnabled = storage?.getItem(STORAGE_KEYS.enabled) ?? null;
  const storedStartBag = storage?.getItem(STORAGE_KEYS.startBag) ?? null;
  const storedMaxBags = storage?.getItem(STORAGE_KEYS.maxBags) ?? null;
  const storedApply = storage?.getItem(STORAGE_KEYS.applyAfterResponse) ?? null;

  const linesPerBag = intAtLeast(explicitConfig?.linesPerBag ?? urlLines ?? envLines ?? storedLines ?? DEFAULT_CONFIG.linesPerBag, DEFAULT_CONFIG.linesPerBag, 0);
  const enabled = boolValue(explicitConfig?.enabled ?? urlEnabled ?? envEnabled ?? storedEnabled ?? (linesPerBag > 0), linesPerBag > 0);
  const startBag = intAtLeast(explicitConfig?.startBag ?? urlStartBag ?? envStartBag ?? storedStartBag ?? DEFAULT_CONFIG.startBag, DEFAULT_CONFIG.startBag, 1);
  const maxBags = intAtLeast(explicitConfig?.maxBags ?? urlMaxBags ?? envMaxBags ?? storedMaxBags ?? DEFAULT_CONFIG.maxBags, DEFAULT_CONFIG.maxBags, 0);
  const applyAfterResponse = boolValue(explicitConfig?.applyAfterResponse ?? urlApply ?? envApply ?? storedApply ?? DEFAULT_CONFIG.applyAfterResponse, DEFAULT_CONFIG.applyAfterResponse);

  return { enabled: enabled && linesPerBag > 0, linesPerBag, startBag, maxBags, applyAfterResponse };
}

export function getBenchmarkGarbageEnvironmentConfig(): BenchmarkGarbageEnvironmentConfig {
  return readRuntimeConfig();
}

export function configureBenchmarkGarbageEnvironment(config: Partial<BenchmarkGarbageEnvironmentConfig>): BenchmarkGarbageEnvironmentConfig {
  explicitConfig = { ...(explicitConfig ?? {}), ...config };
  const next = readRuntimeConfig();
  const storage = getStorage();
  if (storage) {
    storage.setItem(STORAGE_KEYS.enabled, String(next.enabled));
    storage.setItem(STORAGE_KEYS.linesPerBag, String(next.linesPerBag));
    storage.setItem(STORAGE_KEYS.startBag, String(next.startBag));
    storage.setItem(STORAGE_KEYS.maxBags, String(next.maxBags));
    storage.setItem(STORAGE_KEYS.applyAfterResponse, String(next.applyAfterResponse));
  }
  return next;
}

export function resetBenchmarkGarbageTracking(engine?: TetrisEngine): void {
  if (engine) lastQueuedAtPiece.delete(engine);
}

export function applyBenchmarkGarbageEnvironmentAfterLock(engine: TetrisEngine, result: LockResult): BenchmarkGarbageStepMetrics {
  const config = readRuntimeConfig();
  const pendingBefore = Math.max(0, Math.floor(Number(engine.pendingGarbage ?? 0)));
  let cancelled = 0;
  let applied = 0;
  let queued = 0;
  let bagIndex: number | undefined;

  if (!config.enabled) {
    return {
      benchmarkGarbageEnabled: false,
      benchmarkGarbageLinesPerBag: 0,
      benchmarkGarbagePendingBefore: pendingBefore,
      benchmarkGarbageCancelled: 0,
      benchmarkGarbageApplied: 0,
      benchmarkGarbageQueued: 0,
    };
  }

  if (pendingBefore > 0) {
    const attack = Math.max(0, Math.floor(Number(result.attackSent ?? 0)));
    cancelled = Math.min(pendingBefore, attack);
    if (cancelled > 0) engine.pendingGarbage = Math.max(0, engine.pendingGarbage - cancelled);

    if (config.applyAfterResponse && engine.pendingGarbage > 0) {
      applied = Math.max(0, Math.floor(engine.pendingGarbage));
      engine.applyPendingGarbage();
    }
  }

  const piecesLocked = Math.max(0, Math.floor(Number(engine.piecesLocked ?? 0)));
  if (piecesLocked > 0 && piecesLocked % 7 === 0 && lastQueuedAtPiece.get(engine) !== piecesLocked) {
    const currentBag = piecesLocked / 7;
    const withinStart = currentBag >= config.startBag;
    const withinMax = config.maxBags <= 0 || currentBag < config.startBag + config.maxBags;
    if (withinStart && withinMax) {
      engine.queueGarbage(config.linesPerBag);
      queued = config.linesPerBag;
      bagIndex = currentBag;
    }
    lastQueuedAtPiece.set(engine, piecesLocked);
  }

  return {
    benchmarkGarbageEnabled: true,
    benchmarkGarbageLinesPerBag: config.linesPerBag,
    benchmarkGarbagePendingBefore: pendingBefore,
    benchmarkGarbageCancelled: cancelled,
    benchmarkGarbageApplied: applied,
    benchmarkGarbageQueued: queued,
    benchmarkGarbageBagIndex: bagIndex,
  };
}

function installBenchmarkGarbageUi(): void {
  if (uiInstalled) return;
  if (typeof document === "undefined") return;
  uiInstalled = true;

  const render = () => {
    if (document.getElementById("tetraflux-bench-garbage-panel")) return;
    const config = readRuntimeConfig();
    const panel = document.createElement("div");
    panel.id = "tetraflux-bench-garbage-panel";
    panel.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:2147483647",
      "background:rgba(12,16,24,.92)",
      "color:#e7edf7",
      "border:1px solid rgba(255,255,255,.18)",
      "border-radius:10px",
      "padding:8px 10px",
      "font:12px system-ui,sans-serif",
      "box-shadow:0 6px 24px rgba(0,0,0,.35)",
      "display:flex",
      "gap:6px",
      "align-items:center",
      "backdrop-filter:blur(8px)",
    ].join(";");

    const label = document.createElement("span");
    label.textContent = "Bench garbage";
    label.style.fontWeight = "600";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = config.enabled;
    enabled.title = "Enable incoming garbage in browser benchmarks";

    const lines = document.createElement("input");
    lines.type = "number";
    lines.min = "0";
    lines.max = "20";
    lines.step = "1";
    lines.value = String(config.linesPerBag);
    lines.title = "Garbage lines queued every bag";
    lines.style.cssText = "width:44px;background:#0b1220;color:#e7edf7;border:1px solid rgba(255,255,255,.22);border-radius:6px;padding:3px 4px";

    const suffix = document.createElement("span");
    suffix.textContent = "lines/bag";
    suffix.style.opacity = "0.82";

    const start = document.createElement("input");
    start.type = "number";
    start.min = "1";
    start.max = "99";
    start.step = "1";
    start.value = String(config.startBag);
    start.title = "Start bag";
    start.style.cssText = "width:38px;background:#0b1220;color:#e7edf7;border:1px solid rgba(255,255,255,.22);border-radius:6px;padding:3px 4px";

    const apply = () => {
      configureBenchmarkGarbageEnvironment({
        enabled: enabled.checked,
        linesPerBag: intAtLeast(lines.value, 0, 0),
        startBag: intAtLeast(start.value, 1, 1),
      });
    };
    enabled.addEventListener("change", apply);
    lines.addEventListener("change", apply);
    start.addEventListener("change", apply);

    panel.append(label, enabled, lines, suffix, document.createTextNode("from bag"), start);
    document.body.appendChild(panel);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
  else render();
}

installBenchmarkGarbageUi();

// Small browser-console API for quick test runs without rebuilding UI.
try {
  (globalThis as unknown as { TetraFluxBenchmarkGarbage?: unknown }).TetraFluxBenchmarkGarbage = {
    get: getBenchmarkGarbageEnvironmentConfig,
    set: configureBenchmarkGarbageEnvironment,
    reset: resetBenchmarkGarbageTracking,
  };
} catch {
  // no-op
}
