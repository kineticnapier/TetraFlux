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
  benchmarkGarbageMode: "off" | "waiting" | "queued" | "countered" | "applied" | "countered_and_applied";
  benchmarkGarbageLinesPerBag: number;
  benchmarkGarbageStartBag: number;
  benchmarkGarbageMaxBags: number;
  benchmarkGarbageApplyAfterResponse: boolean;
  benchmarkGarbagePiecesLocked: number;
  benchmarkGarbageBagProgress: number;
  benchmarkGarbagePendingBefore: number;
  benchmarkGarbagePendingAfter: number;
  benchmarkGarbageAttackSent: number;
  benchmarkGarbageCancelled: number;
  benchmarkGarbageApplied: number;
  benchmarkGarbageQueued: number;
  benchmarkGarbageBagIndex?: number;
  benchmarkGarbageBagsQueued: number;
  benchmarkGarbageRemainingConfiguredBags: number | null;
}

export interface BenchmarkGarbageAggregateMetrics {
  benchmarkGarbageEnabled: boolean;
  benchmarkGarbageLinesPerBag: number;
  benchmarkGarbageStartBag: number;
  benchmarkGarbageMaxBags: number;
  benchmarkGarbageBagsQueued: number;
  benchmarkGarbageLinesQueued: number;
  benchmarkGarbageLinesCancelled: number;
  benchmarkGarbageLinesApplied: number;
  benchmarkGarbageMaxPending: number;
  benchmarkGarbagePressureTurns: number;
  benchmarkGarbageCounterTurns: number;
  benchmarkGarbageAppliedTurns: number;
  benchmarkGarbageLastBagQueued: number;
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

const ENABLED_DEFAULT_LINES_PER_BAG = 4;

let explicitConfig: Partial<BenchmarkGarbageEnvironmentConfig> | null = null;
const lastQueuedAtPiece = new WeakMap<TetrisEngine, number>();
const queuedBagsByEngine = new WeakMap<TetrisEngine, Set<number>>();

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

  const rawLinesPerBag = intAtLeast(explicitConfig?.linesPerBag ?? urlLines ?? envLines ?? storedLines ?? DEFAULT_CONFIG.linesPerBag, DEFAULT_CONFIG.linesPerBag, 0);
  const requestedEnabled = boolValue(explicitConfig?.enabled ?? urlEnabled ?? envEnabled ?? storedEnabled ?? (rawLinesPerBag > 0), rawLinesPerBag > 0);
  const linesPerBag = requestedEnabled && rawLinesPerBag <= 0 ? ENABLED_DEFAULT_LINES_PER_BAG : rawLinesPerBag;
  const enabled = requestedEnabled;
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
  try {
    globalThis.dispatchEvent?.(new CustomEvent("tetraflux:bench-garbage-config-change", { detail: next }));
  } catch {
    // no-op in non-browser tests
  }
  return next;
}

export function resetBenchmarkGarbageTracking(engine?: TetrisEngine): void {
  if (engine) {
    lastQueuedAtPiece.delete(engine);
    queuedBagsByEngine.delete(engine);
  }
}

function getQueuedBags(engine: TetrisEngine): Set<number> {
  let set = queuedBagsByEngine.get(engine);
  if (!set) {
    set = new Set<number>();
    queuedBagsByEngine.set(engine, set);
  }
  return set;
}

function remainingConfiguredBags(config: BenchmarkGarbageEnvironmentConfig, queuedBags: number): number | null {
  if (!config.enabled || config.maxBags <= 0) return null;
  return Math.max(0, config.maxBags - queuedBags);
}

function stepMode(step: Pick<BenchmarkGarbageStepMetrics, "benchmarkGarbageEnabled" | "benchmarkGarbageQueued" | "benchmarkGarbageCancelled" | "benchmarkGarbageApplied">): BenchmarkGarbageStepMetrics["benchmarkGarbageMode"] {
  if (!step.benchmarkGarbageEnabled) return "off";
  if (step.benchmarkGarbageCancelled > 0 && step.benchmarkGarbageApplied > 0) return "countered_and_applied";
  if (step.benchmarkGarbageCancelled > 0) return "countered";
  if (step.benchmarkGarbageApplied > 0) return "applied";
  if (step.benchmarkGarbageQueued > 0) return "queued";
  return "waiting";
}

export function applyBenchmarkGarbageEnvironmentAfterLock(engine: TetrisEngine, result: LockResult): BenchmarkGarbageStepMetrics {
  const config = readRuntimeConfig();
  const pendingBefore = Math.max(0, Math.floor(Number(engine.pendingGarbage ?? 0)));
  const attackSent = Math.max(0, Math.floor(Number(result.attackSent ?? 0)));
  const piecesLocked = Math.max(0, Math.floor(Number(engine.piecesLocked ?? 0)));
  const bagProgress = piecesLocked % 7;
  const queuedBags = getQueuedBags(engine);
  let cancelled = 0;
  let applied = 0;
  let queued = 0;
  let bagIndex: number | undefined;

  if (!config.enabled) {
    return {
      benchmarkGarbageEnabled: false,
      benchmarkGarbageMode: "off",
      benchmarkGarbageLinesPerBag: 0,
      benchmarkGarbageStartBag: config.startBag,
      benchmarkGarbageMaxBags: config.maxBags,
      benchmarkGarbageApplyAfterResponse: config.applyAfterResponse,
      benchmarkGarbagePiecesLocked: piecesLocked,
      benchmarkGarbageBagProgress: bagProgress,
      benchmarkGarbagePendingBefore: pendingBefore,
      benchmarkGarbagePendingAfter: pendingBefore,
      benchmarkGarbageAttackSent: attackSent,
      benchmarkGarbageCancelled: 0,
      benchmarkGarbageApplied: 0,
      benchmarkGarbageQueued: 0,
      benchmarkGarbageBagsQueued: queuedBags.size,
      benchmarkGarbageRemainingConfiguredBags: remainingConfiguredBags(config, queuedBags.size),
    };
  }

  if (pendingBefore > 0) {
    cancelled = Math.min(pendingBefore, attackSent);
    if (cancelled > 0) engine.pendingGarbage = Math.max(0, engine.pendingGarbage - cancelled);

    if (config.applyAfterResponse && engine.pendingGarbage > 0) {
      applied = Math.max(0, Math.floor(engine.pendingGarbage));
      engine.applyPendingGarbage();
    }
  }

  if (piecesLocked > 0 && piecesLocked % 7 === 0 && lastQueuedAtPiece.get(engine) !== piecesLocked) {
    const currentBag = piecesLocked / 7;
    const withinStart = currentBag >= config.startBag;
    const withinMax = config.maxBags <= 0 || currentBag < config.startBag + config.maxBags;
    if (withinStart && withinMax) {
      engine.queueGarbage(config.linesPerBag);
      queued = config.linesPerBag;
      bagIndex = currentBag;
      queuedBags.add(currentBag);
    }
    lastQueuedAtPiece.set(engine, piecesLocked);
  }

  const pendingAfter = Math.max(0, Math.floor(Number(engine.pendingGarbage ?? 0)));
  const partial = {
    benchmarkGarbageEnabled: true,
    benchmarkGarbageQueued: queued,
    benchmarkGarbageCancelled: cancelled,
    benchmarkGarbageApplied: applied,
  };
  return {
    benchmarkGarbageEnabled: true,
    benchmarkGarbageMode: stepMode(partial),
    benchmarkGarbageLinesPerBag: config.linesPerBag,
    benchmarkGarbageStartBag: config.startBag,
    benchmarkGarbageMaxBags: config.maxBags,
    benchmarkGarbageApplyAfterResponse: config.applyAfterResponse,
    benchmarkGarbagePiecesLocked: piecesLocked,
    benchmarkGarbageBagProgress: bagProgress,
    benchmarkGarbagePendingBefore: pendingBefore,
    benchmarkGarbagePendingAfter: pendingAfter,
    benchmarkGarbageAttackSent: attackSent,
    benchmarkGarbageCancelled: cancelled,
    benchmarkGarbageApplied: applied,
    benchmarkGarbageQueued: queued,
    benchmarkGarbageBagIndex: bagIndex,
    benchmarkGarbageBagsQueued: queuedBags.size,
    benchmarkGarbageRemainingConfiguredBags: remainingConfiguredBags(config, queuedBags.size),
  };
}

export function flattenBenchmarkGarbageMetrics(step: BenchmarkGarbageStepMetrics): Record<string, number | boolean | string> {
  return {
    benchmarkGarbageEnabled: step.benchmarkGarbageEnabled,
    benchmarkGarbageMode: step.benchmarkGarbageMode,
    benchmarkGarbageLinesPerBag: step.benchmarkGarbageLinesPerBag,
    benchmarkGarbageStartBag: step.benchmarkGarbageStartBag,
    benchmarkGarbageMaxBags: step.benchmarkGarbageMaxBags,
    benchmarkGarbageApplyAfterResponse: step.benchmarkGarbageApplyAfterResponse,
    benchmarkGarbagePiecesLocked: step.benchmarkGarbagePiecesLocked,
    benchmarkGarbageBagProgress: step.benchmarkGarbageBagProgress,
    benchmarkGarbagePendingBefore: step.benchmarkGarbagePendingBefore,
    benchmarkGarbagePendingAfter: step.benchmarkGarbagePendingAfter,
    benchmarkGarbageAttackSent: step.benchmarkGarbageAttackSent,
    benchmarkGarbageCancelled: step.benchmarkGarbageCancelled,
    benchmarkGarbageApplied: step.benchmarkGarbageApplied,
    benchmarkGarbageQueued: step.benchmarkGarbageQueued,
    benchmarkGarbageBagIndex: step.benchmarkGarbageBagIndex ?? 0,
    benchmarkGarbageBagsQueued: step.benchmarkGarbageBagsQueued,
    benchmarkGarbageRemainingConfiguredBags: step.benchmarkGarbageRemainingConfiguredBags ?? -1,
  };
}

export function createBenchmarkGarbageAggregate(config = readRuntimeConfig()): BenchmarkGarbageAggregateMetrics {
  return {
    benchmarkGarbageEnabled: config.enabled,
    benchmarkGarbageLinesPerBag: config.linesPerBag,
    benchmarkGarbageStartBag: config.startBag,
    benchmarkGarbageMaxBags: config.maxBags,
    benchmarkGarbageBagsQueued: 0,
    benchmarkGarbageLinesQueued: 0,
    benchmarkGarbageLinesCancelled: 0,
    benchmarkGarbageLinesApplied: 0,
    benchmarkGarbageMaxPending: 0,
    benchmarkGarbagePressureTurns: 0,
    benchmarkGarbageCounterTurns: 0,
    benchmarkGarbageAppliedTurns: 0,
    benchmarkGarbageLastBagQueued: 0,
  };
}

export function updateBenchmarkGarbageAggregate(aggregate: BenchmarkGarbageAggregateMetrics, step?: BenchmarkGarbageStepMetrics): BenchmarkGarbageAggregateMetrics {
  if (!step) return aggregate;
  aggregate.benchmarkGarbageEnabled = aggregate.benchmarkGarbageEnabled || step.benchmarkGarbageEnabled;
  aggregate.benchmarkGarbageLinesPerBag = step.benchmarkGarbageLinesPerBag;
  aggregate.benchmarkGarbageStartBag = step.benchmarkGarbageStartBag;
  aggregate.benchmarkGarbageMaxBags = step.benchmarkGarbageMaxBags;
  aggregate.benchmarkGarbageBagsQueued = Math.max(aggregate.benchmarkGarbageBagsQueued, step.benchmarkGarbageBagsQueued);
  aggregate.benchmarkGarbageLinesQueued += step.benchmarkGarbageQueued;
  aggregate.benchmarkGarbageLinesCancelled += step.benchmarkGarbageCancelled;
  aggregate.benchmarkGarbageLinesApplied += step.benchmarkGarbageApplied;
  aggregate.benchmarkGarbageMaxPending = Math.max(aggregate.benchmarkGarbageMaxPending, step.benchmarkGarbagePendingBefore, step.benchmarkGarbagePendingAfter);
  if (step.benchmarkGarbagePendingBefore > 0 || step.benchmarkGarbagePendingAfter > 0) aggregate.benchmarkGarbagePressureTurns++;
  if (step.benchmarkGarbageCancelled > 0) aggregate.benchmarkGarbageCounterTurns++;
  if (step.benchmarkGarbageApplied > 0) aggregate.benchmarkGarbageAppliedTurns++;
  if (step.benchmarkGarbageBagIndex) aggregate.benchmarkGarbageLastBagQueued = Math.max(aggregate.benchmarkGarbageLastBagQueued, step.benchmarkGarbageBagIndex);
  return aggregate;
}


export function benchmarkGarbageConfigSummary(config = readRuntimeConfig()): string {
  if (!config.enabled) return "Bench garbage: OFF";
  const max = config.maxBags > 0 ? `, ${config.maxBags} bags` : ", unlimited";
  return `Bench garbage: ${config.linesPerBag}L/bag from bag ${config.startBag}${max}${config.applyAfterResponse ? ", apply remaining" : ", queue only"}`;
}

// Small browser-console API for quick test runs without adding any floating UI.
// The benchmark screen owns the visible controls; this object is diagnostics only.
try {
  (globalThis as unknown as { TetraFluxBenchmarkGarbage?: unknown }).TetraFluxBenchmarkGarbage = {
    get: getBenchmarkGarbageEnvironmentConfig,
    set: configureBenchmarkGarbageEnvironment,
    reset: resetBenchmarkGarbageTracking,
    summary: benchmarkGarbageConfigSummary,
    createAggregate: createBenchmarkGarbageAggregate,
    updateAggregate: updateBenchmarkGarbageAggregate,
  };
} catch {
  // no-op outside browsers
}
