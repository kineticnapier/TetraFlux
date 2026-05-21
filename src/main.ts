import "./style.css";
import { HeuristicAI } from "./ai/heuristic";
import type { AiChoice } from "./ai/heuristic";
import { WebPolicyAI } from "./ai/webPolicy";
import { boardMetrics, TetrisEngine, type LockResult, type PlacementAction, type PieceState } from "./engine/tetris";
import { MovementInput, type LogicalMoveKey } from "./input";
import { MatchLogger, SelfplayLogger, type BattleSide, uploadLogs, uploadSelfplayLogs } from "./logging";
import { PresenceClient } from "./presence";
import { drawBoard, drawPanel } from "./render";

type Winner = "human" | "ai";
type GameMode = "human_vs_ai" | "ai_vs_ai" | "lab" | "zenith";
type AutoUploadStatus = "idle" | "uploading" | "uploaded" | "failed" | "skipped" | "selfplay" | "disabled";

interface AiLike { choose(engine: TetrisEngine): AiChoice | null; }

type AiMoveOp = "hold" | "left" | "right" | "cw" | "ccw" | "180";

interface AiMoveExecution {
  result: LockResult;
  ops: AiMoveOp[];
  reachedTarget: boolean;
}

interface PendingAiAction {
  stateBefore: ReturnType<TetrisEngine["stateDict"]>;
  opponentBefore: ReturnType<TetrisEngine["stateDict"]>;
  plannedAction: PlacementAction;
  ops: AiMoveOp[];
  opIndex: number;
  routeFailed: boolean;
  side?: BattleSide;
}

interface TimedIncomingGarbage {
  amount: number;
  receivedAtMs: number;
  readyAtMs: number;
}

type EngineSlot = "human" | "ai";

type TouchAction = "left" | "right" | "down" | "cw" | "ccw" | "180" | "hold" | "drop" | "start" | "next";

type BattleOpponentKind =
  | "heuristic"
  | "aggressive"
  | "defensive"
  | "downstacker"
  | "combo"
  | "spin"
  | "noisyHybrid";

interface BattleOpponentSpec {
  kind: BattleOpponentKind;
  name: string;
  make(base: AiLike): AiLike;
}

class WeightedHeuristicAI extends HeuristicAI {
  variantName: string;

  constructor(name: string, weights: Partial<HeuristicAI> = {}) {
    super();
    this.variantName = name;
    Object.assign(this, weights);
  }
}

class NoisyAi implements AiLike {
  private rngState: number;

  constructor(private readonly base: AiLike, private readonly noise = 0.35, seed = seedNow()) {
    this.rngState = seed || 1;
  }

  private rand(): number {
    let t = (this.rngState += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  choose(engine: TetrisEngine): AiChoice | null {
    const choice = this.base.choose(engine);
    if (!choice) return null;

    if (this.rand() < this.noise * 0.22) {
      const h = new WeightedHeuristicAI("Noisy fallback", {
        holeWeight: 7.4 + this.rand() * 1.6,
        heightWeight: 0.6 + this.rand() * 0.5,
        bumpWeight: 0.25 + this.rand() * 0.45,
        attackBonus: 1.4 + this.rand() * 1.8,
        lineBonus: 3.2 + this.rand() * 1.8,
      });
      const fallback = h.choose(engine);
      if (fallback) {
        fallback.aiInfo = { ...fallback.aiInfo, opponent: "NoisyHybrid fallback" };
        return fallback;
      }
    }

    return {
      ...choice,
      aiScore: choice.aiScore + (this.rand() - 0.5) * this.noise,
      aiInfo: { ...choice.aiInfo, opponent: "NoisyHybrid", noise: this.noise },
    };
  }
}

const BATTLE_OPPONENTS: BattleOpponentSpec[] = [
  { kind: "heuristic", name: "Heuristic", make: () => new HeuristicAI() },
  { kind: "aggressive", name: "Aggressive", make: () => new WeightedHeuristicAI("Aggressive", { attackBonus: 5.2, lineBonus: 4.8, holeWeight: 6.4, heightWeight: 0.62, bumpWeight: 0.28, wellWeight: 0.08, holdPenalty: 0.02 }) },
  { kind: "defensive", name: "Defensive", make: () => new WeightedHeuristicAI("Defensive", { holeWeight: 13.0, heightWeight: 1.35, bumpWeight: 0.72, wellWeight: 0.28, lineBonus: 2.8, attackBonus: 0.9, holdPenalty: 0.03 }) },
  { kind: "downstacker", name: "Downstacker", make: () => new WeightedHeuristicAI("Downstacker", { holeWeight: 11.2, heightWeight: 1.05, bumpWeight: 0.45, wellWeight: 0.04, lineBonus: 5.0, attackBonus: 1.15, holdPenalty: 0.01 }) },
  { kind: "combo", name: "Combo", make: () => new WeightedHeuristicAI("Combo", { holeWeight: 7.2, heightWeight: 0.72, bumpWeight: 0.18, wellWeight: -0.12, lineBonus: 5.8, attackBonus: 1.65, holdPenalty: 0.02 }) },
  { kind: "spin", name: "Spin", make: () => new WeightedHeuristicAI("Spin", { holeWeight: 7.6, heightWeight: 0.7, bumpWeight: 0.25, wellWeight: 0.0, lineBonus: 3.7, attackBonus: 4.7, holdPenalty: 0.01 }) },
  { kind: "noisyHybrid", name: "Noisy Hybrid", make: (base) => new NoisyAi(base, 0.55) },
];

function randomBattleOpponent(base: AiLike): { ai: AiLike; name: string; kind: BattleOpponentKind } {
  const spec = BATTLE_OPPONENTS[Math.floor(Math.random() * BATTLE_OPPONENTS.length)] ?? BATTLE_OPPONENTS[0];
  return { ai: spec.make(base), name: spec.name, kind: spec.kind };
}

interface ValueModelInfo {
  loaded: boolean;
  lines: string[];
}

function valueModelLines(data: unknown): string[] {
  if (!data || typeof data !== "object") return ["value: none"];
  const obj = data as Record<string, unknown>;

  const name = String(obj.model_name ?? obj.model_id ?? obj.checkpoint_name ?? "value model");
  const exportedAt = String(obj.exported_at ?? obj.trained_at ?? obj.created_at ?? "unknown");
  const summary = obj.training_summary && typeof obj.training_summary === "object"
    ? obj.training_summary as Record<string, unknown>
    : null;

  const lines: string[] = [
    `model: ${name.length > 38 ? `${name.slice(0, 37)}…` : name}`,
    `trained: ${exportedAt}`
  ];

  const trainN = summary?.train_n;
  const datasetN = summary?.dataset_n ?? summary?.n ?? summary?.total_n;
  const bestLoss = summary?.best_val_loss ?? summary?.best_val_mae ?? summary?.val_loss;

  if (typeof trainN === "number") lines.push(`value ops: ${trainN.toLocaleString()}`);
  else if (typeof datasetN === "number") lines.push(`value data: ${datasetN.toLocaleString()}`);

  if (typeof bestLoss === "number") lines.push(`val: ${bestLoss.toFixed(4)}`);

  return lines;
}

interface KeyBindings {
  left: string[]; right: string[]; softDrop: string[]; rotateCw: string[]; rotateCcw: string[];
  rotate180: string[]; hold: string[]; hardDrop: string[]; nextRound: string[]; reset: string[];
}

interface GameSettings {
  aiOpsPerSecond: number; dasMs: number; arrMs: number; sdfCellsPerSecond: number;
  gravityCellsPerSecond: number; lockDelayMs: number; labGarbagePerBag: number; keys: KeyBindings;
}

type QuickPlayModId =
  | "none"
  | "no_hold"
  | "messier_garbage"
  | "gravity"
  | "volatile_garbage"
  | "double_hole_garbage"
  | "invisible"
  | "all_spin"
  | "expert_mode";

interface QuickPlayMod {
  id: QuickPlayModId;
  name: string;
  description: string;

  // Attack / garbage.
  attackMultiplier?: number;
  incomingMultiplier?: number;
  garbageScatterChance?: number;
  doubleHoleChance?: number;
  garbageBurstMax?: number;
  instantEntry?: boolean;

  // Player/Tower.
  gravityMultiplier?: number;
  climbMultiplier?: number;
  climbLossMultiplier?: number;
  comboMultiplier?: number;
  koMultiplier?: number;
  botSkillBias?: number;
  targetedMultiplier?: number;

  // Rule switches.
  disableHold?: boolean;
  invisible?: boolean;
  allSpin?: boolean;
  cancelDoesNotClimb?: boolean;
}

// Exact requested mod set from QUICK PLAY / Zenith Tower.
// Effects are mapped to TetraFlux's simplified Zenith/AI Battle self-training systems.
const QUICK_PLAY_MODS: QuickPlayMod[] = [
  {
    id: "none",
    name: "No Mod",
    description: "Normal Zenith/AI Battle self-training rules.",
  },
  {
    id: "no_hold",
    name: "No Hold",
    description: "ホールド禁止。",
    disableHold: true,
  },
  {
    id: "messier_garbage",
    name: "Messier Garbage",
    description: "ゴミがバラバラになりやすくなる。",
    garbageScatterChance: 0.42,
    incomingMultiplier: 1.08,
    garbageBurstMax: 7,
  },
  {
    id: "gravity",
    name: "Gravity",
    description: "重力が強くなる。",
    gravityMultiplier: 2.15,
  },
  {
    id: "volatile_garbage",
    name: "Volatile Garbage",
    description: "ゴミの量2倍、攻撃力2倍。",
    attackMultiplier: 2.0,
    incomingMultiplier: 2.0,
    garbageBurstMax: 12,
  },
  {
    id: "double_hole_garbage",
    name: "Double Hole Garbage",
    description: "ゴミの穴が2つになることがある。",
    doubleHoleChance: 0.38,
    incomingMultiplier: 1.05,
  },
  {
    id: "invisible",
    name: "Invisible",
    description: "5秒ごとに置いたミノが点滅し、それ以外のときは不可視。ゴミと穴は常に見える。",
    invisible: true,
  },
  {
    id: "all_spin",
    name: "All-Spin",
    description: "Non-T Spins are upgraded to full Spins. Every 7 line-clearing actions without a penalty adds breakable garbage.",
    allSpin: true,
    attackMultiplier: 1.0,
  },
  {
    id: "expert_mode",
    name: "Expert Mode",
    description: "Targeting, entry garbage, and climb loss are harsher. Canceling garbage does not help climb.",
    incomingMultiplier: 1.45,
    targetedMultiplier: 1.35,
    instantEntry: true,
    climbLossMultiplier: 1.45,
    cancelDoesNotClimb: true,
    botSkillBias: 0.08,
    garbageBurstMax: 8,
  },
];

function quickPlayModById(id: string): QuickPlayMod {
  return QUICK_PLAY_MODS.find((m) => m.id === id) ?? QUICK_PLAY_MODS[0];
}

let currentQuickPlayMod: QuickPlayMod = QUICK_PLAY_MODS[0];

function currentGarbageOptions(): { scatterChance?: number; doubleHoleChance?: number } {
  return {
    scatterChance: currentQuickPlayMod.garbageScatterChance,
    doubleHoleChance: currentQuickPlayMod.doubleHoleChance,
  };
}

function isQuickPlayModActive(): boolean {
  return currentQuickPlayMod.id !== "none";
}

const DEFAULT_SETTINGS: GameSettings = {
  aiOpsPerSecond: 10, dasMs: 130, arrMs: 10, sdfCellsPerSecond: 30,
  gravityCellsPerSecond: 1, lockDelayMs: 500, labGarbagePerBag: 4,
  keys: {
    left: ["ArrowLeft"], right: ["ArrowRight"], softDrop: ["ArrowDown"], hardDrop: [" "],
    rotateCcw: ["Control", "z"], rotateCw: ["ArrowUp", "x"], rotate180: ["a"],
    hold: ["Shift", "c"], nextRound: ["Enter"], reset: ["r"],
  },
};

const SETTINGS_KEY = "tetraflux_settings_v2_multikey";

// AI vs AI can become almost immortal after fake-spin attack was removed.
// Limit one round by total AI placements, then decide by board danger.
// 1200 total placements is roughly 600 pieces per side.
const AI_BATTLE_MAX_TURNS_PER_ROUND = 1200;

// Upper bound for AI operation simulation speed.
// One operation is left/right/rotate/hold/harddrop. Placements with longer
// movement paths consume more operations and therefore take longer.
const MAX_AI_OPS_PER_SECOND = 3000;
const LAB_GARBAGE_DELAY_MS = 2500;

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;

const newMatchBtn = document.querySelector<HTMLButtonElement>("#newMatch")!;
const nextRoundBtn = document.querySelector<HTMLButtonElement>("#nextRound")!;
const toggleModeBtn = document.querySelector<HTMLButtonElement>("#toggleMode")!;
const downloadBtn = document.querySelector<HTMLButtonElement>("#downloadLogs")!;
const uploadBtn = document.querySelector<HTMLButtonElement>("#uploadLogs")!;
const copyBtn = document.querySelector<HTMLButtonElement>("#copyLogs")!;
const clearBtn = document.querySelector<HTMLButtonElement>("#clearLogs")!;
const settingsBtn = document.querySelector<HTMLButtonElement>("#settingsBtn")!;
const presenceBadge = document.querySelector<HTMLSpanElement>("#presenceBadge")!;
const toolbar = document.querySelector<HTMLDivElement>("#toolbar")!;

const quickPlayModSelect = document.createElement("select");
quickPlayModSelect.id = "quickPlayMod";
quickPlayModSelect.title = "Quick Play / Zenith mod";
for (const mod of QUICK_PLAY_MODS) {
  const option = document.createElement("option");
  option.value = mod.id;
  option.textContent = `Mod: ${mod.name}`;
  quickPlayModSelect.appendChild(option);
}
document.body.appendChild(quickPlayModSelect);
quickPlayModSelect.style.position = "fixed";
quickPlayModSelect.style.zIndex = "20";
quickPlayModSelect.style.minWidth = "178px";
quickPlayModSelect.style.maxWidth = "230px";
quickPlayModSelect.style.padding = "6px 8px";
quickPlayModSelect.style.borderRadius = "10px";
quickPlayModSelect.style.border = "1px solid #334155";
quickPlayModSelect.style.background = "#0f172a";
quickPlayModSelect.style.color = "#e5e7eb";
quickPlayModSelect.style.font = "13px Consolas";
quickPlayModSelect.addEventListener("change", () => {
  currentQuickPlayMod = quickPlayModById(quickPlayModSelect.value);
  trainer?.applyCurrentModToEngines?.();
  setStatus(`Mod selected: ${currentQuickPlayMod.name} - ${currentQuickPlayMod.description}`);
});

function isAiBattleScreen(mode: GameMode): boolean {
  return mode === "ai_vs_ai";
}

function usesQuickPlayMod(mode: GameMode): boolean {
  return mode === "ai_vs_ai" || mode === "lab";
}

function canvasLayoutScale(): number {
  const rect = canvas.getBoundingClientRect();
  return rect.width < 1100 ? Math.max(0.42, rect.width / 1280) : 1;
}

function updateQuickPlayModSelectUi(mode: GameMode): void {
  const active = usesQuickPlayMod(mode);
  quickPlayModSelect.hidden = !active;
  quickPlayModSelect.disabled = !active;
  quickPlayModSelect.style.display = active ? "" : "none";
  quickPlayModSelect.style.border = "1px solid #334155";
  quickPlayModSelect.style.background = "#0f172a";
  quickPlayModSelect.style.color = "#e5e7eb";
  if (!active) return;
  const rect = canvas.getBoundingClientRect();
  const scale = canvasLayoutScale();
  const selectW = Math.max(178, quickPlayModSelect.offsetWidth || 178);
  quickPlayModSelect.style.left = `${Math.round(rect.left + 482 * scale - selectW / 2)}px`;
  quickPlayModSelect.style.top = `${Math.round(rect.top + 132 * scale)}px`;
}

const settingsModal = document.querySelector<HTMLDivElement>("#settingsModal")!;
const closeSettingsBtn = document.querySelector<HTMLButtonElement>("#closeSettings")!;
const saveSettingsBtn = document.querySelector<HTMLButtonElement>("#saveSettings")!;
const resetSettingsBtn = document.querySelector<HTMLButtonElement>("#resetSettings")!;

const aiOpsInput = document.querySelector<HTMLInputElement>("#aiPps")!;
const dasInput = document.querySelector<HTMLInputElement>("#dasMs")!;
const arrInput = document.querySelector<HTMLInputElement>("#arrMs")!;
const sdfInput = document.querySelector<HTMLInputElement>("#sdf")!;
const gravityInput = document.querySelector<HTMLInputElement>("#gravity")!;
const lockDelayInput = document.querySelector<HTMLInputElement>("#lockDelayMs")!;

const aiOpsLabel =
  document.querySelector<HTMLLabelElement>('label[for="aiPps"]') ??
  aiOpsInput.closest("label");
if (aiOpsLabel) aiOpsLabel.childNodes[0].textContent = "AI ops/s ";
aiOpsInput.title = "AI操作量/秒。left/right/rotate/hold/harddropを1操作として数えます。";

const labGarbageInput = document.createElement("input");
labGarbageInput.type = "number";
labGarbageInput.min = "0";
labGarbageInput.max = "30";
labGarbageInput.step = "1";
labGarbageInput.id = "labGarbagePerBag";
labGarbageInput.style.width = "70px";

const labGarbageLabel = document.createElement("label");
labGarbageLabel.textContent = "Lab garbage/bag ";
labGarbageLabel.appendChild(labGarbageInput);
lockDelayInput.closest("label")?.after(labGarbageLabel);

const keyInputs = {
  left: document.querySelector<HTMLInputElement>("#keyLeft")!,
  right: document.querySelector<HTMLInputElement>("#keyRight")!,
  softDrop: document.querySelector<HTMLInputElement>("#keySoftDrop")!,
  rotateCw: document.querySelector<HTMLInputElement>("#keyRotateCw")!,
  rotateCcw: document.querySelector<HTMLInputElement>("#keyRotateCcw")!,
  rotate180: document.querySelector<HTMLInputElement>("#keyRotate180")!,
  hold: document.querySelector<HTMLInputElement>("#keyHold")!,
  hardDrop: document.querySelector<HTMLInputElement>("#keyHardDrop")!,
  nextRound: document.querySelector<HTMLInputElement>("#keyNextRound")!,
  reset: document.querySelector<HTMLInputElement>("#keyReset")!,
} satisfies Record<keyof KeyBindings, HTMLInputElement>;

function setStatus(text: string): void { statusEl.textContent = text; }
function cloneSettings(s: GameSettings): GameSettings { return JSON.parse(JSON.stringify(s)) as GameSettings; }

let settings: GameSettings = loadSettings();

function asKeyArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const out = value.filter((x): x is string => typeof x === "string" && x.length > 0);
    return out.length ? out : [...fallback];
  }
  if (typeof value === "string" && value.length > 0) return [value];
  return [...fallback];
}

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return cloneSettings(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const legacy = parsed as Partial<GameSettings> & { aiPps?: number };
    const dk = DEFAULT_SETTINGS.keys;
    const pk = (parsed.keys ?? {}) as Partial<Record<keyof KeyBindings, unknown>>;
    const migratedAiOps =
      typeof parsed.aiOpsPerSecond === "number"
        ? parsed.aiOpsPerSecond
        : typeof legacy.aiPps === "number"
          ? Math.max(1, legacy.aiPps * 7)
          : DEFAULT_SETTINGS.aiOpsPerSecond;

    return {
      ...cloneSettings(DEFAULT_SETTINGS),
      ...parsed,
      aiOpsPerSecond: migratedAiOps,
      keys: {
        left: asKeyArray(pk.left, dk.left), right: asKeyArray(pk.right, dk.right),
        softDrop: asKeyArray(pk.softDrop, dk.softDrop), rotateCw: asKeyArray(pk.rotateCw, dk.rotateCw),
        rotateCcw: asKeyArray(pk.rotateCcw, dk.rotateCcw), rotate180: asKeyArray(pk.rotate180, dk.rotate180),
        hold: asKeyArray(pk.hold, dk.hold), hardDrop: asKeyArray(pk.hardDrop, dk.hardDrop),
        nextRound: asKeyArray(pk.nextRound, dk.nextRound), reset: asKeyArray(pk.reset, dk.reset),
      },
    };
  } catch { return cloneSettings(DEFAULT_SETTINGS); }
}

function saveSettingsToStorage(): void { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

function keyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key === "ArrowLeft") return "Left";
  if (key === "ArrowRight") return "Right";
  if (key === "ArrowDown") return "Down";
  if (key === "ArrowUp") return "Up";
  if (key === "Control") return "Ctrl";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function keyValue(label: string): string {
  const s = label.trim();
  const lower = s.toLowerCase();
  if (lower === "space") return " ";
  if (lower === "left") return "ArrowLeft";
  if (lower === "right") return "ArrowRight";
  if (lower === "down") return "ArrowDown";
  if (lower === "up") return "ArrowUp";
  if (lower === "ctrl" || lower === "control") return "Control";
  if (lower === "shift") return "Shift";
  if (lower === "enter") return "Enter";
  if (s.length === 1) return s.toLowerCase();
  return s;
}

function keysLabel(keys: string[]): string { return keys.map(keyLabel).join(", "); }

function parseKeyList(text: string, fallback: string[]): string[] {
  const parts = text.split(",").map((x) => keyValue(x)).filter((x) => x.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) if (!seen.has(p)) { seen.add(p); out.push(p); }
  return out.length ? out : [...fallback];
}

function numInput(input: HTMLInputElement, fallback: number): number {
  const n = Number(input.value);
  return Number.isFinite(n) ? n : fallback;
}

function applySettingsToDom(): void {
  aiOpsInput.value = String(settings.aiOpsPerSecond);
  dasInput.value = String(settings.dasMs);
  arrInput.value = String(settings.arrMs);
  sdfInput.value = String(settings.sdfCellsPerSecond);
  gravityInput.value = String(settings.gravityCellsPerSecond);
  lockDelayInput.value = String(settings.lockDelayMs);
  labGarbageInput.value = String(settings.labGarbagePerBag);
  for (const [k, input] of Object.entries(keyInputs) as Array<[keyof KeyBindings, HTMLInputElement]>) input.value = keysLabel(settings.keys[k]);
}

function readSettingsFromDom(): void {
  settings.aiOpsPerSecond = Math.max(1, Math.min(MAX_AI_OPS_PER_SECOND, numInput(aiOpsInput, DEFAULT_SETTINGS.aiOpsPerSecond)));
  settings.dasMs = Math.max(0, Math.min(500, numInput(dasInput, DEFAULT_SETTINGS.dasMs)));
  settings.arrMs = Math.max(0, Math.min(200, numInput(arrInput, DEFAULT_SETTINGS.arrMs)));
  settings.sdfCellsPerSecond = Math.max(1, Math.min(240, numInput(sdfInput, DEFAULT_SETTINGS.sdfCellsPerSecond)));
  settings.gravityCellsPerSecond = Math.max(0, Math.min(60, numInput(gravityInput, DEFAULT_SETTINGS.gravityCellsPerSecond)));
  settings.lockDelayMs = Math.max(0, Math.min(3000, numInput(lockDelayInput, DEFAULT_SETTINGS.lockDelayMs)));
  settings.labGarbagePerBag = Math.max(0, Math.min(30, Math.floor(numInput(labGarbageInput, DEFAULT_SETTINGS.labGarbagePerBag))));
  for (const [k, input] of Object.entries(keyInputs) as Array<[keyof KeyBindings, HTMLInputElement]>) settings.keys[k] = parseKeyList(input.value, DEFAULT_SETTINGS.keys[k]);
  saveSettingsToStorage();
}

function openSettings(): void {
  applySettingsToDom();
  settingsModal.hidden = false;
  settingsModal.classList.remove("hidden");
  settingsModal.setAttribute("aria-hidden", "false");
}

function closeSettings(): void {
  settingsModal.hidden = true;
  settingsModal.classList.add("hidden");
  settingsModal.setAttribute("aria-hidden", "true");
}

function bindSettingsUi(): void {
  for (const input of Object.values(keyInputs)) input.addEventListener("keydown", (e) => { e.preventDefault(); input.value = keyLabel(e.key); });
  settingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettings(); });
  saveSettingsBtn.addEventListener("click", () => { readSettingsFromDom(); closeSettings(); setStatus("Settings saved."); });
  resetSettingsBtn.addEventListener("click", () => { settings = cloneSettings(DEFAULT_SETTINGS); saveSettingsToStorage(); applySettingsToDom(); setStatus("Settings reset."); });
}

function seedNow(): number { return (Date.now() ^ Math.floor(Math.random() * 1_000_000_000)) >>> 0; }
function short(text: unknown, max = 86): string { const s = String(text ?? ""); return s.length <= max ? s : `${s.slice(0, max - 1)}…`; }
function isBound(e: KeyboardEvent, keys: string[]): boolean { return keys.includes(e.key); }
function gameKeys(): Set<string> { return new Set(Object.values(settings.keys).flat()); }

interface AttackApplyResult {
  rawAttack: number;
  canceled: number;
  sent: number;
}

function applyAttack(sender: TetrisEngine, receiver: TetrisEngine, amount: number): AttackApplyResult {
  const rawAttack = Math.max(0, Math.floor(amount));
  let atk = rawAttack;

  const canceled = Math.min(sender.pendingGarbage, atk);
  sender.pendingGarbage -= canceled;
  atk -= canceled;

  const sent = atk;

  return { rawAttack, canceled, sent };
}


function applyRemainingGarbageAfterCounter(engine: TetrisEngine, result: { rawAttack: number; linesCleared: number }): number {
  if (result.rawAttack <= 0 && result.linesCleared <= 0) {
    const amount = engine.pendingGarbage;
    engine.applyPendingGarbage();
    return amount;
  }
  return 0;
}

type ZenithFeedKind = "join" | "out" | "ko" | "danger" | "floor";

interface ZenithBot {
  id: string;
  name: string;
  alive: boolean;
  skill: number;
  pps: number;
  attackRate: number;
  downstack: number;
  aggression: number;
  heightM: number;
  boardHeight: number;
  holes: number;
  pendingGarbage: number;
  attackTotal: number;
  attackRecent: number;
  receivedTotal: number;
  joinedAtMs: number;
  lastUpdateMs: number;
}

interface ZenithFeedItem {
  kind: ZenithFeedKind;
  text: string;
  atMs: number;
}

const ZENITH_TARGET_POPULATION = 100;
const ZENITH_PREWARM_MAX_MS = 180_000;
const ZENITH_JOIN_INTERVAL_MS = 1_700;
const ZENITH_NEAR_RANGE_M = 85;
const ZENITH_REMOVE_BEHIND_M = 260;

// Initial population is pre-simulated from 0.0m. A few climbers should already
// be near 1000m to match the "tower already in progress" feeling.
const ZENITH_INITIAL_HIGH_CLIMBERS = 15;
const ZENITH_HIGH_CLIMBER_MIN_M = 860;
const ZENITH_HIGH_CLIMBER_MAX_M = 1180;

// Zenith pressure is measured in garbage lines per second.
// Bot attackRecent is a rolling threat score, not direct garbage.
// Garbage is batched, not streamed every frame.
const ZENITH_NEAR_PRESSURE_SCALE = 0.075;
const ZENITH_TOP_PRESSURE_SCALE = 0.012;
const ZENITH_PENDING_FEEDBACK_SCALE = 0.0007;
const ZENITH_GRACE_MS = 10_000;
const ZENITH_RAMP_MS = 75_000;
const ZENITH_BASE_MAX_INCOMING = 0.18;
const ZENITH_MAX_INCOMING = 1.35;
const ZENITH_GARBAGE_BURST_INTERVAL_MS = 3_200;
const ZENITH_GARBAGE_BURST_MAX_LINES = 6;

// Climb energy tuning.
// Rough target:
//   1 attack  -> about 1.2m
//   big spike -> about 8m
//   KO        -> about 25m
//   combo     -> stretches climb further
const ZENITH_ATTACK_M_PER_LINE = 1.2;
const ZENITH_BIG_ATTACK_SOFT_CAP_M = 8.0;
const ZENITH_BIG_ATTACK_EXTRA_M = 0.22;
const ZENITH_KO_BONUS_M = 25.0;
const ZENITH_LINE_CLEAR_M = 0.22;
const ZENITH_SPIN_BONUS_M = 0.45;
const ZENITH_PIECE_SURVIVAL_M = 0.035;
const ZENITH_COMBO_M = 0.32;
const ZENITH_COMBO_QUAD_M = 0.018;
const ZENITH_COMBO_MAX_M = 5.5;

interface ZenithFloor {
  name: string;
  borderM: number;
  color: string;
}

// I found a public description saying Quick Play / Zenith Tower has 10 phases
// and mentions Hall of Beginnings, The Hotel, and The Casino. Exact current
// borders are not exposed in a reliable official table, so keep this list
// editable and approximate for the mock.
const ZENITH_FLOORS: ZenithFloor[] = [
  { name: "Hall of Beginnings", borderM: 0, color: "#38bdf8" },
  { name: "The Hotel", borderM: 250, color: "#a78bfa" },
  { name: "The Casino", borderM: 500, color: "#f59e0b" },
  { name: "The Lounge", borderM: 750, color: "#34d399" },
  { name: "The Skyline", borderM: 1000, color: "#60a5fa" },
  { name: "The Stratosphere", borderM: 1300, color: "#f472b6" },
  { name: "The Orbit", borderM: 1650, color: "#fb7185" },
  { name: "The Singularity", borderM: 2050, color: "#c084fc" },
  { name: "The Zenith", borderM: 2500, color: "#fde68a" },
  { name: "Beyond", borderM: 3000, color: "#e5e7eb" },
];

function zenithFloorAt(heightM: number): { index: number; floor: ZenithFloor; next: ZenithFloor | null } {
  let index = 0;
  for (let i = 0; i < ZENITH_FLOORS.length; i++) {
    if (heightM >= ZENITH_FLOORS[i].borderM) index = i;
    else break;
  }
  return { index, floor: ZENITH_FLOORS[index], next: ZENITH_FLOORS[index + 1] ?? null };
}

function zenithAttackClimbMeters(attack: number): number {
  const atk = Math.max(0, attack);
  const raw = atk * ZENITH_ATTACK_M_PER_LINE;

  if (raw <= ZENITH_BIG_ATTACK_SOFT_CAP_M) return raw;

  // Big attacks should be strong, but not linearly absurd.
  return ZENITH_BIG_ATTACK_SOFT_CAP_M + (raw - ZENITH_BIG_ATTACK_SOFT_CAP_M) * ZENITH_BIG_ATTACK_EXTRA_M;
}

function zenithComboClimbMeters(combo: number): number {
  const c = Math.max(0, combo);
  return Math.min(ZENITH_COMBO_MAX_M, c * ZENITH_COMBO_M + c * c * ZENITH_COMBO_QUAD_M);
}

class ZenithTowerSim {
  bots: ZenithBot[] = [];
  feed: ZenithFeedItem[] = [];
  rngState = 1;
  targetPopulation = ZENITH_TARGET_POPULATION;
  playerHeightM = 0;
  playerAttackTotal = 0;
  playerAttackRecent = 0;
  playerCanceledTotal = 0;
  playerReceivedTotal = 0;
  playerIncomingRate = 0;
  playerRank = 1;
  playerFloorIndex = 0;
  incomingBurstCarry = 0;
  nextGarbageBurstAtMs = 0;
  nextJoinAtMs = 0;
  startedAtMs = 0;
  lastUpdateMs = 0;
  runOver = false;
  runResult = "";
  mod: QuickPlayMod = currentQuickPlayMod;

  constructor(seed: number) {
    this.rngState = seed || 1;
  }

  setMod(mod: QuickPlayMod): void {
    this.mod = mod;
  }

  reset(now: number, mod: QuickPlayMod = currentQuickPlayMod): void {
    this.setMod(mod);
    this.bots = [];
    this.feed = [];
    this.playerHeightM = 0;
    this.playerAttackTotal = 0;
    this.playerAttackRecent = 0;
    this.playerCanceledTotal = 0;
    this.playerReceivedTotal = 0;
    this.playerIncomingRate = 0;
    this.playerRank = 1;
    this.playerFloorIndex = 0;
    this.incomingBurstCarry = 0;
    this.nextGarbageBurstAtMs = now + ZENITH_GARBAGE_BURST_INTERVAL_MS;
    this.nextJoinAtMs = now + 900;
    this.startedAtMs = now;
    this.lastUpdateMs = now;
    this.runOver = false;
    this.runResult = "";
    this.targetPopulation = ZENITH_TARGET_POPULATION + Math.floor(this.randRange(-10, 16));

    for (let i = 0; i < this.targetPopulation; i++) {
      const joinedAt = now - this.randRange(0, ZENITH_PREWARM_MAX_MS);
      const bot = this.createBot(joinedAt);
      this.simulateBot(bot, now - joinedAt, now, true);
      this.bots.push(bot);
    }

    for (let i = 0; i < Math.min(ZENITH_INITIAL_HIGH_CLIMBERS, this.bots.length); i++) {
      const bot = this.bots[i];
      bot.heightM = this.randRange(ZENITH_HIGH_CLIMBER_MIN_M, ZENITH_HIGH_CLIMBER_MAX_M);
      bot.boardHeight = this.randRange(4, 14);
      bot.holes = Math.floor(this.randRange(1, 12));
      bot.attackTotal += this.randRange(220, 520);
      bot.attackRecent += this.randRange(2, 8);
    }

    this.sortBots();
    this.pushFeed("join", `tower already active: ${this.bots.length} climbers`, now);
    this.pushFeed("floor", `${ZENITH_INITIAL_HIGH_CLIMBERS} climbers are already around 1000m`, now);
  }

  private rand(): number {
    let t = (this.rngState += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private randRange(min: number, max: number): number {
    return min + (max - min) * this.rand();
  }

  private pickName(id: string): string {
    const prefixes = ["neo", "zen", "flux", "miso", "kumo", "luna", "r", "stack", "byte", "mino", "apm", "sora"];
    const p = prefixes[Math.floor(this.rand() * prefixes.length)];
    return `${p}_${id.slice(-3)}`;
  }

  private createBot(joinedAtMs: number): ZenithBot {
    const n = Math.floor(this.rand() * 999_999).toString(36).padStart(4, "0");
    const skill = Math.max(0, Math.min(1.2, Math.pow(this.rand(), 0.75) + (this.mod.botSkillBias ?? 0)));
    const pps = 0.7 + skill * 4.8 + this.randRange(-0.25, 0.4);
    const aggression = 0.45 + skill * 0.9 + this.randRange(-0.15, 0.2);
    const downstack = 0.35 + skill * 1.15 + this.randRange(-0.1, 0.2);

    return {
      id: `bot_${n}_${Math.floor(joinedAtMs)}`,
      name: this.pickName(n),
      alive: true,
      skill,
      pps: Math.max(0.4, pps),
      attackRate: Math.max(0.05, pps * aggression * (0.12 + skill * 0.16)),
      downstack: Math.max(0.1, downstack),
      aggression,
      heightM: 0,
      boardHeight: this.randRange(2, 9),
      holes: Math.floor(this.randRange(0, 5)),
      pendingGarbage: 0,
      attackTotal: 0,
      attackRecent: 0,
      receivedTotal: 0,
      joinedAtMs,
      lastUpdateMs: joinedAtMs,
    };
  }

  private pushFeed(kind: ZenithFeedKind, text: string, atMs: number): void {
    this.feed.unshift({ kind, text, atMs });
    this.feed = this.feed.slice(0, 8);
  }

  private activeBotsSortedByHeight(): ZenithBot[] {
    return this.bots.filter((b) => b.alive).sort((a, b) => b.heightM - a.heightM);
  }

  private pickBotKiller(victim: ZenithBot): ZenithBot | null {
    const candidates = this.bots
      .filter((b) => b.alive && b.id !== victim.id)
      .map((b) => ({
        bot: b,
        score:
          b.attackRecent * 2.5 +
          b.attackRate * 0.8 -
          Math.abs(b.heightM - victim.heightM) * 0.01 +
          this.randRange(-0.7, 0.7),
      }))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.bot ?? null;
  }

  private simulateBot(bot: ZenithBot, dtMs: number, now: number, prewarm = false): void {
    if (!bot.alive || dtMs <= 0) return;
    const dt = Math.min(30, dtMs / 1000);
    bot.attackRecent *= Math.exp(-dt / 6.0);
    const towerRamp = 1 + Math.min(2.2, bot.heightM / 420);
    const attack = bot.attackRate * towerRamp * dt * this.randRange(0.45, 1.55);
    bot.attackRecent += attack;
    bot.attackTotal += attack;
    const climbRate = (0.22 + bot.pps * 0.055 + bot.skill * 0.18) * (0.9 + bot.aggression * 0.18);
    bot.heightM += Math.max(0, climbRate * dt * this.randRange(0.65, 1.35));
    const pressure = bot.pendingGarbage * 0.03 + towerRamp * 0.018 * dt;
    bot.boardHeight += pressure - bot.downstack * 0.045 * dt + this.randRange(-0.015, 0.035) * dt;
    bot.holes += Math.max(0, (0.035 - bot.skill * 0.018) * dt + bot.pendingGarbage * 0.002 * dt);
    bot.holes = Math.max(0, Math.min(45, bot.holes - bot.downstack * 0.018 * dt));
    bot.boardHeight = Math.max(1, Math.min(24, bot.boardHeight));

    if (bot.pendingGarbage > 0) {
      const cancel = Math.min(bot.pendingGarbage, attack * (0.35 + bot.skill * 0.6));
      bot.pendingGarbage = Math.max(0, bot.pendingGarbage - cancel);
    }

    const deathPressure =
      Math.max(0, bot.boardHeight - 20) * 0.03 +
      Math.max(0, bot.holes - 26) * 0.01 +
      Math.max(0, bot.pendingGarbage - 18) * 0.012;

    if (!prewarm && this.rand() < deathPressure * dt) {
      bot.alive = false;
      const killer = this.pickBotKiller(bot);
      if (killer) this.pushFeed("ko", `${killer.name} KO'd ${bot.name} at ${bot.heightM.toFixed(1)}m`, now);
      else this.pushFeed("out", `${bot.name} topped out at ${bot.heightM.toFixed(1)}m`, now);
    }
    bot.lastUpdateMs = now;
  }

  private spawnBot(now: number, force = false): void {
    if (!force && this.bots.filter((b) => b.alive).length >= this.targetPopulation) return;
    const bot = this.createBot(now);
    this.bots.push(bot);
    this.pushFeed("join", `${bot.name} joined at 0.0m`, now);
  }

  private sortBots(): void {
    this.bots.sort((a, b) => b.heightM - a.heightM);
  }

  update(dtMs: number, now: number, playerPendingGarbage: number): number {
    if (this.runOver) return 0;
    const dt = Math.min(0.25, dtMs / 1000);
    this.playerAttackRecent *= Math.exp(-dt / 6.0);

    if (now >= this.nextJoinAtMs) {
      const active = this.bots.filter((b) => b.alive).length;
      if (active < this.targetPopulation + 8 || this.rand() < 0.22) this.spawnBot(now);
      this.nextJoinAtMs = now + ZENITH_JOIN_INTERVAL_MS * this.randRange(0.65, 1.75);
    }

    for (const bot of this.bots) this.simulateBot(bot, dtMs, now);
    this.bots = this.bots.filter((b) => b.alive || (now - b.lastUpdateMs < 15_000 && b.heightM > this.playerHeightM - ZENITH_REMOVE_BEHIND_M));

    const active = this.bots.filter((b) => b.alive);
    while (active.length + 2 < this.targetPopulation && this.bots.length < this.targetPopulation + 16) {
      this.spawnBot(now, true);
      active.push(this.bots[this.bots.length - 1]);
    }

    const nearby = active.filter((b) => Math.abs(b.heightM - this.playerHeightM) <= ZENITH_NEAR_RANGE_M);
    const nearbyAttack = nearby.reduce((s, b) => s + b.attackRecent, 0);
    const nearbyAverage = nearby.length > 0 ? nearbyAttack / nearby.length : 0;

    const topBots = active.slice(0, 10);
    const topAttack = topBots.reduce((s, b) => s + b.attackRecent, 0);
    const topAverage = topBots.length > 0 ? topAttack / topBots.length : 0;

    const heightRamp = 1 + Math.min(1.7, this.playerHeightM / 420);
    const ageMs = Math.max(0, now - this.startedAtMs);
    const graceRamp =
      ageMs <= ZENITH_GRACE_MS
        ? 0
        : Math.min(1, (ageMs - ZENITH_GRACE_MS) / ZENITH_RAMP_MS);

    const rawIncoming =
      (
        nearbyAverage * ZENITH_NEAR_PRESSURE_SCALE +
        topAverage * ZENITH_TOP_PRESSURE_SCALE +
        playerPendingGarbage * ZENITH_PENDING_FEEDBACK_SCALE
      ) * heightRamp * graceRamp;

    const cap =
      (ZENITH_BASE_MAX_INCOMING + Math.min(ZENITH_MAX_INCOMING - ZENITH_BASE_MAX_INCOMING, this.playerHeightM / 420)) *
      (0.2 + 0.8 * graceRamp);

    this.playerIncomingRate = Math.max(
      0,
      Math.min(cap, rawIncoming * (this.mod.incomingMultiplier ?? 1) * (this.mod.targetedMultiplier ?? 1))
    );

    const floorInfo = zenithFloorAt(this.playerHeightM);
    if (floorInfo.index !== this.playerFloorIndex) {
      this.playerFloorIndex = floorInfo.index;
      this.pushFeed("floor", `entered ${floorInfo.floor.name} at ${this.playerHeightM.toFixed(1)}m`, now);
    }

    this.sortBots();
    this.playerRank = 1 + active.filter((b) => b.heightM > this.playerHeightM).length;
    return this.playerIncomingRate * dt;
  }

  consumeGarbageBurst(dtMs: number, now: number): number {
    if (this.runOver) return 0;

    this.incomingBurstCarry += this.playerIncomingRate * Math.max(0, dtMs / 1000);

    if (this.mod.instantEntry) {
      const instant = Math.floor(this.incomingBurstCarry);
      if (instant <= 0) return 0;
      this.incomingBurstCarry -= instant;
      this.playerReceivedTotal += instant;
      this.pushFeed("danger", `${instant} instant garbage`, now);
      return instant;
    }

    if (now < this.nextGarbageBurstAtMs) return 0;

    this.nextGarbageBurstAtMs =
      now + ZENITH_GARBAGE_BURST_INTERVAL_MS * this.randRange(0.72, 1.45);

    const burstMax = Math.max(1, Math.floor(this.mod.garbageBurstMax ?? ZENITH_GARBAGE_BURST_MAX_LINES));
    const lines = Math.min(burstMax, Math.floor(this.incomingBurstCarry));
    if (lines <= 0) return 0;

    this.incomingBurstCarry -= lines;
    this.playerReceivedTotal += lines;
    this.pushFeed("danger", `${lines} garbage queued`, now);
    return lines;
  }

  applyPlayerAttack(amount: number, now: number): number {
    const attack = Math.max(0, amount);
    if (attack <= 0) return 0;

    this.playerAttackTotal += attack;
    this.playerAttackRecent += attack;

    const targets = this.bots
      .filter((b) => b.alive)
      .sort((a, b) => Math.abs(a.heightM - this.playerHeightM) - Math.abs(b.heightM - this.playerHeightM))
      .slice(0, 4);

    let kills = 0;

    for (let i = 0; i < targets.length; i++) {
      const bot = targets[i];
      const share = attack * (i === 0 ? 0.55 : 0.15);
      bot.pendingGarbage += share;
      bot.receivedTotal += share;
      bot.boardHeight += share * 0.12;
      bot.holes += share * 0.04;

      if (bot.boardHeight + bot.pendingGarbage * 0.18 + bot.holes * 0.12 > 27 + bot.skill * 5) {
        bot.alive = false;
        kills++;
        this.pushFeed("ko", `you KO'd ${bot.name} at ${bot.heightM.toFixed(1)}m (+${ZENITH_KO_BONUS_M.toFixed(0)}m)`, now);
      }
    }

    return kills;
  }

  onPlayerLock(result: LockResult, now: number, attackToBots: number, canceled: number): void {
    const combo = Math.max(0, result.combo ?? 0);
    const attackEnergy = zenithAttackClimbMeters(result.attackSent);
    const lineEnergy = result.linesCleared * ZENITH_LINE_CLEAR_M;
    const survivalEnergy = ZENITH_PIECE_SURVIVAL_M;
    const spinEnergy = result.spin !== "none" ? ZENITH_SPIN_BONUS_M : 0;
    const comboEnergy = zenithComboClimbMeters(combo) * (this.mod.comboMultiplier ?? 1);

    const kills = this.applyPlayerAttack(attackToBots, now);
    const koEnergy = kills * ZENITH_KO_BONUS_M * (this.mod.koMultiplier ?? 1);

    const climbLoss = this.mod.climbLossMultiplier ?? 1;
    const gained =
      (attackEnergy + lineEnergy + survivalEnergy + spinEnergy + comboEnergy + koEnergy) *
      (this.mod.climbMultiplier ?? 1) /
      climbLoss;
    this.playerHeightM += gained;

    if (canceled > 0) {
      this.playerCanceledTotal += canceled;
      this.pushFeed("danger", `you canceled ${Math.floor(canceled)} garbage`, now);
    }

    if (gained >= 6 || kills > 0 || combo >= 4) {
      this.pushFeed(
        "floor",
        `+${gained.toFixed(1)}m atk=${result.attackSent} combo=${combo}${kills ? ` KO=${kills}` : ""}`,
        now
      );
    }
  }

  playerTopout(now: number): void {
    this.runOver = true;
    this.runResult = `Topped out at ${this.playerHeightM.toFixed(1)}m (${zenithFloorAt(this.playerHeightM).floor.name}), rank #${this.playerRank}`;
    this.pushFeed("out", this.runResult, now);
  }

  activeCount(): number {
    return this.bots.filter((b) => b.alive).length + (this.runOver ? 0 : 1);
  }

  nearbyCount(): number {
    return this.bots.filter((b) => b.alive && Math.abs(b.heightM - this.playerHeightM) <= ZENITH_NEAR_RANGE_M).length;
  }

  leaders(limit = 10): Array<{ name: string; heightM: number; attack: number; player?: boolean; alive: boolean }> {
    const rows: Array<{ name: string; heightM: number; attack: number; player?: boolean; alive: boolean }> =
      this.bots
        .filter((b) => b.alive)
        .map((b) => ({
          name: b.name,
          heightM: b.heightM,
          attack: b.attackTotal,
          alive: b.alive,
        }));

    rows.push({
      name: "you",
      heightM: this.playerHeightM,
      attack: this.playerAttackTotal,
      player: true,
      alive: !this.runOver,
    });

    return rows.sort((a, b) => b.heightM - a.heightM).slice(0, limit);
  }
}

class Ft5Trainer {
  firstTo = 15;
  mode: GameMode = "human_vs_ai";
  baseSeed = seedNow();
  roundIndex = 0;
  stepIndex = 0;
  score = { human: 0, ai: 0 };
  roundOver = false;
  matchOver = false;
  roundWinner: Winner | null = null;
  matchStarted = false;
  message = "";
  lastRoundLimitReason = "";

  private aiBattleAutoNextAt: number | null = null;
  private aiBattleAutoNextTimer: number | null = null;

  human!: TetrisEngine;
  aiEngine!: TetrisEngine;

  ai: AiLike = new HeuristicAI();
  aiName = "HeuristicAI";
  aiDetails: string[] = ["No model JSON found, fallback"];
  valueInfo: ValueModelInfo = { loaded: false, lines: ["value: none"] };

  battleLeftAi: AiLike = new HeuristicAI();
  battleLeftName = "HybridAI";
  battleRightAi: AiLike = new HeuristicAI();
  battleRightName = "HeuristicAI";
  battleOpponentKind: BattleOpponentKind = "heuristic";

  logger = new MatchLogger();
  selfplayLogger = new SelfplayLogger();
  zenith = new ZenithTowerSim(seedNow());
  zenithIncomingCarry = 0;
  aiBattleCompletedMatches = 0;
  input!: MovementInput;
  aiAccumulatorMs = 0;
  battleLeftAccumulatorMs = 0;
  battleRightAccumulatorMs = 0;
  aiPendingAction: PendingAiAction | null = null;
  battleLeftPendingAction: PendingAiAction | null = null;
  battleRightPendingAction: PendingAiAction | null = null;
  battleAttack = { left: 0, right: 0 };
  battleRawAttack = { left: 0, right: 0 };
  battleCanceled = { left: 0, right: 0 };
  allSpinClearStreak = { player: 0, left: 0, right: 0 };
  allSpinBreakRows = { player: 0, left: 0, right: 0 };

  labBagsInjected = 0;
  labGarbageInjected = 0;
  labGarbageMaterialized = 0;
  delayedIncomingGarbage: Record<EngineSlot, TimedIncomingGarbage[]> = { human: [], ai: [] };
  labDeaths = 0;

  autoUploadStatus: AutoUploadStatus = "idle";
  autoUploadDetail = "match end upload enabled";
  private autoUploadInFlight = false;
  private autoUploadedMatchId: string | null = null;

  private humanGravityCarry = 0;
  private humanGroundedSince: number | null = null;

  presence!: PresenceClient;

  constructor() {
    this.resetRound();
    this.presence = new PresenceClient(this.logger.anonymousPlayerId);
    this.presence.start();
  }

  setLoadedAi(ai: AiLike, name: string, details: string[] = []): void {
    this.ai = ai;
    this.aiName = name;
    this.aiDetails = details;

    // AI Battle is now AI Battle self-training: loaded model vs itself.
    this.battleLeftAi = ai;
    this.battleLeftName = name;
    this.battleRightAi = ai;
    this.battleRightName = name;
    this.battleOpponentKind = "heuristic";

    setStatus(`AI loaded: ${name}`);
  }

  setValueInfo(info: ValueModelInfo): void {
    this.valueInfo = info;
  }

  setMode(mode: GameMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.resetMatch();
    updateQuickPlayModSelectUi(this.mode);
  }

  toggleMode(): void {
    const next: GameMode =
      this.mode === "human_vs_ai" ? "ai_vs_ai" :
      this.mode === "ai_vs_ai" ? "lab" :
      "human_vs_ai";
    this.setMode(next);
  }

  modeLabel(): string {
    if (this.mode === "human_vs_ai") return "Human vs AI";
    if (this.mode === "ai_vs_ai") return "AI Battle";
    if (this.mode === "lab") return "Garbage Lab";
    return "Human vs AI";
  }
  updateModeButton(): void { toggleModeBtn.textContent = `Mode: ${this.modeLabel()}`; }

  inputSettings() { return { dasMs: settings.dasMs, arrMs: settings.arrMs, sdfCellsPerSecond: settings.sdfCellsPerSecond }; }

  applyCurrentModToEngines(): void {
    const options = usesQuickPlayMod(this.mode) ? currentGarbageOptions() : {};
    this.human?.setGarbageOptions?.(options);
    this.aiEngine?.setGarbageOptions?.(options);
    this.zenith?.setMod?.(QUICK_PLAY_MODS[0]);
  }

  private clearAiBattleAutoNext(): void {
    if (this.aiBattleAutoNextTimer !== null) {
      window.clearTimeout(this.aiBattleAutoNextTimer);
      this.aiBattleAutoNextTimer = null;
    }
    this.aiBattleAutoNextAt = null;
  }

  private scheduleAiBattleAutoNext(): void {
    this.clearAiBattleAutoNext();
    this.aiBattleAutoNextAt = performance.now() + 700;
    this.aiBattleAutoNextTimer = window.setTimeout(() => {
      if (isAiBattleScreen(this.mode) && this.roundOver && !this.matchOver) {
        this.nextRound();
      }
    }, 700);
  }

  resetMatch(): void {
    this.baseSeed = seedNow();
    this.roundIndex = 0;
    this.stepIndex = 0;
    this.score = { human: 0, ai: 0 };
    this.roundOver = false;
    this.matchOver = false;
    this.roundWinner = null;
    this.matchStarted = false;
    this.clearAiBattleAutoNext();
    this.logger = new MatchLogger();
    this.selfplayLogger = new SelfplayLogger();
    this.presence?.stop();
    this.presence = new PresenceClient(this.logger.anonymousPlayerId);
    this.presence.start();
    this.autoUploadStatus = "idle";
    this.autoUploadDetail =
      this.mode === "human_vs_ai" ? "human logs upload to raw/" :
      isAiBattleScreen(this.mode) ? "selfplay upload to selfplay/" :
      this.mode === "lab" ? "Lab mode does not upload logs" :
      "Zenith mode does not upload logs";
    this.autoUploadInFlight = false;
    this.autoUploadedMatchId = null;
    this.resetRound();
    this.updateModeButton();
    setStatus(
      this.mode === "human_vs_ai" ? "Press R to start Human vs AI FT15." :
      this.mode === "ai_vs_ai" ? "Press R to start AI Battle." :
      this.mode === "lab" ? "Press R to start Garbage Lab." :
      "Press R to start Human vs AI FT15."
    );
  }

  startPlayableMatch(): void {
    if (this.mode !== "human_vs_ai" && this.mode !== "ai_vs_ai" && this.mode !== "lab") {
      this.resetMatch();
      return;
    }

    this.resetMatch();
    this.matchStarted = true;
    this.resetRound();

    setStatus(
      this.mode === "lab" ? `Garbage Lab started: ${this.aiName} / ${settings.labGarbagePerBag} garbage per bag.` :
      this.mode === "ai_vs_ai" ? `AI Battle started: ${this.battleLeftName} vs ${this.battleRightName}.` :
      "Human vs AI FT15 started."
    );
  }

  resetRound(): void {
    const seed = (this.baseSeed + this.roundIndex * 1009) >>> 0;
    this.human = new TetrisEngine(seed, seed + 17);
    this.aiEngine = new TetrisEngine(seed, seed + 31);
    this.input = new MovementInput(this.human, () => this.inputSettings());

    if (this.mode === "ai_vs_ai") {
      const opponent = randomBattleOpponent(this.ai);
      this.battleLeftAi = this.ai;
      this.battleLeftName = this.aiName;
      this.battleRightAi = opponent.ai;
      this.battleRightName = opponent.name;
      this.battleOpponentKind = opponent.kind;
    } else if (this.mode === "lab") {
      this.battleLeftAi = this.ai;
      this.battleLeftName = this.aiName;
      this.battleRightName = "Garbage Lab";
    }

    this.aiAccumulatorMs = 0;
    this.battleLeftAccumulatorMs = 0;
    this.battleRightAccumulatorMs = 0;
    this.aiPendingAction = null;
    this.battleLeftPendingAction = null;
    this.battleRightPendingAction = null;
    this.humanGravityCarry = 0;
    this.humanGroundedSince = null;
    this.zenithIncomingCarry = 0;
    if (this.mode === "zenith") this.zenith.reset(performance.now(), QUICK_PLAY_MODS[0]);
    this.roundOver = false;
    this.roundWinner = null;
    this.stepIndex = 0;
    this.lastRoundLimitReason = "";
    this.battleAttack = { left: 0, right: 0 };
    this.battleRawAttack = { left: 0, right: 0 };
    this.battleCanceled = { left: 0, right: 0 };
    this.allSpinClearStreak = { player: 0, left: 0, right: 0 };
    this.allSpinBreakRows = { player: 0, left: 0, right: 0 };
    this.labBagsInjected = 0;
    this.labGarbageInjected = 0;
    this.labGarbageMaterialized = 0;
    this.delayedIncomingGarbage = { human: [], ai: [] };
    this.applyCurrentModToEngines();
    this.message =
      this.mode === "human_vs_ai"
        ? (this.matchStarted ? `Round ${this.roundIndex + 1}: play against AI.` : "Press R to start Human vs AI.")
        : isAiBattleScreen(this.mode)
          ? (this.matchStarted
            ? `Round ${this.roundIndex + 1}: ${this.battleLeftName} vs ${this.battleRightName}. Mod: ${currentQuickPlayMod.name}.`
            : "Press R to start AI Battle.")
          : this.mode === "lab"
            ? (this.matchStarted
              ? `Garbage Lab: ${this.aiName} clears garbage forever. +${settings.labGarbagePerBag} garbage/bag.`
              : "Press R to start Garbage Lab.")
            : (this.matchStarted ? "Climb Zenith Tower. New climbers always start at 0.0m." : "Press R to start Human vs AI FT15.");
  }

  finishRound(winner: Winner): void {
    if (this.roundOver) return;
    this.roundOver = true;
    this.roundWinner = winner;
    this.score[winner] += 1;

    const willMatchEnd = this.score.human >= this.firstTo || this.score.ai >= this.firstTo;

    if (this.mode === "human_vs_ai") {
      this.logger.finishRound(winner, this.score);
    } else if (isAiBattleScreen(this.mode)) {
      const sideWinner: BattleSide = winner === "human" ? "left" : "right";
      const matchWinner = willMatchEnd ? sideWinner : null;
      this.selfplayLogger.finishRound(sideWinner, { left: this.score.human, right: this.score.ai }, matchWinner);
    }

    if (willMatchEnd) {
      this.matchOver = true;
      if (this.mode === "ai_vs_ai") {
        const limitNote = this.lastRoundLimitReason ? ` Last round: ${this.lastRoundLimitReason}.` : "";
        this.message = `AI Battle over: ${this.winnerDisplay(winner)} wins FT${this.firstTo}.${limitNote} Uploading selfplay logs...`;
        this.autoUploadSelfplayMatch();
      } else {
        this.message = `Match over: ${winner} wins FT${this.firstTo}. Auto-uploading logs...`;
        this.autoUploadHumanMatch();
      }
    } else {
      if (this.mode === "ai_vs_ai") {
        this.scheduleAiBattleAutoNext();
        const limitNote = this.lastRoundLimitReason ? ` (${this.lastRoundLimitReason})` : "";
        this.message = `Round winner: ${this.winnerDisplay(winner)}${limitNote}. Auto next round...`;
      } else {
        this.message = `Round winner: ${this.winnerDisplay(winner)}. Press ${keysLabel(settings.keys.nextRound)} or Next Round.`;
      }
    }
  }

  winnerDisplay(winner: Winner): string {
    if (isAiBattleScreen(this.mode)) return winner === "human" ? this.battleLeftName : this.battleRightName;
    return winner;
  }

  private async uploadJsonl(label: string, matchId: string, jsonl: string, uploader: (jsonl: string) => Promise<string>): Promise<void> {
    const rows = jsonl.trim() ? jsonl.trim().split(/\r?\n/).length : 0;

    if (!jsonl.trim()) {
      this.autoUploadStatus = "skipped";
      this.autoUploadDetail = `no ${label} logs to upload`;
      this.message = `${label} upload skipped: no logs.`;
      setStatus(this.message);
      return;
    }

    this.autoUploadInFlight = true;
    this.autoUploadStatus = "uploading";
    this.autoUploadDetail = `${label}: ${rows} rows, match ${matchId.slice(0, 8)}...`;
    setStatus(`Uploading ${label} ${rows} rows...`);

    try {
      const res = await uploader(jsonl);
      this.autoUploadInFlight = false;
      this.autoUploadedMatchId = matchId;
      this.autoUploadStatus = label === "selfplay" ? "selfplay" : "uploaded";
      this.autoUploadDetail = short(res, 110);
      this.message = `${label} logs uploaded (${rows} rows).`;
      setStatus(this.message);
      if (isAiBattleScreen(this.mode) && label === "selfplay") {
        this.aiBattleCompletedMatches++;
        window.setTimeout(() => {
          if (isAiBattleScreen(this.mode)) this.resetMatch();
        }, 850);
      }
    } catch (err) {
      this.autoUploadInFlight = false;
      this.autoUploadStatus = "failed";
      this.autoUploadDetail = short(err instanceof Error ? err.message : String(err), 110);
      this.message = `${label} upload failed; use Download Logs.`;
      setStatus(`${this.message} ${this.autoUploadDetail}`);
    }
  }

  private autoUploadHumanMatch(): void {
    const matchId = this.logger.matchId;
    if (this.autoUploadInFlight || this.autoUploadedMatchId === matchId) return;
    void this.uploadJsonl("human", matchId, this.logger.toJsonl(false), uploadLogs);
  }

  private autoUploadSelfplayMatch(): void {
    const matchId = this.selfplayLogger.matchId;
    if (this.autoUploadInFlight || this.autoUploadedMatchId === matchId) return;
    void this.uploadJsonl("selfplay", matchId, this.selfplayLogger.toJsonl(false), uploadSelfplayLogs);
  }

  nextRound(): void {
    if (this.roundOver && !this.matchOver) {
      this.clearAiBattleAutoNext();
      this.roundIndex++;
      this.resetRound();
    }
  }
  private resetHumanGroundTimer(): void { this.humanGroundedSince = null; }
  private isHumanGrounded(): boolean { return this.human.hardDropDistance(this.human.active) <= 0; }

  private updateHumanGravity(dtMs: number, now: number): void {
    if ((this.mode !== "human_vs_ai") || this.roundOver || this.matchOver || this.human.dead || !this.matchStarted) return;
    const gravity =
      Math.max(0, settings.gravityCellsPerSecond) *
      1;
    if (gravity > 0) {
      this.humanGravityCarry += (dtMs / 1000) * gravity;
      const steps = Math.min(20, Math.floor(this.humanGravityCarry));
      if (steps > 0) this.humanGravityCarry -= steps;
      for (let i = 0; i < steps; i++) {
        const moved = this.human.move(0, 1);
        if (moved) this.resetHumanGroundTimer(); else break;
      }
    }
    if (this.isHumanGrounded()) {
      if (this.humanGroundedSince === null) this.humanGroundedSince = now;
      if (now - this.humanGroundedSince >= settings.lockDelayMs) this.humanLockCurrent(now);
    } else this.humanGroundedSince = null;
  }

  private logHumanAction(activeBefore: PieceState, usedHold: boolean, stateBefore: ReturnType<TetrisEngine["stateDict"]>, aiStateBefore: ReturnType<TetrisEngine["stateDict"]>, result: ReturnType<TetrisEngine["hardDrop"]>): void {
    const rot = ((activeBefore.rot % 4) + 4) % 4;
    const action: PlacementAction = {
      piece: activeBefore.kind,
      x: activeBefore.x,
      rot,
      hold: usedHold,
      key: `${usedHold ? "H:" : ""}${activeBefore.kind}:${activeBefore.x}:${rot}`,
    };
    this.logger.logHumanMove({ roundIndex: this.roundIndex, stepIndex: this.stepIndex, state: stateBefore, aiState: aiStateBefore, action, result });
  }

  private resolveZenithAttackCancel(attackSent: number): { sentToBots: number; canceled: number } {
    let outgoing = Math.max(0, Math.floor(attackSent));
    let canceled = 0;

    // Cancel already queued garbage first.
    const cancelPending = Math.min(this.human.pendingGarbage, outgoing);
    if (cancelPending > 0) {
      this.human.pendingGarbage -= cancelPending;
      outgoing -= cancelPending;
      canceled += cancelPending;
    }

    // Then cancel incoming pressure that has accumulated for the next burst.
    const cancelCarry = Math.min(this.zenith.incomingBurstCarry, outgoing);
    if (cancelCarry > 0) {
      this.zenith.incomingBurstCarry -= cancelCarry;
      outgoing -= cancelCarry;
      canceled += cancelCarry;
    }

    return { sentToBots: outgoing, canceled };
  }

  private handlePlayerLockResult(result: LockResult, now: number): void {
    const effectiveResult = this.applyQuickPlayModToResult(result);
    this.applyAllSpinBreakGarbage(this.human, "player", effectiveResult);
    if (this.mode === "zenith") {
      const cancel = this.resolveZenithAttackCancel(effectiveResult.attackSent);
      this.zenith.onPlayerLock(effectiveResult, now, cancel.sentToBots, cancel.canceled);
      applyRemainingGarbageAfterCounter(this.human, effectiveResult);
      if (this.human.dead || result.topout) {
        this.zenith.playerTopout(now);
        this.matchOver = true;
        this.message = this.zenith.runResult;
        setStatus(this.message);
        return;
      }
    } else {
      const attackApplied = applyAttack(this.human, this.aiEngine, effectiveResult.attackSent);
      if (attackApplied.sent > 0) this.scheduleIncomingGarbage("ai", attackApplied.sent, now);
      applyRemainingGarbageAfterCounter(this.human, effectiveResult);
      if (this.human.dead || effectiveResult.topout) { this.finishRound("ai"); return; }
    }
    this.input.resetRepeatAfterPieceChange(now);
  }

  private humanLockCurrent(now: number): void {
    if (this.roundOver || this.matchOver || this.human.dead || (this.mode !== "human_vs_ai")) return;
    const stateBefore = this.human.stateDict();
    const aiStateBefore = this.aiEngine.stateDict();
    const activeBefore: PieceState = { ...this.human.active };
    const usedHold = this.human.holdUsedForCurrentPiece;
    const result = this.human.lockPiece();
    if (this.mode === "human_vs_ai") this.logHumanAction(activeBefore, usedHold, stateBefore, aiStateBefore, result);
    this.humanGravityCarry = 0;
    this.humanGroundedSince = null;
    this.handlePlayerLockResult(result, now);
  }

  humanHardDrop(): void {
    if (this.roundOver || this.matchOver || this.human.dead || (this.mode !== "human_vs_ai")) return;
    const now = performance.now();
    const stateBefore = this.human.stateDict();
    const aiStateBefore = this.aiEngine.stateDict();
    const activeBefore: PieceState = { ...this.human.active };
    const usedHold = this.human.holdUsedForCurrentPiece;
    const result = this.human.hardDrop();
    if (this.mode === "human_vs_ai") this.logHumanAction(activeBefore, usedHold, stateBefore, aiStateBefore, result);
    this.humanGravityCarry = 0;
    this.humanGroundedSince = null;
    this.handlePlayerLockResult(result, now);
  }

  private allSpinFullAttack(lines: number): number {
    if (lines <= 0) return 0;
    if (lines === 1) return 2;
    if (lines === 2) return 4;
    if (lines === 3) return 6;
    return 8;
  }

  private applyQuickPlayModToResult(result: LockResult, action?: PlacementAction): LockResult {
    if (!usesQuickPlayMod(this.mode)) return result;

    let attackSent = result.attackSent;
    let rawAttack = result.rawAttack;
    let spin = result.spin;

    if (currentQuickPlayMod.allSpin && result.spin === "spin" && result.piece !== "T") {
      const full = this.allSpinFullAttack(result.linesCleared);
      if (full > rawAttack) {
        rawAttack = full;
        attackSent = Math.max(attackSent, full);
      }
      spin = "spin";
    }

    const attackMultiplier = currentQuickPlayMod.attackMultiplier ?? 1;
    if (attackMultiplier !== 1) {
      attackSent = Math.max(0, Math.floor(attackSent * attackMultiplier));
      rawAttack = Math.max(0, Math.floor(rawAttack * attackMultiplier));
    }

    return { ...result, attackSent, rawAttack, spin };
  }

  private applyQuickPlayModToAction(action: PlacementAction): PlacementAction {
    if (usesQuickPlayMod(this.mode) && currentQuickPlayMod.disableHold && action.hold) {
      return { ...action, hold: false, key: action.key.replace(/^H:/, "") };
    }
    return action;
  }

  private applyAllSpinBreakGarbage(engine: TetrisEngine, slot: "player" | "left" | "right", result: LockResult): void {
    if (!usesQuickPlayMod(this.mode) || !currentQuickPlayMod.allSpin || result.linesCleared <= 0) return;

    this.allSpinClearStreak[slot] += 1;

    if (this.allSpinClearStreak[slot] >= 7) {
      engine.addBrokenGarbageRows?.(1);
      this.allSpinClearStreak[slot] = 0;
      this.allSpinBreakRows[slot] += 1;

      if (slot === "player") {
        setStatus("All-Spin: 7 line clears reached, breakable garbage added.");
      }
    }
  }

  private normalizeRot(rot: number): number {
    return ((rot % 4) + 4) % 4;
  }

  private activeKey(engine: TetrisEngine): string {
    const a = engine.active;
    return `${a.kind}:${a.x}:${a.y}:${this.normalizeRot(a.rot)}`;
  }

  private applyAiMoveOp(engine: TetrisEngine, op: AiMoveOp): boolean {
    if (op === "hold") return engine.holdPiece();
    if (op === "left") return engine.move(-1, 0);
    if (op === "right") return engine.move(1, 0);
    if (op === "cw") return engine.rotateCw();
    if (op === "ccw") return engine.rotateCcw();
    if (op === "180") return engine.rotate180();
    return false;
  }

  private findAiMovePath(engine: TetrisEngine, action: PlacementAction): AiMoveOp[] | null {
    const targetX = action.x;
    const targetRot = this.normalizeRot(action.rot);
    const start = engine.clone();
    const prefix: AiMoveOp[] = [];

    if (action.hold) {
      if (!start.holdPiece()) return null;
      prefix.push("hold");
    }

    if (start.active.kind !== action.piece) return null;

    const isTarget = (e: TetrisEngine) =>
      e.active.kind === action.piece &&
      e.active.x === targetX &&
      this.normalizeRot(e.active.rot) === targetRot;

    if (isTarget(start)) return prefix;

    const ops: AiMoveOp[] = ["cw", "ccw", "180", "left", "right"];
    const seen = new Set<string>([this.activeKey(start)]);
    const queue: Array<{ engine: TetrisEngine; path: AiMoveOp[] }> = [{ engine: start, path: [] }];
    const maxPath = 28;

    for (let head = 0; head < queue.length; head++) {
      const item = queue[head];
      if (item.path.length >= maxPath) continue;

      for (const op of ops) {
        const next = item.engine.clone();
        if (!this.applyAiMoveOp(next, op)) continue;

        const key = this.activeKey(next);
        if (seen.has(key)) continue;
        seen.add(key);

        const path = [...item.path, op];
        if (isTarget(next)) return [...prefix, ...path];

        queue.push({ engine: next, path });
      }
    }

    return null;
  }

  private executeAiPlacementByMoves(engine: TetrisEngine, action: PlacementAction): AiMoveExecution {
    const ops = this.findAiMovePath(engine, action);

    if (!ops) {
      // Do not teleport to the requested placement. If the target cannot be
      // reached through normal movement, lock the current reachable position.
      return {
        result: engine.clone().hardDrop(),
        ops: [],
        reachedTarget: false,
      };
    }

    const preview = engine.clone();
    let reached = true;
    for (const op of ops) {
      if (!this.applyAiMoveOp(preview, op)) {
        reached = false;
        break;
      }
    }

    const targetReached =
      reached &&
      preview.active.kind === action.piece &&
      preview.active.x === action.x &&
      this.normalizeRot(preview.active.rot) === this.normalizeRot(action.rot);

    return {
      result: preview.hardDrop(),
      ops,
      reachedTarget: targetReached,
    };
  }

  private pendingActionRef(side?: BattleSide): "aiPendingAction" | "battleLeftPendingAction" | "battleRightPendingAction" {
    if (side === "left") return "battleLeftPendingAction";
    if (side === "right") return "battleRightPendingAction";
    return "aiPendingAction";
  }

  private getPendingAction(side?: BattleSide): PendingAiAction | null {
    return this[this.pendingActionRef(side)];
  }

  private setPendingAction(value: PendingAiAction | null, side?: BattleSide): void {
    this[this.pendingActionRef(side)] = value;
  }

  private chooseAiAction(engine: TetrisEngine, ai: AiLike): AiChoice | null {
    const normal = ai.choose(engine);
    if (!normal) return null;

    const metrics = boardMetrics(engine.stateDict().board);
    const danger = metrics.maxHeight >= 14 || engine.pendingGarbage >= 6;
    if (danger || Math.random() >= 0.10) return normal;

    const scorer = (ai as unknown as { scoreAfter?: (e: TetrisEngine, a: PlacementAction) => { score: number; info: Record<string, unknown> } }).scoreAfter;
    const fallback = (ai as unknown as { fallback?: { scoreAfter?: (e: TetrisEngine, a: PlacementAction) => { score: number; info: Record<string, unknown> } } }).fallback;
    const scoreAfter = typeof scorer === "function" ? scorer.bind(ai) :
      typeof fallback?.scoreAfter === "function" ? fallback.scoreAfter.bind(fallback) :
      null;

    if (!scoreAfter) return normal;

    const legal = engine.legalPlacements(true);
    if (legal.length < 2) return normal;

    const ranked = legal
      .map((action) => ({ action, ...scoreAfter(engine, action) }))
      .filter((x) => Number.isFinite(x.score))
      .sort((a, b) => a.score - b.score);

    if (ranked.length < 2) return normal;

    const maxAltIndex = Math.min(2, ranked.length - 1);
    const altIndex = maxAltIndex >= 2 && Math.random() < 0.20 ? 2 : 1;
    const alt = ranked[altIndex];

    return {
      ...alt.action,
      aiScore: alt.score,
      aiInfo: { ...alt.info, randomVariant: true, randomVariantRank: altIndex + 1, normalScore: normal.aiScore },
    };
  }

  private startAiAction(engine: TetrisEngine, opponent: TetrisEngine, ai: AiLike, side?: BattleSide): boolean {
    if (this.roundOver || this.matchOver || engine.dead) return false;
    if (this.getPendingAction(side)) return true;

    const stateBefore = engine.stateDict();
    const opponentBefore = opponent.stateDict();

    const chosenAction = this.chooseAiAction(engine, ai);
    if (!chosenAction) return false;

    const plannedAction = this.applyQuickPlayModToAction(chosenAction);
    const execution = this.executeAiPlacementByMoves(engine, plannedAction);
    const pending: PendingAiAction = {
      stateBefore,
      opponentBefore,
      plannedAction,
      ops: execution.ops,
      opIndex: 0,
      routeFailed: !execution.reachedTarget,
      side,
    };
    this.setPendingAction(pending, side);
    return true;
  }

  private finishAiPlacement(engine: TetrisEngine, opponent: TetrisEngine, pending: PendingAiAction, side?: BattleSide): boolean {
    const slot: "left" | "right" = side === "right" ? "right" : "left";
    const action: PlacementAction = {
      ...pending.plannedAction,
      key: `${pending.plannedAction.key}|ops:${pending.ops.length + 1}|moves:${pending.ops.join(",") || "harddrop"}${pending.routeFailed ? "|route_failed" : ""}`,
    };
    const rawResult = engine.hardDrop();
    const result = this.applyQuickPlayModToResult(rawResult, action);
    this.applyAllSpinBreakGarbage(engine, slot, result);
    const attackApplied = applyAttack(engine, opponent, result.attackSent);
    if (attackApplied.sent > 0) this.scheduleIncomingGarbage(this.slotForEngine(opponent), attackApplied.sent);
    const appliedGarbage = applyRemainingGarbageAfterCounter(engine, result);
    if (this.mode === "lab" && engine === this.human) this.labGarbageMaterialized += appliedGarbage;

    if ((this.mode === "ai_vs_ai") && side) {
      this.battleAttack[side] += attackApplied.sent;
      this.battleRawAttack[side] += attackApplied.rawAttack;
      this.battleCanceled[side] += attackApplied.canceled;
    }

    const stateAfter = engine.stateDict();
    const opponentAfter = opponent.stateDict();

    if ((this.mode === "ai_vs_ai") && side) {
      this.selfplayLogger.logMove({
        leftAiName: this.battleLeftName,
        rightAiName: this.battleRightName,
        side,
        roundIndex: this.roundIndex,
        stepIndex: this.stepIndex,
        state: pending.stateBefore,
        opponentState: pending.opponentBefore,
        action,
        result,
        stateAfter,
        opponentStateAfter: opponentAfter,
      });
    }

    this.stepIndex++;
    return !(engine.dead || result.topout);
  }

  private aiActionStep(engine: TetrisEngine, opponent: TetrisEngine, ai: AiLike, side?: BattleSide): boolean {
    if (this.roundOver || this.matchOver || engine.dead) return false;

    let pending = this.getPendingAction(side);
    if (!pending) {
      const started = this.startAiAction(engine, opponent, ai, side);
      if (!started) return false;
      pending = this.getPendingAction(side);
      if (!pending) return false;
    }

    if (pending.opIndex < pending.ops.length) {
      const op = pending.ops[pending.opIndex]!;
      const ok = this.applyAiMoveOp(engine, op);
      if (!ok) pending.routeFailed = true;
      pending.opIndex++;
      return true;
    }

    this.setPendingAction(null, side);
    return this.finishAiPlacement(engine, opponent, pending, side);
  }

  aiTurn(): void {
    if (this.mode !== "human_vs_ai" || this.roundOver || this.matchOver || this.aiEngine.dead) return;
    const alive = this.aiActionStep(this.aiEngine, this.human, this.ai);
    if (!alive) { this.finishRound("human"); return; }
    if (this.human.dead) this.finishRound("ai");
  }

  private battleDangerScore(engine: TetrisEngine): number {
    const metrics = boardMetrics(engine.stateDict().board);

    // Lower is better. Holes and height matter most; pending garbage matters
    // because it is about to become danger if the bot fails to clear/cancel.
    return (
      metrics.holes * 9.0 +
      metrics.maxHeight * 3.5 +
      metrics.totalHeight * 0.18 +
      metrics.bumpiness * 0.55 +
      metrics.wells * 0.2 +
      engine.pendingGarbage * 4.0 -
      Math.max(0, engine.b2b) * 0.35 -
      Math.max(0, engine.combo) * 0.2
    );
  }

  private finishAiBattleByLimit(): void {
    if (!isAiBattleScreen(this.mode) || this.roundOver || this.matchOver) return;
    if (this.stepIndex < AI_BATTLE_MAX_TURNS_PER_ROUND) return;

    const leftSent = this.battleAttack.left;
    const rightSent = this.battleAttack.right;
    const leftScore = this.battleDangerScore(this.human);
    const rightScore = this.battleDangerScore(this.aiEngine);

    let winner: Winner;
    let reason: string;

    if (leftSent !== rightSent) {
      winner = leftSent > rightSent ? "human" : "ai";
      reason =
        `turn limit ${AI_BATTLE_MAX_TURNS_PER_ROUND}: ` +
        `sent ${this.battleLeftName}=${leftSent}, ${this.battleRightName}=${rightSent}`;
    } else if (Math.abs(leftScore - rightScore) >= 0.001) {
      winner = leftScore < rightScore ? "human" : "ai";
      reason =
        `turn limit ${AI_BATTLE_MAX_TURNS_PER_ROUND}: sent tie ${leftSent}, ` +
        `danger ${this.battleLeftName}=${leftScore.toFixed(1)}, ${this.battleRightName}=${rightScore.toFixed(1)}`;
    } else if (this.human.pendingGarbage !== this.aiEngine.pendingGarbage) {
      winner = this.human.pendingGarbage < this.aiEngine.pendingGarbage ? "human" : "ai";
      reason =
        `turn limit ${AI_BATTLE_MAX_TURNS_PER_ROUND}: sent/danger tie, ` +
        `pending ${this.battleLeftName}=${this.human.pendingGarbage}, ${this.battleRightName}=${this.aiEngine.pendingGarbage}`;
    } else {
      winner = (this.roundIndex % 2 === 0) ? "human" : "ai";
      reason = `turn limit ${AI_BATTLE_MAX_TURNS_PER_ROUND}: full tie, deterministic side`;
    }

    this.lastRoundLimitReason = reason;
    this.finishRound(winner);
  }

  battleTurn(side: "left" | "right"): void {
    if (!isAiBattleScreen(this.mode) || this.roundOver || this.matchOver) return;
    if (side === "left") {
      const alive = this.aiActionStep(this.human, this.aiEngine, this.battleLeftAi, "left");
      if (!alive) { this.finishRound("ai"); return; }
      if (this.aiEngine.dead) { this.finishRound("human"); return; }
      this.finishAiBattleByLimit();
    } else {
      const alive = this.aiActionStep(this.aiEngine, this.human, this.battleRightAi, "right");
      if (!alive) { this.finishRound("human"); return; }
      if (this.human.dead) { this.finishRound("ai"); return; }
      this.finishAiBattleByLimit();
    }
  }

  private engineForSlot(slot: EngineSlot): TetrisEngine {
    return slot === "human" ? this.human : this.aiEngine;
  }

  private slotForEngine(engine: TetrisEngine): EngineSlot {
    return engine === this.aiEngine ? "ai" : "human";
  }

  private incomingMultiplierForCurrentMode(): number {
    return usesQuickPlayMod(this.mode) ? (currentQuickPlayMod.incomingMultiplier ?? 1) : 1;
  }

  private scheduleIncomingGarbage(slot: EngineSlot, amount: number, now = performance.now()): void {
    const scaled = Math.max(0, Math.floor(amount * this.incomingMultiplierForCurrentMode()));
    if (scaled <= 0) return;
    this.delayedIncomingGarbage[slot].push({
      amount: scaled,
      receivedAtMs: now,
      readyAtMs: now + LAB_GARBAGE_DELAY_MS,
    });
  }

  private scheduledIncomingGarbage(slot: EngineSlot, now: number): number {
    return this.delayedIncomingGarbage[slot]
      .filter((item) => item.readyAtMs > now)
      .reduce((sum, item) => sum + item.amount, 0);
  }

  readyIncomingGarbage(slot: EngineSlot): number {
    return this.engineForSlot(slot).pendingGarbage;
  }

  private materializeReadyIncomingGarbage(slot: EngineSlot, now: number): void {
    const ready = this.delayedIncomingGarbage[slot].filter((item) => item.readyAtMs <= now);
    if (ready.length === 0) return;
    const amount = ready.reduce((sum, item) => sum + item.amount, 0);
    this.delayedIncomingGarbage[slot] = this.delayedIncomingGarbage[slot].filter((item) => item.readyAtMs > now);
    if (amount > 0) this.engineForSlot(slot).queueGarbage(amount);
  }

  private updateIncomingGarbage(now: number): void {
    this.materializeReadyIncomingGarbage("human", now);
    this.materializeReadyIncomingGarbage("ai", now);
  }

  garbageSegmentsFor(slot: EngineSlot, now: number): Array<{ label: string; amount: number; color: string }> {
    const ready = this.readyIncomingGarbage(slot);
    const scheduled = this.scheduledIncomingGarbage(slot, now);

    // drawGarbageMeter draws bottom-up. Ready/red comes first, so it appears from the bottom.
    return [
      { label: "ready", amount: ready, color: "#ef4444" },
      { label: "scheduled", amount: scheduled, color: "#9ca3af" },
    ].filter((segment) => segment.amount > 0);
  }

  private scheduleLabGarbageAfterLock(now: number): void {
    const completedBags = Math.floor(this.human.piecesLocked / 7);
    while (this.labBagsInjected < completedBags) {
      const base = Math.max(0, Math.floor(settings.labGarbagePerBag));
      if (base > 0) {
        this.scheduleIncomingGarbage("human", base, now);
        this.labGarbageInjected += Math.max(0, Math.floor(base * this.incomingMultiplierForCurrentMode()));
      }
      this.labBagsInjected++;
    }
  }

  labQueuedGarbage(): number {
    return this.delayedIncomingGarbage.human.reduce((sum, item) => sum + item.amount, 0) + this.human.pendingGarbage;
  }

  labGrayGarbage(now: number): number {
    return this.scheduledIncomingGarbage("human", now);
  }

  labReadyGarbage(_now: number): number {
    return this.human.pendingGarbage;
  }

  nextLabGarbageSeconds(now: number): string {
    if (this.delayedIncomingGarbage.human.length === 0) return "-";
    const nextReady = Math.min(...this.delayedIncomingGarbage.human.map((item) => item.readyAtMs));
    return (Math.max(0, nextReady - now) / 1000).toFixed(1);
  }

  private updateLabAfterLock(now: number): void {
    this.scheduleLabGarbageAfterLock(now);
  }

  private updateLab(dtMs: number): void {
    if (this.mode !== "lab" || !this.matchStarted || this.matchOver) return;

    if (this.human.dead) {
      this.labDeaths++;
      this.resetRound();
      this.matchStarted = true;
      this.message = `Garbage Lab reset after topout. deaths=${this.labDeaths}`;
      return;
    }

    const opsPerSecond = Math.max(1, Math.min(MAX_AI_OPS_PER_SECOND, settings.aiOpsPerSecond));
    const opsThisFrame = (dtMs / 1000) * opsPerSecond;
    const maxOpsPerFrame = Math.max(8, Math.min(400, Math.ceil(opsPerSecond / 12)));

    this.aiAccumulatorMs += opsThisFrame;
    let guard = 0;
    while (this.aiAccumulatorMs >= 1 && guard < maxOpsPerFrame && !this.human.dead) {
      this.aiAccumulatorMs -= 1;
      const before = this.human.piecesLocked;
      const alive = this.aiActionStep(this.human, this.aiEngine, this.ai);
      if (!alive || this.human.dead) break;
      if (this.human.piecesLocked !== before) this.updateLabAfterLock(performance.now());
      guard++;
    }
  }

  private updateZenith(dtMs: number, now: number): void {
    if (this.mode !== "zenith" || !this.matchStarted || this.matchOver || this.human.dead) return;
    this.input.update(now);
    this.updateHumanGravity(dtMs, now);

    this.zenith.update(dtMs, now, this.human.pendingGarbage);
    const garbage = this.zenith.consumeGarbageBurst(dtMs, now);
    if (garbage > 0) this.human.queueGarbage(garbage);

    if (this.human.dead) {
      this.zenith.playerTopout(now);
      this.matchOver = true;
      this.message = this.zenith.runResult;
    }
  }

  update(dtMs: number, now: number): void {
    this.updateIncomingGarbage(now);
    if (isAiBattleScreen(this.mode) && this.roundOver && !this.matchOver && this.aiBattleAutoNextAt !== null && now >= this.aiBattleAutoNextAt) {
      this.nextRound();
    }

    if (this.roundOver || this.matchOver) return;
    if (this.mode === "zenith") {
      this.updateZenith(dtMs, now);
      return;
    }
    if (this.mode === "lab") {
      this.updateLab(dtMs);
      return;
    }
    if (this.mode === "human_vs_ai" && !this.matchStarted) return;
    if (this.mode === "ai_vs_ai" && !this.matchStarted) return;

    const opsPerSecond = Math.max(1, Math.min(MAX_AI_OPS_PER_SECOND, settings.aiOpsPerSecond));
    const opsThisFrame = (dtMs / 1000) * opsPerSecond;

    // Accumulators are operation credits. One credit = one visible AI input
    // (left/right/rotate/hold/harddrop), so the AI's travel path is drawn.
    const maxAiActionsPerFrame = Math.max(8, Math.min(400, Math.ceil(opsPerSecond / 12)));
    if (this.mode === "human_vs_ai") {
      this.input.update(now);
      this.updateHumanGravity(dtMs, now);
      this.aiAccumulatorMs += opsThisFrame;
      let guard = 0;
      while (this.aiAccumulatorMs >= 1 && guard < maxAiActionsPerFrame && !this.roundOver && !this.matchOver) {
        this.aiAccumulatorMs -= 1;
        this.aiTurn();
        guard++;
      }
    } else if (isAiBattleScreen(this.mode)) {
      this.battleLeftAccumulatorMs += opsThisFrame;
      this.battleRightAccumulatorMs += opsThisFrame;
      let guard = 0;
      while (this.battleLeftAccumulatorMs >= 1 && guard < maxAiActionsPerFrame && !this.roundOver && !this.matchOver) {
        this.battleLeftAccumulatorMs -= 1;
        this.battleTurn("left");
        guard++;
      }
      guard = 0;
      while (this.battleRightAccumulatorMs >= 1 && guard < maxAiActionsPerFrame && !this.roundOver && !this.matchOver) {
        this.battleRightAccumulatorMs -= 1;
        this.battleTurn("right");
        guard++;
      }
    }
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (!settingsModal.classList.contains("hidden")) return;
    if (gameKeys().has(e.key)) e.preventDefault();
    if (isBound(e, settings.keys.reset)) {
      if (this.mode === "human_vs_ai" || this.mode === "ai_vs_ai" || this.mode === "lab") this.startPlayableMatch();
      else this.resetMatch();
      return;
    }
    if (this.roundOver) { if (isBound(e, settings.keys.nextRound)) this.nextRound(); return; }
    if (this.matchOver || (this.mode !== "human_vs_ai") || !this.matchStarted) return;
    const now = performance.now();
    let logical: LogicalMoveKey | null = null;
    if (isBound(e, settings.keys.left)) logical = "left";
    else if (isBound(e, settings.keys.right)) logical = "right";
    else if (isBound(e, settings.keys.softDrop)) logical = "down";
    if (logical) { this.input.keyDown(logical, now); this.resetHumanGroundTimer(); return; }
    if (isBound(e, settings.keys.rotateCw)) {
      if (this.human.rotateCw()) { this.input.notifyTransform(now); this.resetHumanGroundTimer(); }
    } else if (isBound(e, settings.keys.rotateCcw)) {
      if (this.human.rotateCcw()) { this.input.notifyTransform(now); this.resetHumanGroundTimer(); }
    } else if (isBound(e, settings.keys.rotate180)) {
      if (this.human.rotate180()) { this.input.notifyTransform(now); this.resetHumanGroundTimer(); }
    } else if (isBound(e, settings.keys.hold)) {
      const beforeKind = this.human.active.kind;
      const beforeHold = this.human.hold;
      const ok = this.human.holdPiece();
      if (ok && (this.human.active.kind !== beforeKind || this.human.hold !== beforeHold)) {
        this.input.resetRepeatAfterPieceChange(now); this.resetHumanGroundTimer();
      }
    } else if (isBound(e, settings.keys.hardDrop)) this.humanHardDrop();
  }

  handleKeyUp(e: KeyboardEvent): void {
    if (this.mode !== "human_vs_ai") return;
    let logical: LogicalMoveKey | null = null;
    if (isBound(e, settings.keys.left)) logical = "left";
    else if (isBound(e, settings.keys.right)) logical = "right";
    else if (isBound(e, settings.keys.softDrop)) logical = "down";
    if (logical) this.input.keyUp(logical, performance.now());
  }

  handleTouchAction(action: TouchAction, down: boolean): void {
    const now = performance.now();

    if (action === "start") {
      if (down) this.startPlayableMatch();
      return;
    }

    if (action === "next") {
      if (down) this.nextRound();
      return;
    }

    if (this.mode !== "human_vs_ai") return;
    if (!this.matchStarted || this.matchOver) return;

    if (action === "left" || action === "right" || action === "down") {
      if (down) {
        this.input.keyDown(action, now);
        this.resetHumanGroundTimer();
      } else this.input.keyUp(action, now);
      return;
    }

    if (!down) return;

    if (action === "cw") {
      if (this.human.rotateCw()) { this.input.notifyTransform(now); this.resetHumanGroundTimer(); }
    } else if (action === "ccw") {
      if (this.human.rotateCcw()) { this.input.notifyTransform(now); this.resetHumanGroundTimer(); }
    } else if (action === "180") {
      if (this.human.rotate180()) { this.input.notifyTransform(now); this.resetHumanGroundTimer(); }
    } else if (action === "hold") {
      const beforeKind = this.human.active.kind;
      const beforeHold = this.human.hold;
      const ok = this.human.holdPiece();
      if (ok && (this.human.active.kind !== beforeKind || this.human.hold !== beforeHold)) {
        this.input.resetRepeatAfterPieceChange(now);
        this.resetHumanGroundTimer();
      }
    } else if (action === "drop") this.humanHardDrop();
  }
}

const trainer = new Ft5Trainer();

function setupTouchControls(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const controls = document.createElement("div");
  controls.id = "touchControls";
  const buttons: Array<[string, TouchAction, string]> = [
    ["START", "start", "wide"],
    ["NEXT", "next", "wide"],
    ["◀", "left", ""],
    ["▼", "down", ""],
    ["▶", "right", ""],
    ["DROP", "drop", ""],
    ["CCW", "ccw", ""],
    ["CW", "cw", ""],
    ["180", "180", ""],
    ["HOLD", "hold", ""],
  ];

  for (const [label, action, cls] of buttons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `touchButton ${cls}`.trim();
    btn.textContent = label;

    const press = (ev: Event) => {
      ev.preventDefault();
      trainer.handleTouchAction(action, true);
    };
    const release = (ev: Event) => {
      ev.preventDefault();
      trainer.handleTouchAction(action, false);
    };

    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("pointerleave", release);
    controls.appendChild(btn);
  }

  app.appendChild(controls);
}

setupTouchControls();

async function loadAiModel(): Promise<void> {
  const modelUrl = `${import.meta.env.BASE_URL}models/web_policy.json`;
  const ai = await WebPolicyAI.load(modelUrl);
  if (ai) trainer.setLoadedAi(ai, ai.displayName(), ai.infoLines());
  else trainer.setLoadedAi(new HeuristicAI(), "HeuristicAI fallback", [`No model JSON found at ${modelUrl}`]);
}

async function loadValueModelInfo(): Promise<void> {
  const url = `${import.meta.env.BASE_URL}models/web_value.json?t=${Date.now()}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "cache-control": "no-cache", "pragma": "no-cache" }
    });

    if (!res.ok) {
      trainer.setValueInfo({ loaded: false, lines: ["value: none"] });
      return;
    }

    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    const trimmed = text.trim();

    // Cloudflare Pages may return index.html for missing files.
    // Treat HTML fallback as "no value model" instead of throwing JSON parse errors.
    if (contentType.includes("text/html") || trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || !trimmed) {
      trainer.setValueInfo({ loaded: false, lines: ["value: none"] });
      return;
    }

    const data = JSON.parse(trimmed);
    trainer.setValueInfo({ loaded: true, lines: valueModelLines(data) });
  } catch (err) {
    console.warn("[TetraFlux] failed to load value model info", err);
    trainer.setValueInfo({ loaded: false, lines: ["value: load failed"] });
  }
}

function resizeCanvasForDisplay(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const ww = Math.floor(rect.width * dpr);
  const hh = Math.floor(rect.height * dpr);
  if (canvas.width !== ww || canvas.height !== hh) { canvas.width = ww; canvas.height = hh; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

let lastFullRenderAt = 0;
let lastFullRenderStep = -1;

function shouldSkipFullRender(now: number): boolean {
  if (!isAiBattleScreen(trainer.mode) || settings.aiOpsPerSecond <= 15 || trainer.roundOver || trainer.matchOver) {
    lastFullRenderAt = now;
    lastFullRenderStep = trainer.stepIndex;
    return false;
  }

  const stepDelta = trainer.stepIndex - lastFullRenderStep;
  const minStepDelta = settings.aiOpsPerSecond >= 200 ? 80 : settings.aiOpsPerSecond >= 100 ? 40 : settings.aiOpsPerSecond >= 50 ? 20 : settings.aiOpsPerSecond >= 19 ? 8 : 4;
  const maxSilentMs = settings.aiOpsPerSecond >= 100 ? 350 : 220;

  if (stepDelta < minStepDelta && now - lastFullRenderAt < maxSilentMs) {
    return true;
  }

  lastFullRenderAt = now;
  lastFullRenderStep = trainer.stepIndex;
  return false;
}


function drawZenithTower(ctx: CanvasRenderingContext2D, trainer: Ft5Trainer, x: number, y: number, w: number, h: number): void {
  const z = trainer.zenith;
  const floorInfo = zenithFloorAt(z.playerHeightM);
  const nextText = floorInfo.next
    ? `next ${floorInfo.next.name} @ ${floorInfo.next.borderM}m`
    : "top floor";
  drawPanel(ctx, x, y, w, h, "Zenith Tower", [
    [`height: ${z.playerHeightM.toFixed(1)}m`, "#e5e7eb"],
    [`floor: ${floorInfo.floor.name}`, floorInfo.floor.color],
    [nextText, "#64748b"],
    [`rank: #${z.playerRank} / ${z.activeCount()}`, "#34d399"],
    [`nearby: ${z.nearbyCount()}  pressure: ${z.playerIncomingRate.toFixed(2)}/s`, "#94a3b8"],
    [`next burst: ${z.incomingBurstCarry.toFixed(1)} / max ${ZENITH_GARBAGE_BURST_MAX_LINES}`, "#64748b"],
    [`sent: ${Math.round(z.playerAttackTotal)}  cancel: ${Math.round(z.playerCanceledTotal)}`, "#94a3b8"],
    [`received: ${Math.round(z.playerReceivedTotal)}  KO +${ZENITH_KO_BONUS_M.toFixed(0)}m`, "#94a3b8"],
    [`population: ${z.bots.filter((b) => b.alive).length} bots`, "#94a3b8"],
  ]);

  let yy = y + 198;
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 18px Consolas";
  ctx.fillText("Leaderboard", x + 16, yy);
  yy += 26;
  ctx.font = "14px Consolas";
  for (const [i, row] of z.leaders(10).entries()) {
    ctx.fillStyle = row.player ? "#fbbf24" : "#cbd5e1";
    const name = row.name.padEnd(12, " ").slice(0, 12);
    ctx.fillText(`${String(i + 1).padStart(2, " ")} ${name} ${row.heightM.toFixed(1).padStart(6, " ")}m atk ${Math.round(row.attack)}`, x + 16, yy);
    yy += 20;
  }
  yy += 14;
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 18px Consolas";
  ctx.fillText("Feed", x + 16, yy);
  yy += 24;
  ctx.font = "13px Consolas";
  for (const item of z.feed.slice(0, 7)) {
    ctx.fillStyle =
      item.kind === "ko" ? "#fbbf24" :
      item.kind === "out" ? "#f87171" :
      item.kind === "danger" ? "#fb7185" :
      item.kind === "floor" ? "#38bdf8" :
      "#94a3b8";
    ctx.fillText(item.text.slice(0, 48), x + 16, yy);
    yy += 18;
  }
}


function render(): void {
  const now = performance.now();
  if (shouldSkipFullRender(now)) {
    requestAnimationFrame(render);
    return;
  }

  updateQuickPlayModSelectUi(trainer.mode);
  const playingText = `playing ${trainer.presence.online || "?"}`;
  presenceBadge.textContent = playingText;
  trainer.updateModeButton();
  resizeCanvasForDisplay();
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width;
  const cssH = rect.height;
  ctx.clearRect(0, 0, cssW, cssH);
  const layoutScale = canvasLayoutScale();
  const w = cssW / layoutScale;
  const h = cssH / layoutScale;
  ctx.save();
  if (layoutScale !== 1) ctx.scale(layoutScale, layoutScale);
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "bold 30px Consolas";
  ctx.fillText("TetraFlux Web FT5 Trainer", 26, 42);
  ctx.font = "16px Consolas";
  ctx.fillStyle = "#34d399";
  const leftName =
    trainer.mode === "ai_vs_ai" ? trainer.battleLeftName :
    trainer.mode === "lab" ? trainer.aiName :
    trainer.mode === "zenith" ? "You" :
    "Human";
  const rightName =
    trainer.mode === "ai_vs_ai" ? trainer.battleRightName :
    trainer.mode === "lab" ? "Garbage Lab" :
    trainer.mode === "zenith" ? "Tower" :
    "AI";
  const startState =
    (trainer.mode === "human_vs_ai" || trainer.mode === "ai_vs_ai" || trainer.mode === "lab") && !trainer.matchStarted
      ? "WAITING: press R"
      : trainer.modeLabel();
  const scoreText =
    trainer.mode === "zenith"
      ? `${trainer.zenith.playerHeightM.toFixed(1)}m  rank #${trainer.zenith.playerRank}/${trainer.zenith.activeCount()}`
      : trainer.mode === "lab"
        ? `bags ${trainer.labBagsInjected}  gray ${trainer.labGrayGarbage(now)}  red ${trainer.labReadyGarbage(now)}  entered ${trainer.labGarbageMaterialized}`
        : `${leftName} ${trainer.score.human} - ${trainer.score.ai} ${rightName}`;
  ctx.fillText(`${trainer.mode === "zenith" ? "Zenith" : `FT${trainer.firstTo}`}   ${scoreText}   |   ${startState}   |   ${playingText}`, 26, 70);
  ctx.fillStyle = trainer.roundOver ? "#fbbf24" : "#94a3b8";
  ctx.fillText(trainer.message, 26, 94);
  const boardY = 180;
  const cell = Math.max(15, Math.min(20, Math.floor((h - boardY - 120) / 20)));
  const invisibleActive =
    currentQuickPlayMod.invisible && usesQuickPlayMod(trainer.mode);
  const invisibleReveal = !invisibleActive || (Math.floor(now / 5000) % 2 === 0 && now % 5000 < 750);

  drawBoard(ctx, trainer.human, {
    x: 24,
    y: boardY,
    cell,
    title: leftName,
    showGhost: trainer.mode === "human_vs_ai" || trainer.mode === "zenith",
    active: true,
    invisibleLocked: invisibleActive,
    revealInvisible: invisibleReveal,
    holdDisabled: usesQuickPlayMod(trainer.mode) && currentQuickPlayMod.disableHold,
    garbageSegments: trainer.garbageSegmentsFor("human", now),
  });
  if (trainer.mode === "zenith") {
    drawZenithTower(ctx, trainer, 540, boardY, 500, Math.max(520, h - boardY - 18));
  } else if (trainer.mode === "lab") {
    drawPanel(ctx, 540, boardY, 500, 300, "Garbage Lab", [
      [`AI: ${trainer.aiName}`, "#e5e7eb"],
      [`garbage/bag: ${settings.labGarbagePerBag}`, "#94a3b8"],
      [`delay: ${(LAB_GARBAGE_DELAY_MS / 1000).toFixed(1)}s`, "#94a3b8"],
      [`bags survived: ${trainer.labBagsInjected}`, "#34d399"],
      [`incoming shown on left G meter`, "#fbbf24"],
      [`next ready: ${trainer.nextLabGarbageSeconds(now)}s`, "#94a3b8"],
      [`entered board: ${trainer.labGarbageMaterialized}`, "#94a3b8"],
      [`pieces: ${trainer.human.piecesLocked}`, "#94a3b8"],
      [`mod: ${currentQuickPlayMod.name}`, "#38bdf8"],
    ]);
  } else {
    drawBoard(ctx, trainer.aiEngine, {
      x: 540,
      y: boardY,
      cell,
      title: rightName,
      showGhost: false,
      active: true,
      invisibleLocked: invisibleActive,
      revealInvisible: invisibleReveal,
      holdDisabled: usesQuickPlayMod(trainer.mode) && currentQuickPlayMod.disableHold,
      garbageSegments: trainer.garbageSegmentsFor("ai", now),
    });
  }
  const panelX = 1068;
  const panelY = boardY;
  const panelW = Math.max(300, w - panelX - 26);
  const panelH = Math.max(420, h - panelY - 18);
  const lines: Array<[string, string?]> = [
    ["Mode", "#38bdf8"],
    [trainer.modeLabel()],
    isAiBattleScreen(trainer.mode) ? [`${trainer.battleLeftName} vs ${trainer.battleRightName}`, "#94a3b8"] :
      trainer.mode === "lab" ? [`${trainer.aiName} solo garbage lab`, "#94a3b8"] :
      trainer.mode === "zenith" ? [`height ${trainer.zenith.playerHeightM.toFixed(1)}m / ${zenithFloorAt(trainer.zenith.playerHeightM).floor.name}`, "#94a3b8"] :
      [`Human vs ${trainer.aiName}`, "#94a3b8"],
    isAiBattleScreen(trainer.mode) ? [`opponent: ${trainer.battleOpponentKind}`, "#64748b"] : ["", "#64748b"],
    isAiBattleScreen(trainer.mode) ? [`turns: ${trainer.stepIndex}/${AI_BATTLE_MAX_TURNS_PER_ROUND}`, "#94a3b8"] :
      trainer.mode === "zenith" ? [`alive: ${trainer.zenith.activeCount()}  nearby: ${trainer.zenith.nearbyCount()}`, "#94a3b8"] :
      ["", "#94a3b8"],
    isAiBattleScreen(trainer.mode) ? [`sent: ${trainer.battleAttack.left} - ${trainer.battleAttack.right}`, "#94a3b8"] :
      trainer.mode === "zenith" ? [`sent: ${Math.round(trainer.zenith.playerAttackTotal)}  cancel: ${Math.round(trainer.zenith.playerCanceledTotal)}  burst: ${trainer.zenith.incomingBurstCarry.toFixed(1)}`, "#94a3b8"] :
      ["", "#94a3b8"],
    isAiBattleScreen(trainer.mode) ? [`raw/cancel: ${trainer.battleRawAttack.left}/${trainer.battleCanceled.left} - ${trainer.battleRawAttack.right}/${trainer.battleCanceled.right}`, "#64748b"] :
      trainer.mode === "zenith" ? [`bots join at 0.0m; initial bots are prewarmed from 0.0m`, "#64748b"] :
      ["", "#94a3b8"],
    [""],
    usesQuickPlayMod(trainer.mode) ? ["Mod", "#38bdf8"] : ["", "#38bdf8"],
    usesQuickPlayMod(trainer.mode) ? [`${currentQuickPlayMod.name}`, "#94a3b8"] : ["", "#94a3b8"],
    usesQuickPlayMod(trainer.mode) ? [short(currentQuickPlayMod.description, 48), "#64748b"] : ["", "#64748b"],
    usesQuickPlayMod(trainer.mode) && currentQuickPlayMod.allSpin ? [`breaks: L${trainer.allSpinBreakRows.left} R${trainer.allSpinBreakRows.right}  streak ${trainer.allSpinClearStreak.left}/${trainer.allSpinClearStreak.right}`, "#fb7185"] : ["", "#64748b"],
    [""],
    ["AI", "#38bdf8"],
    ...trainer.aiDetails.slice(0, 5).map((line) => [line, "#94a3b8"] as [string, string]),
    [""],
    ["Value", "#38bdf8"],
    ...trainer.valueInfo.lines.slice(0, 4).map((line) => [line, trainer.valueInfo.loaded ? "#94a3b8" : "#64748b"] as [string, string]),
    [""],
    ["Upload", "#38bdf8"],
    [`${trainer.autoUploadStatus}`],
    [short(trainer.autoUploadDetail, 52), trainer.autoUploadStatus === "failed" ? "#f87171" : "#94a3b8"],
    [""],
    ["Keys", "#38bdf8"],
    [`${keysLabel(settings.keys.left)}/${keysLabel(settings.keys.right)} : move`],
    [`${keysLabel(settings.keys.softDrop)} : soft`],
    [`${keysLabel(settings.keys.rotateCcw)}/${keysLabel(settings.keys.rotateCw)}/${keysLabel(settings.keys.rotate180)} : rot`],
    [`${keysLabel(settings.keys.hold)} : hold`],
    [`${keysLabel(settings.keys.hardDrop)} : drop`],
    [""],
    [`Logs: ${isAiBattleScreen(trainer.mode) ? trainer.selfplayLogger.records.length + trainer.selfplayLogger.roundBuffer.length : trainer.logger.records.length + trainer.logger.roundBuffer.length}`, "#94a3b8"],
    [`ID: ${trainer.logger.anonymousPlayerId.slice(0, 8)}...`, "#94a3b8"]
  ];
  drawPanel(ctx, panelX, panelY, panelW, panelH, "Status", lines);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px Consolas";
  ctx.fillText(
    trainer.mode === "zenith"
      ? "Zenith Tower mock bots all join at 0.0m; initial population is pre-simulated from 0.0m."
      : isAiBattleScreen(trainer.mode)
        ? `AI Battle self-training auto-loops and uploads selfplay logs. Opponent: ${trainer.battleRightName}. Mod: ${currentQuickPlayMod.name}.`
        : trainer.mode === "lab"
          ? `Garbage Lab: every bag schedules ${settings.labGarbagePerBag} modded garbage; it enters after ${LAB_GARBAGE_DELAY_MS / 1000}s and the next lock.`
          : "AI Battle uploads to selfplay/ and is never mixed into human raw/ logs.",
    26,
    h - 18
  );
  ctx.restore();
  requestAnimationFrame(render);
}

let lastTs = performance.now();
function tick(ts: number): void {
  const dt = Math.min(100, ts - lastTs);
  lastTs = ts;
  trainer.update(dt, ts);
  requestAnimationFrame(tick);
}

bindSettingsUi();
applySettingsToDom();
window.addEventListener("keydown", (e) => trainer.handleKeyDown(e));
window.addEventListener("keyup", (e) => trainer.handleKeyUp(e));
window.addEventListener("blur", () => trainer.input.clearAllHeld());
newMatchBtn.addEventListener("click", () => trainer.resetMatch());
nextRoundBtn.addEventListener("click", () => trainer.nextRound());
toggleModeBtn.addEventListener("click", () => trainer.toggleMode());
downloadBtn.addEventListener("click", () => {
  if (trainer.mode === "zenith") {
    setStatus("Zenith mode does not record training logs.");
  } else if (isAiBattleScreen(trainer.mode)) {
    trainer.selfplayLogger.download();
    setStatus("Downloaded current selfplay log.");
  } else {
    trainer.logger.download();
    setStatus("Downloaded current match log.");
  }
});
copyBtn.addEventListener("click", async () => {
  if (trainer.mode === "zenith") {
    await navigator.clipboard.writeText(JSON.stringify({
      mode: "zenith",
      heightM: trainer.zenith.playerHeightM,
      rank: trainer.zenith.playerRank,
      alive: trainer.zenith.activeCount(),
      sent: trainer.zenith.playerAttackTotal,
      canceled: trainer.zenith.playerCanceledTotal,
      received: trainer.zenith.playerReceivedTotal,
    }, null, 2));
    setStatus("Copied Zenith summary to clipboard.");
    return;
  }

  const text = isAiBattleScreen(trainer.mode) ? trainer.selfplayLogger.toJsonl(true) : trainer.logger.toJsonl(true);
  await navigator.clipboard.writeText(text);
  setStatus(isAiBattleScreen(trainer.mode) ? "Copied selfplay logs to clipboard." : "Copied logs to clipboard.");
});
clearBtn.addEventListener("click", () => {
  trainer.logger.clearLocal();
  trainer.selfplayLogger.clearLocal();
  setStatus("Cleared local saved log copies. Current in-memory match remains.");
});
uploadBtn.addEventListener("click", async () => {
  try {
    if (trainer.mode === "zenith") {
      setStatus("Zenith mode does not upload training logs.");
      return;
    }

    if (isAiBattleScreen(trainer.mode)) {
      const text = trainer.selfplayLogger.toJsonl(true);
      if (!text.trim()) { setStatus("No selfplay logs to upload."); return; }
      const res = await uploadSelfplayLogs(text);
      setStatus(`Uploaded selfplay logs: ${res.slice(0, 120)}`);
      return;
    }

    const text = trainer.logger.toJsonl(true);
    if (!text.trim()) { setStatus("No logs to upload."); return; }
    const res = await uploadLogs(text);
    setStatus(`Uploaded logs: ${res.slice(0, 120)}`);
  } catch (err) { setStatus(err instanceof Error ? err.message : String(err)); }
});

loadAiModel();
loadValueModelInfo();
render();
requestAnimationFrame(tick);
