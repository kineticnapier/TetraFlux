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
type GameMode = "human_vs_ai" | "ai_vs_ai" | "zenith" | "self_train";
type AutoUploadStatus = "idle" | "uploading" | "uploaded" | "failed" | "skipped" | "selfplay" | "disabled";

interface AiLike { choose(engine: TetrisEngine): AiChoice | null; }

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
  aiPps: number; dasMs: number; arrMs: number; sdfCellsPerSecond: number;
  gravityCellsPerSecond: number; lockDelayMs: number; keys: KeyBindings;
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
  repeatedActionWound?: number;
  cancelDoesNotClimb?: boolean;
}

// Exact requested mod set from QUICK PLAY / Zenith Tower.
// Effects are mapped to TetraFlux's simplified Zenith/self-training systems.
const QUICK_PLAY_MODS: QuickPlayMod[] = [
  {
    id: "none",
    name: "No Mod",
    description: "Normal Zenith/self-training rules.",
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
    description: "Non-T Spins are upgraded to full Spins. Repeating the same action causes Wounds.",
    allSpin: true,
    attackMultiplier: 1.0,
    repeatedActionWound: 4,
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

const quickPlayModSelect = document.createElement("select");
quickPlayModSelect.id = "quickPlayMod";
quickPlayModSelect.title = "Quick Play / Zenith mod";
for (const mod of QUICK_PLAY_MODS) {
  const option = document.createElement("option");
  option.value = mod.id;
  option.textContent = `Mod: ${mod.name}`;
  quickPlayModSelect.appendChild(option);
}
toolbar.appendChild(quickPlayModSelect);
quickPlayModSelect.addEventListener("change", () => {
  currentQuickPlayMod = quickPlayModById(quickPlayModSelect.value);
  trainer?.applyCurrentModToEngines?.();
  setStatus(`Mod selected: ${currentQuickPlayMod.name} - ${currentQuickPlayMod.description}`);
});

const DEFAULT_SETTINGS: GameSettings = {
  aiPps: 1.4, dasMs: 130, arrMs: 10, sdfCellsPerSecond: 30,
  gravityCellsPerSecond: 1, lockDelayMs: 500,
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

// Upper bound for simulation speed.
// Rendering is already throttled separately, so high values mainly affect
// how many AI placements are processed per animation frame.
const MAX_AI_PPS = 1000;

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

const settingsModal = document.querySelector<HTMLDivElement>("#settingsModal")!;
const closeSettingsBtn = document.querySelector<HTMLButtonElement>("#closeSettings")!;
const saveSettingsBtn = document.querySelector<HTMLButtonElement>("#saveSettings")!;
const resetSettingsBtn = document.querySelector<HTMLButtonElement>("#resetSettings")!;

const aiPpsInput = document.querySelector<HTMLInputElement>("#aiPps")!;
const dasInput = document.querySelector<HTMLInputElement>("#dasMs")!;
const arrInput = document.querySelector<HTMLInputElement>("#arrMs")!;
const sdfInput = document.querySelector<HTMLInputElement>("#sdf")!;
const gravityInput = document.querySelector<HTMLInputElement>("#gravity")!;
const lockDelayInput = document.querySelector<HTMLInputElement>("#lockDelayMs")!;

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
    const dk = DEFAULT_SETTINGS.keys;
    const pk = (parsed.keys ?? {}) as Partial<Record<keyof KeyBindings, unknown>>;
    return {
      ...cloneSettings(DEFAULT_SETTINGS), ...parsed,
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
  aiPpsInput.value = String(settings.aiPps);
  dasInput.value = String(settings.dasMs);
  arrInput.value = String(settings.arrMs);
  sdfInput.value = String(settings.sdfCellsPerSecond);
  gravityInput.value = String(settings.gravityCellsPerSecond);
  lockDelayInput.value = String(settings.lockDelayMs);
  for (const [k, input] of Object.entries(keyInputs) as Array<[keyof KeyBindings, HTMLInputElement]>) input.value = keysLabel(settings.keys[k]);
}

function readSettingsFromDom(): void {
  settings.aiPps = Math.max(0.1, Math.min(MAX_AI_PPS, numInput(aiPpsInput, DEFAULT_SETTINGS.aiPps)));
  settings.dasMs = Math.max(0, Math.min(500, numInput(dasInput, DEFAULT_SETTINGS.dasMs)));
  settings.arrMs = Math.max(0, Math.min(200, numInput(arrInput, DEFAULT_SETTINGS.arrMs)));
  settings.sdfCellsPerSecond = Math.max(1, Math.min(240, numInput(sdfInput, DEFAULT_SETTINGS.sdfCellsPerSecond)));
  settings.gravityCellsPerSecond = Math.max(0, Math.min(60, numInput(gravityInput, DEFAULT_SETTINGS.gravityCellsPerSecond)));
  settings.lockDelayMs = Math.max(0, Math.min(3000, numInput(lockDelayInput, DEFAULT_SETTINGS.lockDelayMs)));
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
  if (sent > 0) receiver.queueGarbage(sent);

  return { rawAttack, canceled, sent };
}


function applyRemainingGarbageAfterCounter(engine: TetrisEngine, result: { rawAttack: number; linesCleared: number }): void {
  if (result.rawAttack <= 0 && result.linesCleared <= 0) engine.applyPendingGarbage();
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

  logger = new MatchLogger();
  selfplayLogger = new SelfplayLogger();
  zenith = new ZenithTowerSim(seedNow());
  zenithIncomingCarry = 0;
  selfTrainingMatches = 0;
  input!: MovementInput;
  aiAccumulatorMs = 0;
  battleLeftAccumulatorMs = 0;
  battleRightAccumulatorMs = 0;
  battleAttack = { left: 0, right: 0 };
  battleRawAttack = { left: 0, right: 0 };
  battleCanceled = { left: 0, right: 0 };
  private allSpinLastAction = { player: "", left: "", right: "" };
  allSpinWounds = { player: 0, left: 0, right: 0 };

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
    this.battleLeftAi = ai;
    this.battleLeftName = name;
    this.battleRightAi = new HeuristicAI();
    this.battleRightName = "HeuristicAI";
    setStatus(`AI loaded: ${name}`);
  }

  setValueInfo(info: ValueModelInfo): void {
    this.valueInfo = info;
  }

  setMode(mode: GameMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.resetMatch();
  }

  toggleMode(): void {
    const next: GameMode =
      this.mode === "human_vs_ai" ? "ai_vs_ai" :
      this.mode === "ai_vs_ai" ? "self_train" :
      this.mode === "self_train" ? "zenith" :
      "human_vs_ai";
    this.setMode(next);
  }

  modeLabel(): string {
    if (this.mode === "human_vs_ai") return "Human vs AI";
    if (this.mode === "ai_vs_ai") return "AI Battle";
    if (this.mode === "self_train") return "Self Training";
    return "Zenith Tower";
  }
  updateModeButton(): void { toggleModeBtn.textContent = `Mode: ${this.modeLabel()}`; }

  inputSettings() { return { dasMs: settings.dasMs, arrMs: settings.arrMs, sdfCellsPerSecond: settings.sdfCellsPerSecond }; }

  applyCurrentModToEngines(): void {
    const options = currentGarbageOptions();
    this.human?.setGarbageOptions?.(options);
    this.aiEngine?.setGarbageOptions?.(options);
    this.zenith?.setMod?.(currentQuickPlayMod);
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
      if ((this.mode === "ai_vs_ai" || this.mode === "self_train") && this.roundOver && !this.matchOver) {
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
    this.matchStarted = this.mode === "ai_vs_ai" || this.mode === "self_train";
    this.clearAiBattleAutoNext();
    this.logger = new MatchLogger();
    this.selfplayLogger = new SelfplayLogger();
    this.presence?.stop();
    this.presence = new PresenceClient(this.logger.anonymousPlayerId);
    this.presence.start();
    this.autoUploadStatus = "idle";
    this.autoUploadDetail =
      this.mode === "human_vs_ai" ? "human logs upload to raw/" :
      (this.mode === "ai_vs_ai" || this.mode === "self_train") ? "selfplay upload to selfplay/" :
      "Zenith mode does not upload logs";
    this.autoUploadInFlight = false;
    this.autoUploadedMatchId = null;
    this.resetRound();
    this.updateModeButton();
    setStatus(
      this.mode === "human_vs_ai" ? "Press R to start Human vs AI FT15." :
      this.mode === "ai_vs_ai" ? "New AI Battle FT15 started." :
      this.mode === "self_train" ? "Self Training started. It will auto-loop and upload selfplay logs." :
      "Press R to start Zenith Tower."
    );
  }

  startPlayableMatch(): void {
    if (this.mode !== "human_vs_ai" && this.mode !== "zenith") {
      this.resetMatch();
      return;
    }

    this.resetMatch();
    this.matchStarted = true;
    this.resetRound();
    setStatus(this.mode === "zenith" ? "Zenith Tower started." : "Human vs AI FT15 started.");
  }

  resetRound(): void {
    const seed = (this.baseSeed + this.roundIndex * 1009) >>> 0;
    this.human = new TetrisEngine(seed, seed + 17);
    this.aiEngine = new TetrisEngine(seed, seed + 31);
    this.input = new MovementInput(this.human, () => this.inputSettings());
    this.aiAccumulatorMs = 0;
    this.battleLeftAccumulatorMs = 0;
    this.battleRightAccumulatorMs = 0;
    this.humanGravityCarry = 0;
    this.humanGroundedSince = null;
    this.zenithIncomingCarry = 0;
    if (this.mode === "zenith") this.zenith.reset(performance.now(), currentQuickPlayMod);
    this.roundOver = false;
    this.roundWinner = null;
    this.stepIndex = 0;
    this.lastRoundLimitReason = "";
    this.battleAttack = { left: 0, right: 0 };
    this.battleRawAttack = { left: 0, right: 0 };
    this.battleCanceled = { left: 0, right: 0 };
    this.allSpinLastAction = { player: "", left: "", right: "" };
    this.allSpinWounds = { player: 0, left: 0, right: 0 };
    this.applyCurrentModToEngines();
    this.message =
      this.mode === "human_vs_ai"
        ? (this.matchStarted ? `Round ${this.roundIndex + 1}: play against AI.` : "Press R to start Human vs AI.")
        : (this.mode === "ai_vs_ai" || this.mode === "self_train")
          ? `Round ${this.roundIndex + 1}: ${this.battleLeftName} vs ${this.battleRightName}. Mod: ${currentQuickPlayMod.name}.`
          : (this.matchStarted ? `Climb Zenith Tower. Mod: ${currentQuickPlayMod.name}. New climbers always start at 0.0m.` : "Press R to start Zenith Tower.");
  }

  finishRound(winner: Winner): void {
    if (this.roundOver) return;
    this.roundOver = true;
    this.roundWinner = winner;
    this.score[winner] += 1;

    const willMatchEnd = this.score.human >= this.firstTo || this.score.ai >= this.firstTo;

    if (this.mode === "human_vs_ai") {
      this.logger.finishRound(winner, this.score);
    } else if (this.mode === "ai_vs_ai" || this.mode === "self_train") {
      const sideWinner: BattleSide = winner === "human" ? "left" : "right";
      const matchWinner = willMatchEnd ? sideWinner : null;
      this.selfplayLogger.finishRound(sideWinner, { left: this.score.human, right: this.score.ai }, matchWinner);
    }

    if (willMatchEnd) {
      this.matchOver = true;
      if (this.mode === "ai_vs_ai" || this.mode === "self_train") {
        const limitNote = this.lastRoundLimitReason ? ` Last round: ${this.lastRoundLimitReason}.` : "";
        this.message = `AI Battle over: ${this.winnerDisplay(winner)} wins FT${this.firstTo}.${limitNote} Uploading selfplay logs...`;
        this.autoUploadSelfplayMatch();
      } else {
        this.message = `Match over: ${winner} wins FT${this.firstTo}. Auto-uploading logs...`;
        this.autoUploadHumanMatch();
      }
    } else {
      if (this.mode === "ai_vs_ai" || this.mode === "self_train") {
        this.scheduleAiBattleAutoNext();
        const limitNote = this.lastRoundLimitReason ? ` (${this.lastRoundLimitReason})` : "";
        this.message = `Round winner: ${this.winnerDisplay(winner)}${limitNote}. Auto next round...`;
      } else {
        this.message = `Round winner: ${this.winnerDisplay(winner)}. Press ${keysLabel(settings.keys.nextRound)} or Next Round.`;
      }
    }
  }

  winnerDisplay(winner: Winner): string {
    if (this.mode === "ai_vs_ai" || this.mode === "self_train") return winner === "human" ? this.battleLeftName : this.battleRightName;
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
      if (this.mode === "self_train" && label === "selfplay") {
        this.selfTrainingMatches++;
        window.setTimeout(() => {
          if (this.mode === "self_train") this.resetMatch();
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
    if ((this.mode !== "human_vs_ai" && this.mode !== "zenith") || this.roundOver || this.matchOver || this.human.dead || !this.matchStarted) return;
    const gravity =
      Math.max(0, settings.gravityCellsPerSecond) *
      (this.mode === "zenith" ? (currentQuickPlayMod.gravityMultiplier ?? 1) : 1);
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
    this.applyAllSpinRepeatPenalty(this.human, "player", effectiveResult);
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
      applyAttack(this.human, this.aiEngine, effectiveResult.attackSent);
      applyRemainingGarbageAfterCounter(this.human, effectiveResult);
      if (this.human.dead || effectiveResult.topout) { this.finishRound("ai"); return; }
    }
    this.input.resetRepeatAfterPieceChange(now);
  }

  private humanLockCurrent(now: number): void {
    if (this.roundOver || this.matchOver || this.human.dead || (this.mode !== "human_vs_ai" && this.mode !== "zenith")) return;
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
    if (this.roundOver || this.matchOver || this.human.dead || (this.mode !== "human_vs_ai" && this.mode !== "zenith")) return;
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

  private allSpinActionKey(result: LockResult, action?: PlacementAction): string {
    const piece = result.piece ?? action?.piece ?? "?";
    const spin = result.spin === "none" ? "normal" : result.spin;
    const lines = result.linesCleared;
    const rot = result.rot ?? action?.rot ?? 0;
    const hold = action?.hold ? "H" : "-";
    // Same clear/action twice is punished. Include piece for All-Spin so
    // TSS -> ZSS is allowed, while Double -> Double with same piece/rot tends
    // to wound.
    return `${piece}:${spin}:${lines}L:${rot}:${hold}`;
  }

  private allSpinFullAttack(lines: number): number {
    if (lines <= 0) return 0;
    if (lines === 1) return 2;
    if (lines === 2) return 4;
    if (lines === 3) return 6;
    return 8;
  }

  private applyQuickPlayModToResult(result: LockResult, action?: PlacementAction): LockResult {
    if (this.mode !== "self_train" && this.mode !== "zenith") return result;

    let attackSent = result.attackSent;
    let rawAttack = result.rawAttack;
    let spin = result.spin;

    if (currentQuickPlayMod.allSpin && result.spin === "spin" && result.piece !== "T") {
      // Upgrade non-T Spins to full Spin attack values.
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

    return {
      ...result,
      attackSent,
      rawAttack,
      spin,
    };
  }

  private applyQuickPlayModToAction(action: PlacementAction): PlacementAction {
    if ((this.mode === "self_train" || this.mode === "zenith") && currentQuickPlayMod.disableHold && action.hold) {
      return { ...action, hold: false, key: action.key.replace(/^H:/, "") };
    }
    return action;
  }

  private applyAllSpinRepeatPenalty(engine: TetrisEngine, slot: "player" | "left" | "right", result: LockResult, action?: PlacementAction): void {
    if (!currentQuickPlayMod.allSpin) return;

    const key = this.allSpinActionKey(result, action);
    if (this.allSpinLastAction[slot] === key) {
      const wound = Math.max(1, currentQuickPlayMod.repeatedActionWound ?? 4);
      engine.queueGarbage(wound);
      this.allSpinWounds[slot] += wound;
      if (slot === "player") setStatus(`All-Spin Wound: repeated ${key}, +${wound} garbage.`);
    }

    this.allSpinLastAction[slot] = key;
  }

  private aiAction(engine: TetrisEngine, opponent: TetrisEngine, ai: AiLike, side?: BattleSide): boolean {
    if (this.roundOver || this.matchOver || engine.dead) return false;

    const stateBefore = engine.stateDict();
    const opponentBefore = opponent.stateDict();

    const chosenAction = ai.choose(engine);
    if (!chosenAction) return false;

    const action = this.applyQuickPlayModToAction(chosenAction);
    const slot: "left" | "right" = side === "right" ? "right" : "left";
    const result = this.applyQuickPlayModToResult(engine.applyAction(action), action);
    this.applyAllSpinRepeatPenalty(engine, slot, result, action);
    const attackApplied = applyAttack(engine, opponent, result.attackSent);
    applyRemainingGarbageAfterCounter(engine, result);

    if ((this.mode === "ai_vs_ai" || this.mode === "self_train") && side) {
      this.battleAttack[side] += attackApplied.sent;
      this.battleRawAttack[side] += attackApplied.rawAttack;
      this.battleCanceled[side] += attackApplied.canceled;
    }

    const stateAfter = engine.stateDict();
    const opponentAfter = opponent.stateDict();

    if ((this.mode === "ai_vs_ai" || this.mode === "self_train") && side) {
      this.selfplayLogger.logMove({
        leftAiName: this.battleLeftName,
        rightAiName: this.battleRightName,
        side,
        roundIndex: this.roundIndex,
        stepIndex: this.stepIndex,
        state: stateBefore,
        opponentState: opponentBefore,
        action,
        result,
        stateAfter,
        opponentStateAfter: opponentAfter,
      });
    }

    this.stepIndex++;
    return !(engine.dead || result.topout);
  }

  aiTurn(): void {
    if (this.mode !== "human_vs_ai" || this.roundOver || this.matchOver || this.aiEngine.dead) return;
    const alive = this.aiAction(this.aiEngine, this.human, this.ai);
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
    if ((this.mode !== "ai_vs_ai" && this.mode !== "self_train") || this.roundOver || this.matchOver) return;
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
    if ((this.mode !== "ai_vs_ai" && this.mode !== "self_train") || this.roundOver || this.matchOver) return;
    if (side === "left") {
      const alive = this.aiAction(this.human, this.aiEngine, this.battleLeftAi, "left");
      if (!alive) { this.finishRound("ai"); return; }
      if (this.aiEngine.dead) { this.finishRound("human"); return; }
      this.finishAiBattleByLimit();
    } else {
      const alive = this.aiAction(this.aiEngine, this.human, this.battleRightAi, "right");
      if (!alive) { this.finishRound("human"); return; }
      if (this.human.dead) { this.finishRound("ai"); return; }
      this.finishAiBattleByLimit();
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
    if ((this.mode === "ai_vs_ai" || this.mode === "self_train") && this.roundOver && !this.matchOver && this.aiBattleAutoNextAt !== null && now >= this.aiBattleAutoNextAt) {
      this.nextRound();
    }

    if (this.roundOver || this.matchOver) return;
    if (this.mode === "zenith") {
      this.updateZenith(dtMs, now);
      return;
    }
    if (this.mode === "human_vs_ai" && !this.matchStarted) return;

    const pps = Math.max(0.1, Math.min(MAX_AI_PPS, settings.aiPps));
    const interval = 1000 / pps;

    // The old fixed guard=5 capped real processing speed to roughly
    // 5 actions/frame/side, so high PPS values barely mattered.
    // Scale the per-frame simulation budget with PPS.
    const maxAiActionsPerFrame = Math.max(5, Math.min(200, Math.ceil(pps / 12)));
    if (this.mode === "human_vs_ai") {
      this.input.update(now);
      this.updateHumanGravity(dtMs, now);
      this.aiAccumulatorMs += dtMs;
      let guard = 0;
      while (this.aiAccumulatorMs >= interval && guard < maxAiActionsPerFrame && !this.roundOver && !this.matchOver) {
        this.aiTurn(); this.aiAccumulatorMs -= interval; guard++;
      }
    } else if (this.mode === "ai_vs_ai" || this.mode === "self_train") {
      this.battleLeftAccumulatorMs += dtMs;
      this.battleRightAccumulatorMs += dtMs;
      let guard = 0;
      while (this.battleLeftAccumulatorMs >= interval && guard < maxAiActionsPerFrame && !this.roundOver && !this.matchOver) {
        this.battleTurn("left"); this.battleLeftAccumulatorMs -= interval; guard++;
      }
      guard = 0;
      while (this.battleRightAccumulatorMs >= interval && guard < maxAiActionsPerFrame && !this.roundOver && !this.matchOver) {
        this.battleTurn("right"); this.battleRightAccumulatorMs -= interval; guard++;
      }
    }
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (!settingsModal.classList.contains("hidden")) return;
    if (gameKeys().has(e.key)) e.preventDefault();
    if (isBound(e, settings.keys.reset)) {
      if (this.mode === "human_vs_ai" || this.mode === "zenith") this.startPlayableMatch();
      else this.resetMatch();
      return;
    }
    if (this.roundOver) { if (isBound(e, settings.keys.nextRound)) this.nextRound(); return; }
    if (this.matchOver || (this.mode !== "human_vs_ai" && this.mode !== "zenith") || !this.matchStarted) return;
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
      if (this.mode === "zenith" && currentQuickPlayMod.disableHold) {
        setStatus("Hold is disabled by current mod.");
        return;
      }

      const beforeKind = this.human.active.kind;
      const beforeHold = this.human.hold;
      const ok = this.human.holdPiece();
      if (ok && (this.human.active.kind !== beforeKind || this.human.hold !== beforeHold)) {
        this.input.resetRepeatAfterPieceChange(now); this.resetHumanGroundTimer();
      }
    } else if (isBound(e, settings.keys.hardDrop)) this.humanHardDrop();
  }

  handleKeyUp(e: KeyboardEvent): void {
    if (this.mode !== "human_vs_ai" && this.mode !== "zenith") return;
    let logical: LogicalMoveKey | null = null;
    if (isBound(e, settings.keys.left)) logical = "left";
    else if (isBound(e, settings.keys.right)) logical = "right";
    else if (isBound(e, settings.keys.softDrop)) logical = "down";
    if (logical) this.input.keyUp(logical, performance.now());
  }
}

const trainer = new Ft5Trainer();

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
  if ((trainer.mode !== "ai_vs_ai" && trainer.mode !== "self_train") || settings.aiPps <= 15 || trainer.roundOver || trainer.matchOver) {
    lastFullRenderAt = now;
    lastFullRenderStep = trainer.stepIndex;
    return false;
  }

  const stepDelta = trainer.stepIndex - lastFullRenderStep;
  const minStepDelta = settings.aiPps >= 200 ? 80 : settings.aiPps >= 100 ? 40 : settings.aiPps >= 50 ? 20 : settings.aiPps >= 19 ? 8 : 4;
  const maxSilentMs = settings.aiPps >= 100 ? 350 : 220;

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

  const playingText = `playing ${trainer.presence.online || "?"}`;
  presenceBadge.textContent = playingText;
  trainer.updateModeButton();
  resizeCanvasForDisplay();
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#070b14";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "bold 30px Consolas";
  ctx.fillText("TetraFlux Web FT5 Trainer", 26, 42);
  ctx.font = "16px Consolas";
  ctx.fillStyle = "#34d399";
  const leftName =
    (trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") ? trainer.battleLeftName :
    trainer.mode === "zenith" ? "You" :
    "Human";
  const rightName =
    (trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") ? trainer.battleRightName :
    trainer.mode === "zenith" ? "Tower" :
    "AI";
  const startState =
    (trainer.mode === "human_vs_ai" || trainer.mode === "zenith") && !trainer.matchStarted
      ? "WAITING: press R"
      : trainer.modeLabel();
  const scoreText =
    trainer.mode === "zenith"
      ? `${trainer.zenith.playerHeightM.toFixed(1)}m  rank #${trainer.zenith.playerRank}/${trainer.zenith.activeCount()}`
      : `${leftName} ${trainer.score.human} - ${trainer.score.ai} ${rightName}`;
  ctx.fillText(`${trainer.mode === "zenith" ? "Zenith" : `FT${trainer.firstTo}`}   ${scoreText}   |   ${startState}   |   ${playingText}`, 26, 70);
  ctx.fillStyle = trainer.roundOver ? "#fbbf24" : "#94a3b8";
  ctx.fillText(trainer.message, 26, 94);
  const boardY = 180;
  const cell = Math.max(15, Math.min(20, Math.floor((h - boardY - 120) / 20)));
  const invisibleActive =
    currentQuickPlayMod.invisible && (trainer.mode === "zenith" || trainer.mode === "self_train");
  const invisibleReveal = !invisibleActive || (Math.floor(now / 5000) % 2 === 0 && now % 5000 < 750);

  drawBoard(ctx, trainer.human, {
    x: 24,
    y: boardY,
    cell,
    title: leftName,
    showGhost: trainer.mode === "human_vs_ai" || trainer.mode === "zenith",
    active: true,
    invisibleLocked: invisibleActive,
    revealInvisible,
  });
  if (trainer.mode === "zenith") {
    drawZenithTower(ctx, trainer, 540, boardY, 500, Math.max(520, h - boardY - 18));
  } else {
    drawBoard(ctx, trainer.aiEngine, {
      x: 540,
      y: boardY,
      cell,
      title: rightName,
      showGhost: false,
      active: true,
      invisibleLocked: invisibleActive,
      revealInvisible,
    });
  }
  const panelX = 1068;
  const panelY = boardY;
  const panelW = Math.max(300, w - panelX - 26);
  const panelH = Math.max(420, h - panelY - 18);
  const lines: Array<[string, string?]> = [
    ["Mode", "#38bdf8"],
    [trainer.modeLabel()],
    (trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") ? [`${trainer.battleLeftName} vs ${trainer.battleRightName}`, "#94a3b8"] :
      trainer.mode === "zenith" ? [`height ${trainer.zenith.playerHeightM.toFixed(1)}m / ${zenithFloorAt(trainer.zenith.playerHeightM).floor.name}`, "#94a3b8"] :
      [`Human vs ${trainer.aiName}`, "#94a3b8"],
    (trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") ? [`turns: ${trainer.stepIndex}/${AI_BATTLE_MAX_TURNS_PER_ROUND}`, "#94a3b8"] :
      trainer.mode === "zenith" ? [`alive: ${trainer.zenith.activeCount()}  nearby: ${trainer.zenith.nearbyCount()}`, "#94a3b8"] :
      ["", "#94a3b8"],
    (trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") ? [`sent: ${trainer.battleAttack.left} - ${trainer.battleAttack.right}`, "#94a3b8"] :
      trainer.mode === "zenith" ? [`sent: ${Math.round(trainer.zenith.playerAttackTotal)}  cancel: ${Math.round(trainer.zenith.playerCanceledTotal)}  burst: ${trainer.zenith.incomingBurstCarry.toFixed(1)}`, "#94a3b8"] :
      ["", "#94a3b8"],
    (trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") ? [`raw/cancel: ${trainer.battleRawAttack.left}/${trainer.battleCanceled.left} - ${trainer.battleRawAttack.right}/${trainer.battleCanceled.right}`, "#64748b"] :
      trainer.mode === "zenith" ? [`bots join at 0.0m; initial bots are prewarmed from 0.0m`, "#64748b"] :
      ["", "#94a3b8"],
    [""],
    ["Mod", "#38bdf8"],
    [`${currentQuickPlayMod.name}`, "#94a3b8"],
    [short(currentQuickPlayMod.description, 48), "#64748b"],
    currentQuickPlayMod.allSpin ? [`wounds: P${trainer.allSpinWounds.player} L${trainer.allSpinWounds.left} R${trainer.allSpinWounds.right}`, "#fb7185"] : ["", "#64748b"],
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
    [`Logs: ${(trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") ? trainer.selfplayLogger.records.length + trainer.selfplayLogger.roundBuffer.length : trainer.logger.records.length + trainer.logger.roundBuffer.length}`, "#94a3b8"],
    [`ID: ${trainer.logger.anonymousPlayerId.slice(0, 8)}...`, "#94a3b8"]
  ];
  drawPanel(ctx, panelX, panelY, panelW, panelH, "Status", lines);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px Consolas";
  ctx.fillText(
    trainer.mode === "zenith"
      ? "Zenith Tower mock bots all join at 0.0m; initial population is pre-simulated from 0.0m."
      : trainer.mode === "self_train"
        ? `Self Training auto-loops and uploads selfplay logs. Mod: ${currentQuickPlayMod.name}.`
        : "AI Battle uploads to selfplay/ and is never mixed into human raw/ logs.",
    26,
    h - 18
  );
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
  } else if (trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") {
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

  const text = (trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") ? trainer.selfplayLogger.toJsonl(true) : trainer.logger.toJsonl(true);
  await navigator.clipboard.writeText(text);
  setStatus((trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") ? "Copied selfplay logs to clipboard." : "Copied logs to clipboard.");
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

    if (trainer.mode === "ai_vs_ai" || trainer.mode === "self_train") {
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
