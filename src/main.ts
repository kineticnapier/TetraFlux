import "./style.css";
import { HeuristicAI } from "./ai/heuristic";
import { LookaheadAI } from "./ai/lookahead";
import type { AiChoice } from "./ai/heuristic";
import { WebPolicyAI } from "./ai/webPolicy";
import { estimateSpinPotential } from "./ai/spinPotential";
import { boardMetrics, TetrisEngine, type Cell, type LockResult, type PieceKind, type PlacementAction, type PieceState } from "./engine/tetris";
import { MovementInput, type LogicalMoveKey } from "./input";
import { MatchLogger, SelfplayLogger, type BattleSide, uploadLogs, uploadSelfplayLogs } from "./logging";
import { PresenceClient } from "./presence";
import { drawBoard, drawPanel } from "./render";

type Winner = "human" | "ai";
type GameMode = "human_vs_ai" | "ai_vs_ai" | "lab" | "zenith";
type AutoUploadStatus = "idle" | "uploading" | "uploaded" | "failed" | "skipped" | "selfplay" | "disabled";

interface AiLike { choose(engine: TetrisEngine): AiChoice | null; }

type AiMoveOp = "hold" | "left" | "right" | "cw" | "ccw" | "180" | "soft";

interface AiMoveExecution {
  result: LockResult;
  ops: AiMoveOp[];
  reachedTarget: boolean;
  engineAfter: TetrisEngine;
}

interface PendingAiAction {
  stateBefore: ReturnType<TetrisEngine["stateDict"]>;
  opponentBefore: ReturnType<TetrisEngine["stateDict"]>;
  plannedAction: PlacementAction;
  ops: AiMoveOp[];
  opIndex: number;
  routeFailed: boolean;
  spinFinisherPlanned?: boolean;
  side?: BattleSide;
}

interface SpinFinisher {
  action: PlacementAction;
  ops: AiMoveOp[];
  expectedSpinKind: "tspin" | "tspin-mini" | "spin";
  expectedClearLines: number;
  targetX: number;
  targetY: number;
  targetRot: number;
  source: "spin_finisher";
  kindLabel: string;
}

interface TimedIncomingGarbage {
  amount: number;
  receivedAtMs: number;
  readyAtMs: number;
}

type EngineSlot = "human" | "ai";

interface GridCell {
  x: number;
  y: number;
}

interface LastStandIndicator {
  current: GridCell;
  next: GridCell;
  receivedSinceMove: number;
}

interface SpinPlanTarget {
  kind: "TSD" | "TST" | "STSD" | "TSlot";
  cx: number;
  cy: number;
  rot: number;
  requiredCells: GridCell[];
  forbiddenCells: GridCell[];
  slotCells: GridCell[];
  missingRequired: number;
  alreadyComplete: boolean;
}

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
  { kind: "heuristic", name: "Heuristic", make: () => new LookaheadAI({ depth: 2, beamWidth: 50, includeHold: true, spinBias: 0.8, maxCandidatesPerNode: 24, maxNodesPerDepth: 220, timeBudgetMs: 7.5 }) },
  { kind: "aggressive", name: "Aggressive", make: () => new WeightedHeuristicAI("Aggressive", { attackBonus: 5.2, lineBonus: 4.8, holeWeight: 6.4, heightWeight: 0.62, bumpWeight: 0.28, wellWeight: 0.08, holdPenalty: 0.02 }) },
  { kind: "defensive", name: "Defensive", make: () => new WeightedHeuristicAI("Defensive", { holeWeight: 13.0, heightWeight: 1.35, bumpWeight: 0.72, wellWeight: 0.28, lineBonus: 2.8, attackBonus: 0.9, holdPenalty: 0.03 }) },
  { kind: "downstacker", name: "Downstacker", make: () => new WeightedHeuristicAI("Downstacker", { holeWeight: 11.2, heightWeight: 1.05, bumpWeight: 0.45, wellWeight: 0.04, lineBonus: 5.0, attackBonus: 1.15, holdPenalty: 0.01 }) },
  { kind: "combo", name: "Combo", make: () => new WeightedHeuristicAI("Combo", { holeWeight: 7.2, heightWeight: 0.72, bumpWeight: 0.18, wellWeight: -0.12, lineBonus: 5.8, attackBonus: 1.65, holdPenalty: 0.02 }) },
  { kind: "spin", name: "Spin", make: () => { const ai = new LookaheadAI({ depth: 1, beamWidth: 24, includeHold: true, spinBias: 1.2, maxCandidatesPerNode: 16, maxNodesPerDepth: 120, timeBudgetMs: 2.8 }); Object.assign(ai, { holeWeight: 10.1, heightWeight: 0.88, maxHeightWeight: 2.35, bumpWeight: 0.55, wellWeight: 0.04, lineBonus: 3.7, attackBonus: 4.7, spinPotentialBonus: 2.95, holdPenalty: 0.01 }); return ai; } },
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

type SpecialModId =
  | "none"
  | "asceticism"
  | "loaded_dice"
  | "freefall"
  | "last_stand"
  | "damnation"
  | "the_exile"
  | "the_warlock";

interface SpecialMod {
  id: SpecialModId;
  name: string;
  description: string;
  disableHold?: boolean;
  nextVisibleCount?: number;
  randomSequence?: boolean;
  instantGround?: boolean;
  permanentInvisible?: boolean;
  visibleGarbageRows?: number;
  topCutRows?: number;
  attackMultiplier?: number;
  incomingMultiplier?: number;
  garbageScatterChance?: number;
  doubleHoleChance?: number;
  garbageHoleWidth?: number;
  largeHoleCount?: number;
  largeHoleExtraChance?: number;
  startBoard?: "loaded_dice" | "damnation";
  startGarbageRows?: number;
  lineClearStunMs?: number;
  warlock?: boolean;
  allSpin?: boolean;
  disableAllSpin?: boolean;
}

const SPECIAL_MODS: SpecialMod[] = [
  { id: "none", name: "No Special", description: "No special challenge mod." },
  {
    id: "asceticism",
    name: "Asceticism",
    description: "NEXT is limited to 1, piece sequence is fully random, hold is banned, and garbage holes are width 2.",
    nextVisibleCount: 1,
    randomSequence: true,
    disableHold: true,
    garbageHoleWidth: 2,
  },
  {
    id: "loaded_dice",
    name: "Loaded Dice",
    description: "Starts from a dice-like board, garbage is very scattered, and line clears cause 1.15s stun.",
    startBoard: "loaded_dice",
    garbageScatterChance: 0.96,
    lineClearStunMs: 1150,
  },
  { id: "freefall", name: "Freefall", description: "Gravity is effectively instant.", instantGround: true },
  {
    id: "last_stand",
    name: "Last Stand",
    description: "Board height is reduced by 6, received attacks are tripled, and garbage holes are straight.",
    topCutRows: 6,
    incomingMultiplier: 3,
    garbageScatterChance: 0,
  },
  {
    id: "damnation",
    name: "Damnation",
    description: "Starts from a checkerboard, garbage has 6-7 holes, and All-Spins are disabled.",
    startBoard: "damnation",
    disableAllSpin: true,
    largeHoleCount: 6,
    largeHoleExtraChance: 0.5,
  },
  {
    id: "the_exile",
    name: "The Exile",
    description: "Placed pieces are permanently invisible, only top 3 garbage rows are visible, and you start with 3 garbage rows.",
    permanentInvisible: true,
    visibleGarbageRows: 3,
    startGarbageRows: 3,
  },
  {
    id: "the_warlock",
    name: "The Warlock",
    description: "Strict All-Spin: repeating the same clear action is lethal. Starts with 10 messy garbage rows.",
    allSpin: true,
    warlock: true,
    startGarbageRows: 10,
    garbageScatterChance: 0.78,
    doubleHoleChance: 0.25,
  },
];

function specialModById(id: string): SpecialMod {
  return SPECIAL_MODS.find((m) => m.id === id) ?? SPECIAL_MODS[0];
}

let currentSpecialMod: SpecialMod = SPECIAL_MODS[0];

function specialModApplies(mode?: GameMode): boolean {
  return currentSpecialMod.id !== "none" && (!mode || usesQuickPlayMod(mode));
}

function currentEffectiveSpecialMod(mode?: GameMode): SpecialMod {
  return specialModApplies(mode) ? currentSpecialMod : SPECIAL_MODS[0];
}

function isHoldDisabledByMods(mode?: GameMode): boolean {
  const special = currentEffectiveSpecialMod(mode);
  return Boolean(currentQuickPlayMod.disableHold || special.disableHold);
}

function isAllSpinEnabled(mode?: GameMode): boolean {
  const special = currentEffectiveSpecialMod(mode);
  if (special.disableAllSpin) return false;
  return Boolean(currentQuickPlayMod.allSpin || special.allSpin);
}

function isInvisibleModeActive(mode: GameMode): boolean {
  const special = currentEffectiveSpecialMod(mode);
  return Boolean((currentQuickPlayMod.invisible && usesQuickPlayMod(mode)) || special.permanentInvisible);
}

function nextVisibleCountForMode(mode: GameMode): number {
  return currentEffectiveSpecialMod(mode).nextVisibleCount ?? 6;
}

// Exact requested mod set from QUICK PLAY / Zenith Tower.
// Effects are mapped to TetraFlux's simplified Zenith/AI Battle self-training systems.
const QUICK_PLAY_MODS: QuickPlayMod[] = [
  {
    id: "none",
    name: "No Mod",
    description: "Normal rules.",
  },
  {
    id: "no_hold",
    name: "No Hold",
    description: "Hold is disabled.",
    disableHold: true,
  },
  {
    id: "messier_garbage",
    name: "Messier Garbage",
    description: "Incoming garbage is more likely to scatter.",
    garbageScatterChance: 0.42,
    incomingMultiplier: 1.08,
    garbageBurstMax: 7,
  },
  {
    id: "gravity",
    name: "Gravity",
    description: "Player gravity is stronger.",
    gravityMultiplier: 2.15,
  },
  {
    id: "volatile_garbage",
    name: "Volatile Garbage",
    description: "Attack and incoming garbage are doubled.",
    attackMultiplier: 2.0,
    incomingMultiplier: 2.0,
    garbageBurstMax: 12,
  },
  {
    id: "double_hole_garbage",
    name: "Double Hole Garbage",
    description: "Garbage rows can contain a second hole.",
    doubleHoleChance: 0.38,
    incomingMultiplier: 1.05,
  },
  {
    id: "invisible",
    name: "Invisible",
    description: "Locked pieces briefly blink every 5 seconds; garbage stays visible.",
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

function clampChance(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function combineChance(existing: number | undefined, next: number | undefined): number | undefined {
  if (existing === undefined) return next === undefined ? undefined : clampChance(next);
  if (next === undefined) return clampChance(existing);
  return clampChance(1 - (1 - clampChance(existing)) * (1 - clampChance(next)));
}

function multiplyDefined(existing: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return existing;
  return (existing ?? 1) * next;
}

function combineQuickPlayMods(mods: QuickPlayMod[]): QuickPlayMod {
  if (mods.length === 0) return QUICK_PLAY_MODS[0];

  const combined: QuickPlayMod = {
    id: "none",
    name: mods.map((m) => m.name).join(" + "),
    description: mods.map((m) => m.description).join(" / "),
  };

  for (const mod of mods) {
    combined.attackMultiplier = multiplyDefined(combined.attackMultiplier, mod.attackMultiplier);
    combined.incomingMultiplier = multiplyDefined(combined.incomingMultiplier, mod.incomingMultiplier);
    combined.gravityMultiplier = multiplyDefined(combined.gravityMultiplier, mod.gravityMultiplier);
    combined.climbMultiplier = multiplyDefined(combined.climbMultiplier, mod.climbMultiplier);
    combined.climbLossMultiplier = multiplyDefined(combined.climbLossMultiplier, mod.climbLossMultiplier);
    combined.comboMultiplier = multiplyDefined(combined.comboMultiplier, mod.comboMultiplier);
    combined.koMultiplier = multiplyDefined(combined.koMultiplier, mod.koMultiplier);
    combined.targetedMultiplier = multiplyDefined(combined.targetedMultiplier, mod.targetedMultiplier);
    combined.garbageScatterChance = combineChance(combined.garbageScatterChance, mod.garbageScatterChance);
    combined.doubleHoleChance = combineChance(combined.doubleHoleChance, mod.doubleHoleChance);
    combined.garbageBurstMax = Math.max(combined.garbageBurstMax ?? 0, mod.garbageBurstMax ?? 0) || undefined;
    combined.botSkillBias = Math.max(-1, Math.min(1, (combined.botSkillBias ?? 0) + (mod.botSkillBias ?? 0))) || undefined;
    combined.instantEntry ||= mod.instantEntry;
    combined.disableHold ||= mod.disableHold;
    combined.invisible ||= mod.invisible;
    combined.allSpin ||= mod.allSpin;
    combined.cancelDoesNotClimb ||= mod.cancelDoesNotClimb;
  }

  return combined;
}

let currentQuickPlayMods: QuickPlayMod[] = [];
let currentQuickPlayMod: QuickPlayMod = combineQuickPlayMods(currentQuickPlayMods);

function setCurrentQuickPlayMods(mods: QuickPlayMod[]): void {
  currentQuickPlayMods = mods.filter((mod) => mod.id !== "none");
  currentQuickPlayMod = combineQuickPlayMods(currentQuickPlayMods);
}

function currentGarbageOptions(): {
  scatterChance?: number;
  doubleHoleChance?: number;
  holeWidth?: number;
  largeHoleCount?: number;
  largeHoleExtraChance?: number;
} {
  const special = currentEffectiveSpecialMod();
  const normalScatter = currentQuickPlayMod.garbageScatterChance ?? 0;
  const specialScatter = special.garbageScatterChance;
  return {
    scatterChance: specialScatter === 0 ? 0 : Math.max(normalScatter, specialScatter ?? 0),
    doubleHoleChance: Math.max(currentQuickPlayMod.doubleHoleChance ?? 0, special.doubleHoleChance ?? 0),
    holeWidth: special.garbageHoleWidth,
    largeHoleCount: special.largeHoleCount,
    largeHoleExtraChance: special.largeHoleExtraChance,
  };
}

function isQuickPlayModActive(): boolean {
  return currentQuickPlayMods.length > 0;
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


const PIECE_KINDS: PieceKind[] = ["I", "J", "L", "O", "S", "T", "Z"];

const LOADED_DICE_BOARD: string[] = [
  "..........", "..........", "..........", "..........", "..........",
  ".GGG..GGG.", ".G.G..G.G.", ".GGG..GGG.", "..........", "..........",
  ".GGG..GGG.", ".G.G..G.G.", ".GGG..GGG.", "..........", "..........",
  ".GGG..GGG.", ".G.G..G.G.", ".GGG..GGG.", "..........", "..........",
];

const DAMNATION_BOARD: string[] = [
  "..........", "..........", "..........", "..........", "..........",
  "..........", "..........", "..........", "..........", "..........",
  "Z.O.Z.O.Z.", ".O.Z.O.Z.O", "Z.O.Z.O.Z.", ".O.Z.O.Z.O", "Z.O.Z.O.Z.",
  ".O.Z.O.Z.O", "Z.O.Z.O.Z.", ".O.Z.O.Z.O", "Z.O.Z.O.Z.", ".O.Z.O.Z.O",
];

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
const MAX_RED_GARBAGE_ENTRY_PER_LOCK = 8;

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

const quickPlayModControl = document.createElement("div");
quickPlayModControl.id = "quickPlayMod";
quickPlayModControl.title = "Normal mods";
document.body.appendChild(quickPlayModControl);
quickPlayModControl.style.position = "fixed";
quickPlayModControl.style.zIndex = "20";
quickPlayModControl.style.display = "flex";
quickPlayModControl.style.flexWrap = "wrap";
quickPlayModControl.style.gap = "5px";
quickPlayModControl.style.alignItems = "center";
quickPlayModControl.style.justifyContent = "center";
quickPlayModControl.style.width = "520px";
quickPlayModControl.style.maxWidth = "calc(100vw - 24px)";
quickPlayModControl.style.padding = "6px 8px";
quickPlayModControl.style.borderRadius = "10px";
quickPlayModControl.style.border = "1px solid #334155";
quickPlayModControl.style.background = "rgba(15, 23, 42, 0.94)";
quickPlayModControl.style.color = "#e5e7eb";
quickPlayModControl.style.font = "12px Consolas";

const quickPlayModCheckboxes = new Map<QuickPlayModId, HTMLInputElement>();
for (const mod of QUICK_PLAY_MODS.filter((m) => m.id !== "none")) {
  const label = document.createElement("label");
  label.title = mod.description;
  label.style.gap = "4px";
  label.style.font = "12px Consolas";
  label.style.color = "#cbd5e1";
  label.style.whiteSpace = "nowrap";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = mod.id;
  input.style.width = "14px";
  input.style.height = "14px";
  input.style.margin = "0";
  input.addEventListener("change", () => {
    const selected = [...quickPlayModCheckboxes.entries()]
      .filter(([, checkbox]) => checkbox.checked)
      .map(([id]) => quickPlayModById(id));
    setCurrentQuickPlayMods(selected);
    trainer?.applyCurrentModToEngines?.();
    setStatus(
      isQuickPlayModActive()
        ? `Mods selected: ${currentQuickPlayMod.name} - ${currentQuickPlayMod.description}`
        : "Mods cleared: normal rules."
    );
  });

  label.append(input, mod.name);
  quickPlayModCheckboxes.set(mod.id, input);
  quickPlayModControl.appendChild(label);
}

const specialModSelect = document.createElement("select");
specialModSelect.id = "specialMod";
specialModSelect.title = "Special challenge mod";
for (const mod of SPECIAL_MODS) {
  const option = document.createElement("option");
  option.value = mod.id;
  option.textContent = `Special: ${mod.name}`;
  specialModSelect.appendChild(option);
}
document.body.appendChild(specialModSelect);
specialModSelect.style.position = "fixed";
specialModSelect.style.zIndex = "20";
specialModSelect.style.minWidth = "178px";
specialModSelect.style.maxWidth = "260px";
specialModSelect.style.padding = "6px 8px";
specialModSelect.style.borderRadius = "10px";
specialModSelect.style.border = "1px solid #7c2d12";
specialModSelect.style.background = "#111827";
specialModSelect.style.color = "#fed7aa";
specialModSelect.style.font = "13px Consolas";
specialModSelect.addEventListener("change", () => {
  currentSpecialMod = specialModById(specialModSelect.value);
  trainer?.resetMatch?.();
  trainer?.applyCurrentModToEngines?.();
  setStatus(`Special selected: ${currentSpecialMod.name} - ${currentSpecialMod.description}`);
});

function isAiBattleScreen(mode: GameMode): boolean {
  return mode === "ai_vs_ai";
}

function usesQuickPlayMod(mode: GameMode): boolean {
  return mode === "human_vs_ai" || mode === "ai_vs_ai" || mode === "lab" || mode === "zenith";
}

function canvasLayoutScale(): number {
  const rect = canvas.getBoundingClientRect();
  return rect.width < 1100 ? Math.max(0.42, rect.width / 1280) : 1;
}

function updateQuickPlayModSelectUi(mode: GameMode): void {
  const active = usesQuickPlayMod(mode);
  quickPlayModControl.hidden = !active;
  quickPlayModControl.style.display = active ? "flex" : "none";
  specialModSelect.hidden = !active;
  specialModSelect.disabled = !active;
  specialModSelect.style.display = active ? "" : "none";
  quickPlayModControl.style.border = "1px solid #334155";
  quickPlayModControl.style.background = "rgba(15, 23, 42, 0.94)";
  quickPlayModControl.style.color = "#e5e7eb";
  if (!active) return;
  const rect = canvas.getBoundingClientRect();
  const scale = canvasLayoutScale();
  const controlW = Math.max(260, quickPlayModControl.offsetWidth || 260);
  quickPlayModControl.style.left = `${Math.round(rect.left + 482 * scale - controlW / 2)}px`;
  quickPlayModControl.style.top = `${Math.round(rect.top + 116 * scale)}px`;

  const specialW = Math.max(178, specialModSelect.offsetWidth || 178);
  specialModSelect.style.left = `${Math.round(rect.left + 482 * scale - specialW / 2)}px`;
  specialModSelect.style.top = `${Math.round(rect.top + 168 * scale)}px`;
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
    const amount = Math.max(0, Math.floor(engine.pendingGarbage));
    if (amount <= 0) return 0;

    const enterNow = Math.min(MAX_RED_GARBAGE_ENTRY_PER_LOCK, amount);
    const carry = amount - enterNow;

    // Only up to 8 red garbage lines may enter on one lock.
    // Remaining red garbage stays red and waits for the next lock.
    engine.pendingGarbage = enterNow;
    engine.applyPendingGarbage();
    engine.pendingGarbage += carry;

    return enterNow;
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
  firstTo = 7;
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
  lastAiSpinLine = "";
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
  lastStandIndicators: Record<EngineSlot, LastStandIndicator> = {
    human: { current: { x: 4, y: 12 }, next: { x: 7, y: 6 }, receivedSinceMove: 0 },
    ai: { current: { x: 5, y: 12 }, next: { x: 2, y: 6 }, receivedSinceMove: 0 },
  };
  labDeaths = 0;
  specialStunUntil: Record<"player" | "left" | "right", number> = { player: 0, left: 0, right: 0 };
  damnationBlighted: Record<"player" | "left" | "right", boolean> = { player: false, left: false, right: false };
  warlockLastAction: Record<"player" | "left" | "right", string> = { player: "", left: "", right: "" };
  specialRngState = seedNow();

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

  private specialMod(): SpecialMod {
    return currentEffectiveSpecialMod(this.mode);
  }

  private random01(): number {
    let t = (this.specialRngState += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private randomLastStandIndicatorCell(): GridCell {
    const visibleRows = Math.max(1, 20 - (this.specialMod().topCutRows ?? 0));
    return {
      x: Math.floor(this.random01() * 10),
      y: Math.floor(this.random01() * visibleRows),
    };
  }

  private resetLastStandIndicators(): void {
    this.lastStandIndicators = {
      human: { current: this.randomLastStandIndicatorCell(), next: this.randomLastStandIndicatorCell(), receivedSinceMove: 0 },
      ai: { current: this.randomLastStandIndicatorCell(), next: this.randomLastStandIndicatorCell(), receivedSinceMove: 0 },
    };
  }

  private advanceLastStandIndicator(slot: EngineSlot, receivedLines: number): void {
    if (this.specialMod().id !== "last_stand" || receivedLines <= 0) return;

    const indicator = this.lastStandIndicators[slot];
    indicator.receivedSinceMove += receivedLines;

    while (indicator.receivedSinceMove >= 80) {
      indicator.receivedSinceMove -= 80;
      indicator.current = indicator.next;
      indicator.next = this.randomLastStandIndicatorCell();
    }
  }

  lastStandIndicatorsFor(slot: EngineSlot): Array<{ x: number; y: number; color: string; label: string }> | undefined {
    if (this.specialMod().id !== "last_stand") return undefined;
    const indicator = this.lastStandIndicators[slot];
    return [
      { ...indicator.current, color: "#22d3ee", label: "now" },
      { ...indicator.next, color: "#fbbf24", label: "next" },
    ];
  }

  private randomPiece(): PieceKind {
    return PIECE_KINDS[Math.floor(this.random01() * PIECE_KINDS.length)] ?? "T";
  }

  private randomizeQueue(engine: TetrisEngine, visible = 7): void {
    engine.queue = Array.from({ length: Math.max(visible, 7) }, () => this.randomPiece());
  }

  private cellFromChar(ch: string): Cell {
    if (ch === ".") return null;
    if (ch === "G" || ch === "B") return ch;
    if (["I", "J", "L", "O", "S", "T", "Z"].includes(ch)) return ch as PieceKind;
    return null;
  }

  private setVisibleBoard(engine: TetrisEngine, rows: string[]): void {
    const visibleRows = rows.slice(-20).map((row) => row.padEnd(10, ".").slice(0, 10));
    const hidden = Math.max(0, engine.board.length - visibleRows.length);
    for (let y = 0; y < hidden; y++) engine.board[y] = Array.from({ length: 10 }, () => null);
    for (let y = 0; y < visibleRows.length; y++) {
      engine.board[hidden + y] = Array.from({ length: 10 }, (_, x) => this.cellFromChar(visibleRows[y][x] ?? "."));
    }
  }

  private applySpecialStartStateToEngine(engine: TetrisEngine, slot: "player" | "left" | "right"): void {
    const special = this.specialMod();
    if (special.startBoard === "loaded_dice") this.setVisibleBoard(engine, LOADED_DICE_BOARD);
    if (special.startBoard === "damnation") this.setVisibleBoard(engine, DAMNATION_BOARD);
    if (special.startGarbageRows && special.startGarbageRows > 0) {
      engine.queueGarbage(special.startGarbageRows);
      engine.applyPendingGarbage();
    }
    if (special.randomSequence) this.randomizeQueue(engine, special.nextVisibleCount ?? 7);
    if (isHoldDisabledByMods(this.mode)) engine.canHold = false;
    if (slot === "player") this.input = new MovementInput(this.human, () => this.inputSettings());
  }

  private applySpecialStartState(): void {
    if (!specialModApplies(this.mode)) return;
    if (this.mode === "ai_vs_ai") {
      this.applySpecialStartStateToEngine(this.human, "left");
      this.applySpecialStartStateToEngine(this.aiEngine, "right");
    } else {
      this.applySpecialStartStateToEngine(this.human, "player");
      this.applySpecialStartStateToEngine(this.aiEngine, "right");
    }
  }

  private isSpecialStunned(slot: "player" | "left" | "right", now = performance.now()): boolean {
    return now < (this.specialStunUntil[slot] ?? 0);
  }

  private resultClearedGarbage(result: LockResult): boolean {
    const before = result.boardBefore ?? [];
    return before.some((row) => !row.includes(".") && (row.includes("G") || row.includes("B")));
  }

  private warlockActionName(result: LockResult): string {
    if (result.spin !== "none") return `SPIN_${result.linesCleared}`;
    if (result.linesCleared > 0) return "VOID";
    return "";
  }

  private applySpecialAfterLock(engine: TetrisEngine, slot: "player" | "left" | "right", result: LockResult, now = performance.now()): void {
    const special = this.specialMod();
    if (special.lineClearStunMs && result.linesCleared > 0) this.specialStunUntil[slot] = now + special.lineClearStunMs;
    if (special.randomSequence) this.randomizeQueue(engine, special.nextVisibleCount ?? 7);
    if (isHoldDisabledByMods(this.mode)) engine.canHold = false;
    if (special.topCutRows && boardMetrics(engine.stateDict().board).maxHeight > 20 - special.topCutRows) engine.dead = true;
  }

  private attackReceiveMultiplierForSlot(_slot: EngineSlot): number {
    const special = this.specialMod();
    return (currentQuickPlayMod.incomingMultiplier ?? 1) * (special.incomingMultiplier ?? 1);
  }

  private applySpecialInstantGround(engine: TetrisEngine): void {
    if (!specialModApplies(this.mode) || !this.specialMod().instantGround || engine.dead) return;
    const drop = engine.hardDropDistance(engine.active);
    if (drop > 0) engine.active.y += drop;
  }

  private applySpecialInstantGroundToActiveEngines(): void {
    if (!specialModApplies(this.mode) || !this.specialMod().instantGround) return;
    this.applySpecialInstantGround(this.human);
    this.applySpecialInstantGround(this.aiEngine);
  }

  applyCurrentModToEngines(): void {
    const options = usesQuickPlayMod(this.mode) ? currentGarbageOptions() : {};
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
      this.mode === "human_vs_ai" ? "Press R to start Human vs AI FT7." :
      this.mode === "ai_vs_ai" ? "Press R to start AI Battle." :
      this.mode === "lab" ? "Press R to start Garbage Lab." :
      "Press R to start Human vs AI FT7."
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
      "Human vs AI FT7 started."
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
    if (this.mode === "zenith") this.zenith.reset(performance.now(), currentQuickPlayMod);
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
    this.resetLastStandIndicators();
    this.specialStunUntil = { player: 0, left: 0, right: 0 };
    this.damnationBlighted = { player: false, left: false, right: false };
    this.warlockLastAction = { player: "", left: "", right: "" };
    this.applyCurrentModToEngines();
    this.applySpecialStartState();
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
            : (this.matchStarted ? "Climb Zenith Tower. New climbers always start at 0.0m." : "Press R to start Human vs AI FT7.");
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
    if ((this.mode !== "human_vs_ai") || this.roundOver || this.matchOver || this.human.dead || !this.matchStarted || this.isSpecialStunned("player", now)) return;
    if (this.specialMod().instantGround) {
      this.applySpecialInstantGround(this.human);
    }
    const gravity = this.specialMod().instantGround
      ? 0
      : Math.max(0, settings.gravityCellsPerSecond) *
        (usesQuickPlayMod(this.mode) ? (currentQuickPlayMod.gravityMultiplier ?? 1) : 1);
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
    const effectiveResult = this.applyQuickPlayModToResult(result, undefined, "player");
    this.applyAllSpinBreakGarbage(this.human, "player", effectiveResult);
    this.applySpecialAfterLock(this.human, "player", effectiveResult, now);
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
      this.applyAttackWithCancelableIncoming(this.human, this.aiEngine, effectiveResult.attackSent, now);
      applyRemainingGarbageAfterCounter(this.human, effectiveResult);
      if (this.human.dead || effectiveResult.topout) { this.finishRound("ai"); return; }
    }
    this.input.resetRepeatAfterPieceChange(now);
  }

  private humanLockCurrent(now: number): void {
    if (this.roundOver || this.matchOver || this.human.dead || this.isSpecialStunned("player", now) || (this.mode !== "human_vs_ai")) return;
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
    if (this.isSpecialStunned("player", now)) return;
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

  private applyQuickPlayModToResult(result: LockResult, action?: PlacementAction, slot: "player" | "left" | "right" = "player"): LockResult {
    if (!usesQuickPlayMod(this.mode)) return result;

    let attackSent = result.attackSent;
    let rawAttack = result.rawAttack;
    let spin = result.spin;

    const special = this.specialMod();

    if (isAllSpinEnabled(this.mode) && result.spin === "spin" && result.piece !== "T") {
      const full = this.allSpinFullAttack(result.linesCleared);
      if (full > rawAttack) {
        rawAttack = full;
        attackSent = Math.max(attackSent, full);
      }
      spin = "spin";
    }

    if (special.warlock) {
      if (spin !== "none" && result.linesCleared === 0) {
        attackSent = Math.max(attackSent, 2);
        rawAttack = Math.max(rawAttack, 2);
      }
      const actionName = this.warlockActionName({ ...result, spin });
      if (actionName) {
        if (this.warlockLastAction[slot] === actionName) {
          return { ...result, attackSent: 0, rawAttack: 0, spin, topout: true, reason: "warlock_repeat_penalty" };
        }
        this.warlockLastAction[slot] = actionName;
      }
    }

    const attackMultiplier = (currentQuickPlayMod.attackMultiplier ?? 1) * (special.attackMultiplier ?? 1);
    if (attackMultiplier !== 1) {
      attackSent = Math.max(0, Math.floor(attackSent * attackMultiplier));
      rawAttack = Math.max(0, Math.floor(rawAttack * attackMultiplier));
    }

    return { ...result, attackSent, rawAttack, spin };
  }

  private applyQuickPlayModToAction(action: PlacementAction): PlacementAction {
    if (isHoldDisabledByMods(this.mode) && action.hold) {
      return { ...action, hold: false, key: action.key.replace(/^H:/, "") };
    }
    return action;
  }

  private applyAllSpinBreakGarbage(engine: TetrisEngine, slot: "player" | "left" | "right", result: LockResult): void {
    if (!usesQuickPlayMod(this.mode) || !isAllSpinEnabled(this.mode) || result.linesCleared <= 0) return;

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
    if (op === "soft") return engine.move(0, 1);
    return false;
  }

  private moveOpsEndWithRotation(ops: AiMoveOp[]): boolean {
    const last = ops[ops.length - 1];
    return last === "cw" || last === "ccw" || last === "180";
  }

  private classifyExpectedSpinKind(kind: string): SpinFinisher["expectedSpinKind"] {
    if (kind.startsWith("TS")) return "tspin";
    return "spin";
  }

  private expectedLinesForSpinKind(kind: string): number {
    if (kind === "TST") return 3;
    if (kind === "TSD_LEFT" || kind === "TSD_RIGHT" || kind === "STSD") return 2;
    return 1;
  }

  private findReadySpinFinisher(engine: TetrisEngine, legal: PlacementAction[]): SpinFinisher | null {
    const state = engine.stateDict();
    const spinPotential = estimateSpinPotential(state);
    const target = spinPotential.bestTarget;
    if (!target) return null;

    const kind = target.kind;
    const spinCapable = kind === "TSD_LEFT" || kind === "TSD_RIGHT" || kind === "TST" || kind === "STSD" || kind === "TSlot";
    if (!spinCapable) return null;

    const tNow =
      engine.active.kind === "T" ||
      (engine.canHold && (engine.hold === "T" || (engine.hold === null && engine.queue[0] === "T")));
    if (!tNow) return null;

    const expectedLines = this.expectedLinesForSpinKind(kind);
    if (expectedLines < 1) return null;

    const metrics = boardMetrics(state.board);
    const nearTopout = metrics.maxHeight >= 15 || engine.pendingGarbage >= 6;
    if (nearTopout) return null;

    let best: SpinFinisher | null = null;
    for (const action of legal) {
      if (action.piece !== "T") continue;
      const path = this.findAiMovePath(engine, action, true);
      if (!path || !this.moveOpsEndWithRotation(path)) continue;
      const preview = engine.clone();
      let valid = true;
      for (const op of path) {
        if (!this.applyAiMoveOp(preview, op)) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;
      const result = preview.hardDrop();
      if (!result.ok) continue;
      if (result.spin === "none") continue;
      if (result.linesCleared < expectedLines) continue;
      const finisher: SpinFinisher = {
        action,
        ops: path,
        expectedSpinKind: this.classifyExpectedSpinKind(kind),
        expectedClearLines: expectedLines,
        targetX: action.x,
        targetY: preview.active.y,
        targetRot: this.normalizeRot(action.rot),
        source: "spin_finisher",
        kindLabel: kind,
      };
      if (!best || finisher.ops.length < best.ops.length) best = finisher;
    }

    return best;
  }

  private findAiMovePath(engine: TetrisEngine, action: PlacementAction, preferSpinFinish = false): AiMoveOp[] | null {
    const targetX = action.x;
    const targetRot = this.normalizeRot(action.rot);
    const start = engine.clone();
    const prefix: AiMoveOp[] = [];

    if (action.hold) {
      if (!start.holdPiece()) return null;
      prefix.push("hold");
    }

    if (start.active.kind !== action.piece) return null;

    const targetProbe = start.clone();
    targetProbe.active = { kind: action.piece, x: targetX, y: 0, rot: targetRot };
    if (targetProbe.collides(targetProbe.active)) return null;
    const targetY = targetProbe.hardDropDistance(targetProbe.active);

    const isTarget = (e: TetrisEngine) =>
      e.active.kind === action.piece &&
      e.active.x === targetX &&
      e.active.y === targetY &&
      this.normalizeRot(e.active.rot) === targetRot;

    const isTargetBeforeDrop = (e: TetrisEngine) =>
      e.active.kind === action.piece &&
      e.active.x === targetX &&
      this.normalizeRot(e.active.rot) === targetRot &&
      e.hardDropDistance(e.active) === targetY;

    const acceptFast = (ops: AiMoveOp[]) =>
      !preferSpinFinish || this.moveOpsEndWithRotation(ops);

    // Fast path: if the chosen placement is exactly below the spawn/current
    // state, hard drop only. For spin firing, do not take this shortcut because
    // a spin must end with a rotation input.
    if (!preferSpinFinish && isTargetBeforeDrop(start)) return prefix;

    const tryOps = (ops: AiMoveOp[]): AiMoveOp[] | null => {
      const e = start.clone();
      for (const op of ops) {
        if (!this.applyAiMoveOp(e, op)) return null;
      }
      const full = [...prefix, ...ops];
      return isTargetBeforeDrop(e) && acceptFast(full) ? full : null;
    };

    const rotDiff = (targetRot - this.normalizeRot(start.active.rot) + 4) % 4;
    const rotOps: AiMoveOp[] =
      rotDiff === 0 ? [] :
      rotDiff === 1 ? ["cw"] :
      rotDiff === 2 ? ["180"] :
      ["ccw"];
    const dx = targetX - start.active.x;
    const xOps: AiMoveOp[] = Array.from({ length: Math.abs(dx) }, () => dx > 0 ? "right" : "left");

    // Most placements should be just rotate/move/harddrop. For spin firing,
    // prefer horizontal -> rotation so the final visible input is rotation.
    const fastCandidates: AiMoveOp[][] = preferSpinFinish
      ? [
          [...xOps, ...rotOps],
          [...rotOps, ...xOps],
          [...xOps, "cw", "ccw"],
          [...xOps, "ccw", "cw"],
          [...rotOps, ...xOps, "cw", "ccw"],
          [...rotOps, ...xOps, "ccw", "cw"],
        ]
      : [
          [...rotOps, ...xOps],
          [...xOps, ...rotOps],
        ];

    for (const ops of fastCandidates) {
      const ok = tryOps(ops);
      if (ok) return ok;
    }

    const isRotationOp = (op: AiMoveOp | undefined) => op === "cw" || op === "ccw" || op === "180";
    const ops: AiMoveOp[] = ["cw", "ccw", "180", "left", "right", "soft"];
    const seen = new Set<string>([this.activeKey(start)]);
    const queue: Array<{ engine: TetrisEngine; path: AiMoveOp[] }> = [{ engine: start, path: [] }];
    const maxPath = preferSpinFinish ? 34 : 28;
    const maxStates = preferSpinFinish ? 190 : 140;
    const startMs = performance.now();
    const maxMs = preferSpinFinish ? 2.8 : 1.8;
    let fallbackTargetPath: AiMoveOp[] | null = null;

    for (let head = 0; head < queue.length && seen.size <= maxStates; head++) {
      if (performance.now() - startMs > maxMs) break;

      const item = queue[head];
      if (item.path.length >= maxPath) continue;

      for (const op of ops) {
        const next = item.engine.clone();
        if (!this.applyAiMoveOp(next, op)) continue;

        const key = this.activeKey(next);
        if (seen.has(key)) continue;
        seen.add(key);

        const path = [...item.path, op];
        if (isTarget(next)) {
          const fullPath = [...prefix, ...path];

          // Prefer a path whose final visible operation is rotation. For spin
          // firing, non-rotation paths are rejected to avoid "made the shape
          // but never actually spun it".
          if (isRotationOp(fullPath[fullPath.length - 1])) return fullPath;
          if (!preferSpinFinish && !fallbackTargetPath) fallbackTargetPath = fullPath;
          continue;
        }

        queue.push({ engine: next, path });
        if (seen.size > maxStates) break;
      }
    }

    return fallbackTargetPath;
  }

  private executeAiPlacementByMoves(engine: TetrisEngine, action: PlacementAction, preferSpinFinish = false): AiMoveExecution {
    const ops = this.findAiMovePath(engine, action, preferSpinFinish);

    if (!ops) {
      const fallback = engine.clone();
      const result = fallback.hardDrop();

      // Do not teleport to the requested placement. If the target cannot be
      // reached through normal movement, lock the current reachable position.
      return {
        result,
        ops: [],
        reachedTarget: false,
        engineAfter: fallback,
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

    const result = preview.hardDrop();

    return {
      result,
      ops,
      reachedTarget: targetReached,
      engineAfter: preview,
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

  private spinResultBonus(result: LockResult): number {
    if (result.spin === "none") return 0;

    const attackBonus = Math.max(0, result.attackSent) * 2.0;
    const lineBonus = result.linesCleared > 0 ? 4 + result.linesCleared * 2 : 1.5;
    const tBonus = result.piece === "T" ? 4 : (isAllSpinEnabled(this.mode) ? 3 : 1.25);

    return 9 + attackBonus + lineBonus + tBonus;
  }

  private boardCellBlocked(board: string[], x: number, y: number): boolean {
    if (x < 0 || x >= 10) return true;
    if (y >= board.length) return true;
    if (y < 0) return false;
    return board[y]?.[x] !== ".";
  }

  private boardCellEmpty(board: string[], x: number, y: number): boolean {
    return !this.boardCellBlocked(board, x, y);
  }

  private tFootprintEmpty(board: string[], cx: number, cy: number, rot: number): boolean {
    const cells =
      rot === 0 ? [[cx, cy], [cx - 1, cy], [cx + 1, cy], [cx, cy - 1]] :
      rot === 1 ? [[cx, cy], [cx, cy - 1], [cx, cy + 1], [cx + 1, cy]] :
      rot === 2 ? [[cx, cy], [cx - 1, cy], [cx + 1, cy], [cx, cy + 1]] :
      [[cx, cy], [cx, cy - 1], [cx, cy + 1], [cx - 1, cy]];

    return cells.every(([x, y]) => this.boardCellEmpty(board, x, y));
  }

  private sameCell(a: GridCell, b: GridCell): boolean {
    return a.x === b.x && a.y === b.y;
  }

  private uniqueCells(cells: GridCell[]): GridCell[] {
    const seen = new Set<string>();
    const out: GridCell[] = [];
    for (const c of cells) {
      const key = `${c.x}:${c.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }

  private cellFilled(board: string[], cell: GridCell): boolean {
    return this.boardCellBlocked(board, cell.x, cell.y);
  }

  private cellEmpty(board: string[], cell: GridCell): boolean {
    return !this.cellFilled(board, cell);
  }

  private tFootprintCells(cx: number, cy: number, rot: number): GridCell[] {
    const raw =
      rot === 0 ? [[cx, cy], [cx - 1, cy], [cx + 1, cy], [cx, cy - 1]] :
      rot === 1 ? [[cx, cy], [cx, cy - 1], [cx, cy + 1], [cx + 1, cy]] :
      rot === 2 ? [[cx, cy], [cx - 1, cy], [cx + 1, cy], [cx, cy + 1]] :
      [[cx, cy], [cx, cy - 1], [cx, cy + 1], [cx - 1, cy]];

    return raw.map(([x, y]) => ({ x, y }));
  }

  private hasPlausibleTRotationEntry(board: string[], cx: number, cy: number, finalRot: number): boolean {
    const predecessorRots = [
      (finalRot + 3) % 4,
      (finalRot + 1) % 4,
      (finalRot + 2) % 4,
    ];

    // Approximate T SRS kick reach. This is a cheap terrain filter, not a full
    // path search. It rejects sealed slots that look like TSD/TST geometrically
    // but cannot be rotated into.
    const kickLikeOffsets: GridCell[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: 0, y: -2 },
      { x: 0, y: 2 },
    ];

    for (const prevRot of predecessorRots) {
      for (const d of kickLikeOffsets) {
        const cells = this.tFootprintCells(cx + d.x, cy + d.y, prevRot);
        if (cells.every((cell) => this.cellEmpty(board, cell))) return true;
      }
    }

    return false;
  }

  private classifySpinPlan(cx: number, cy: number, rot: number, missingRequired: number, blockedCorners: number): SpinPlanTarget["kind"] {
    if (blockedCorners >= 4 && missingRequired <= 1) return "TST";
    if (rot === 0 && missingRequired <= 2) return "STSD";
    if (missingRequired <= 1) return "TSD";
    return "TSlot";
  }

  private findSpinPlanTargets(board: string[]): SpinPlanTarget[] {
    const targets: SpinPlanTarget[] = [];

    for (let cy = 1; cy < board.length - 1; cy++) {
      for (let cx = 0; cx < 10; cx++) {
        const cornerCells = [
          { x: cx - 1, y: cy - 1 },
          { x: cx + 1, y: cy - 1 },
          { x: cx - 1, y: cy + 1 },
          { x: cx + 1, y: cy + 1 },
        ];

        const blockedCorners = cornerCells.filter((cell) => this.cellFilled(board, cell)).length;
        const missingCorners = cornerCells.filter((cell) => this.cellEmpty(board, cell));

        // Need at least some existing structure; otherwise every empty area looks like a "plan".
        if (blockedCorners < 1 || missingCorners.length > 3) continue;

        for (let rot = 0; rot < 4; rot++) {
          const slotCells = this.tFootprintCells(cx, cy, rot);
          if (!slotCells.every((cell) => this.cellEmpty(board, cell))) continue;

          const entryCells = this.uniqueCells([
            { x: cx, y: cy - 2 },
            { x: cx, y: cy - 1 },
            { x: cx - 1, y: cy - 1 },
            { x: cx + 1, y: cy - 1 },
          ]);
          const forbiddenCells = this.uniqueCells([...slotCells, ...entryCells]);

          const requiredCells = missingCorners.filter(
            (cell) => !forbiddenCells.some((bad) => this.sameCell(bad, cell)),
          );

          const missingRequired = Math.max(0, 3 - blockedCorners);
          if (missingRequired > 2) continue;
          if (!this.hasPlausibleTRotationEntry(board, cx, cy, rot)) continue;

          targets.push({
            kind: this.classifySpinPlan(cx, cy, rot, missingRequired, blockedCorners),
            cx,
            cy,
            rot,
            requiredCells,
            forbiddenCells,
            slotCells,
            missingRequired,
            alreadyComplete: blockedCorners >= 3,
          });
        }
      }
    }

    return targets
      .sort((a, b) => {
        const priority = (kind: SpinPlanTarget["kind"]) => kind === "TST" ? 0 : kind === "TSD" ? 1 : kind === "STSD" ? 2 : 3;
        return priority(a.kind) - priority(b.kind) || a.missingRequired - b.missingRequired || b.cy - a.cy;
      })
      .slice(0, 8);
  }

  private evaluateSpinPlanProgress(before: string[], after: string[]): { bonus: number; info?: Record<string, unknown> } {
    const targets = this.findSpinPlanTargets(before);
    if (targets.length === 0) return { bonus: 0 };

    let bestBonus = 0;
    let bestInfo: Record<string, unknown> | undefined;

    for (const target of targets) {
      const slotBroken = target.slotCells.some((cell) => this.cellEmpty(before, cell) && this.cellFilled(after, cell));
      const forbiddenBroken = target.forbiddenCells.some((cell) => this.cellEmpty(before, cell) && this.cellFilled(after, cell));
      if (slotBroken || forbiddenBroken) {
        const penalty = slotBroken ? -5000 : -1400;
        if (Math.abs(penalty) > Math.abs(bestBonus)) {
          bestBonus = penalty;
          bestInfo = { spinPlanKind: target.kind, spinPlanBroken: true, spinPlanX: target.cx, spinPlanY: target.cy };
        }
        continue;
      }

      const requiredFilled = target.requiredCells.filter((cell) => this.cellEmpty(before, cell) && this.cellFilled(after, cell)).length;
      const afterCorners =
        (this.boardCellBlocked(after, target.cx - 1, target.cy - 1) ? 1 : 0) +
        (this.boardCellBlocked(after, target.cx + 1, target.cy - 1) ? 1 : 0) +
        (this.boardCellBlocked(after, target.cx - 1, target.cy + 1) ? 1 : 0) +
        (this.boardCellBlocked(after, target.cx + 1, target.cy + 1) ? 1 : 0);
      const afterSlotOpen = target.slotCells.every((cell) => this.cellEmpty(after, cell));
      const complete = afterCorners >= 3 && afterSlotOpen;

      let bonus = 0;
      if (complete) bonus += 10000;
      else if (target.missingRequired <= 1) bonus += 3000;
      else if (target.missingRequired <= 2) bonus += 1000;

      bonus += requiredFilled * 650;
      if (target.alreadyComplete && afterSlotOpen) bonus += 900;
      if (target.kind === "TST") bonus += 900;
      else if (target.kind === "TSD") bonus += 650;
      else if (target.kind === "STSD") bonus += 500;

      if (bonus > bestBonus) {
        bestBonus = bonus;
        bestInfo = {
          spinPlanKind: target.kind,
          spinPlanComplete: complete,
          spinPlanMissing: target.missingRequired,
          spinPlanRequiredFilled: requiredFilled,
          spinPlanX: target.cx,
          spinPlanY: target.cy,
        };
      }
    }

    if (!bestInfo) return { bonus: 0 };

    const terrainFactor = this.spinSetupTerrainFactor(after);
    if (terrainFactor <= 0) return { bonus: 0, info: { ...bestInfo, spinPlanTerrainRejected: true } };
    return {
      bonus: bestBonus * terrainFactor,
      info: { ...bestInfo, spinPlanTerrainFactor: Number(terrainFactor.toFixed(3)) },
    };
  }

  private spinSetupTerrainFactor(board: string[], pendingGarbage = 0): number {
    const metrics = boardMetrics(board);
    const centerMax = Math.max(metrics.heights[4] ?? 0, metrics.heights[5] ?? 0);
    const sideAvg = ((metrics.heights[0] ?? 0) + (metrics.heights[1] ?? 0) + (metrics.heights[8] ?? 0) + (metrics.heights[9] ?? 0)) / 4;
    const centerTower = Math.max(0, centerMax - sideAvg);

    if (pendingGarbage >= 6 || metrics.holes >= 5 || metrics.maxHeight >= 15 || metrics.bumpiness >= 28 || centerTower >= 5) return 0;

    const holeFactor = metrics.holes === 0 ? 1 : metrics.holes === 1 ? 0.7 : metrics.holes <= 3 ? 0.35 : 0.12;
    const heightFactor = Math.max(0, Math.min(1, (14 - metrics.maxHeight) / 6));
    const bumpFactor = Math.max(0, Math.min(1, (26 - metrics.bumpiness) / 18));
    const centerFactor = Math.max(0, Math.min(1, (5 - centerTower) / 4));
    return Math.max(0, Math.min(1, holeFactor * heightFactor * bumpFactor * centerFactor));
  }

  private estimateStaticSpinSetup(engineAfter: TetrisEngine): { bonus: number; kind?: string; x?: number; y?: number } {
    const state = engineAfter.stateDict();
    const board = state.board;
    const terrainFactor = this.spinSetupTerrainFactor(board, engineAfter.pendingGarbage);

    // Do not sacrifice survival for setup.
    if (terrainFactor <= 0) return { bonus: 0 };

    let best = { bonus: 0, kind: undefined as string | undefined, x: undefined as number | undefined, y: undefined as number | undefined };

    // Cheap T-slot scan. This is O(10*20*4) and does not call legalPlacements()
    // or BFS, so it will not freeze even when many candidates are evaluated.
    for (let cy = 1; cy < board.length - 1; cy++) {
      for (let cx = 0; cx < 10; cx++) {
        const corners =
          (this.boardCellBlocked(board, cx - 1, cy - 1) ? 1 : 0) +
          (this.boardCellBlocked(board, cx + 1, cy - 1) ? 1 : 0) +
          (this.boardCellBlocked(board, cx - 1, cy + 1) ? 1 : 0) +
          (this.boardCellBlocked(board, cx + 1, cy + 1) ? 1 : 0);

        if (corners < 3) continue;

        for (let rot = 0; rot < 4; rot++) {
          if (!this.tFootprintEmpty(board, cx, cy, rot)) continue;

          const floorSupport =
            (this.boardCellBlocked(board, cx - 1, cy + 2) ? 1 : 0) +
            (this.boardCellBlocked(board, cx, cy + 2) ? 1 : 0) +
            (this.boardCellBlocked(board, cx + 1, cy + 2) ? 1 : 0);

          const depthBonus = cy > 8 ? 1.1 : 0.6;
          const supportBonus = Math.min(1.5, floorSupport * 0.5);
          const bonus = (3.2 + corners * 1.05 + depthBonus + supportBonus) * terrainFactor;

          if (bonus > best.bonus) {
            best = { bonus, kind: rot === 0 ? "t-slot-up" : rot === 1 ? "t-slot-right" : rot === 2 ? "t-slot-down" : "t-slot-left", x: cx, y: cy };
          }
        }
      }
    }

    // Very small generic all-spin cavity hint. It is intentionally weak and only
    // active in All-Spin mode, because exact non-T spin detection is shape-specific.
    if (isAllSpinEnabled(this.mode)) {
      for (let y = 1; y < board.length - 1; y++) {
        for (let x = 1; x < 9; x++) {
          if (!this.boardCellEmpty(board, x, y)) continue;
          const walls =
            (this.boardCellBlocked(board, x - 1, y) ? 1 : 0) +
            (this.boardCellBlocked(board, x + 1, y) ? 1 : 0) +
            (this.boardCellBlocked(board, x, y + 1) ? 1 : 0) +
            (this.boardCellBlocked(board, x, y - 1) ? 1 : 0);
          if (walls >= 3 && best.bonus < 3.0) {
            best = { bonus: 3.0, kind: "all-spin-cavity", x, y };
          }
        }
      }
    }

    return best;
  }

  private previewActionDirect(engine: TetrisEngine, action: PlacementAction): AiMoveExecution {
    const preview = engine.clone();
    const result = preview.applyAction(action);
    return {
      result,
      ops: [],
      reachedTarget: result.ok,
      engineAfter: preview,
    };
  }

  private adjustedAiCandidateScore(
    engine: TetrisEngine,
    action: PlacementAction,
    baseScore: number,
    danger: boolean,
    useRouteSearch: boolean,
  ): { score: number; info: Record<string, unknown> } {
    const execution = useRouteSearch
      ? this.executeAiPlacementByMoves(engine, action, action.piece === "T" || isAllSpinEnabled(this.mode))
      : this.previewActionDirect(engine, action);
    const result = execution.result;
    let score = baseScore;
    const info: Record<string, unknown> = {
      reachedTarget: execution.reachedTarget,
      routeOps: execution.ops.length + 1,
    };

    if (!execution.reachedTarget) {
      score += 8;
      info.routeFailed = true;
    }

    const immediateSpinBonus = this.spinResultBonus(result);
    if (immediateSpinBonus > 0) {
      score -= immediateSpinBonus;
      info.spinBonus = true;
      info.spinType = result.spin;
      info.spinLines = result.linesCleared;
      info.spinAttack = result.attackSent;
    }

    // Plan-based spin targeting: detect slot plans first, then reward only
    // moves that fill required cells or preserve/complete the slot.
    if (!danger && execution.reachedTarget && !execution.engineAfter.dead) {
      const beforeBoard = engine.stateDict().board;
      const afterBoard = execution.engineAfter.stateDict().board;
      const plan = this.evaluateSpinPlanProgress(beforeBoard, afterBoard);
      if (plan.bonus !== 0) {
        score -= plan.bonus;
        Object.assign(info, plan.info ?? {});
        info.spinPlanBonus = plan.bonus;
      }

      const setup = this.estimateStaticSpinSetup(execution.engineAfter);
      if (setup.bonus > 0) {
        score -= setup.bonus;
        info.staticSpinSetup = true;
        info.staticSpinBonus = setup.bonus;
        info.staticSpinKind = setup.kind;
        info.staticSpinX = setup.x;
        info.staticSpinY = setup.y;
      }
    }

    return { score, info };
  }

  private findSpinFireAction(engine: TetrisEngine, legal: PlacementAction[], scoreAfter: ((e: TetrisEngine, a: PlacementAction) => { score: number; info: Record<string, unknown> }) | null): AiChoice | null {
    let best: AiChoice | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const startMs = performance.now();

    // Only a few realistic spin-fire candidates are needed. This is not setup
    // search; it is a final verification that the already-built slot can be
    // entered by an SRS-like route ending in rotation.
    const spinCandidates = legal
      .filter((action) => action.piece === "T" || isAllSpinEnabled(this.mode))
      .slice(0, 72);

    for (const action of spinCandidates) {
      if (performance.now() - startMs > 3.5) break;

      const execution = this.executeAiPlacementByMoves(engine, action, true);
      if (!execution.reachedTarget || !this.moveOpsEndWithRotation(execution.ops)) continue;

      const result = execution.result;
      if (result.spin === "none" || result.linesCleared <= 0) continue;

      const base = scoreAfter ? scoreAfter(engine, action).score : 0;
      const fireValue =
        result.attackSent * 120 +
        result.linesCleared * 40 +
        (result.spin === "tspin" ? 90 : result.spin === "tspin-mini" ? 35 : 50);
      const score = base - 20000 - fireValue + execution.ops.length * 0.08;

      if (score < bestScore) {
        bestScore = score;
        best = {
          ...action,
          aiScore: score,
          aiInfo: {
            spinFire: true,
            spinFireType: result.spin,
            spinFireAttack: result.attackSent,
            spinFireLines: result.linesCleared,
            spinFireOps: execution.ops.join(","),
            srsVerified: true,
          },
        };
      }
    }

    return best;
  }

  private chooseAiAction(engine: TetrisEngine, ai: AiLike): AiChoice | null {
    const normal = ai.choose(engine);
    if (!normal) return null;

    const metrics = boardMetrics(engine.stateDict().board);
    const danger = metrics.maxHeight >= 14 || engine.pendingGarbage >= 6;

    const scorer = (ai as unknown as { scoreAfter?: (e: TetrisEngine, a: PlacementAction) => { score: number; info: Record<string, unknown> } }).scoreAfter;
    const fallback = (ai as unknown as { fallback?: { scoreAfter?: (e: TetrisEngine, a: PlacementAction) => { score: number; info: Record<string, unknown> } } }).fallback;
    const scoreAfter = typeof scorer === "function" ? scorer.bind(ai) :
      typeof fallback?.scoreAfter === "function" ? fallback.scoreAfter.bind(fallback) :
      null;

    if (!scoreAfter) return normal;

    const legal = engine.legalPlacements(true);
    if (legal.length < 2) return normal;

    const spinFire = this.findSpinFireAction(engine, legal, scoreAfter);
    if (spinFire) return spinFire;

    const baseRanked = legal
      .map((action) => ({ action, ...scoreAfter(engine, action) }))
      .filter((x) => Number.isFinite(x.score))
      .sort((a, b) => a.score - b.score);

    if (baseRanked.length === 0) return normal;

    const candidates: Array<{
      action: PlacementAction;
      score: number;
      info: Record<string, unknown>;
    }> = [];
    const rerankStartMs = performance.now();
    const maxCandidates = Math.min(18, baseRanked.length);
    const routeSearchLimit = danger ? 3 : 6;
    const rerankBudgetMs = danger ? 2.0 : 4.5;

    for (let i = 0; i < maxCandidates; i++) {
      if (performance.now() - rerankStartMs > rerankBudgetMs && candidates.length > 0) break;

      const candidate = baseRanked[i];
      const useRouteSearch = i < routeSearchLimit;
      const adjusted = this.adjustedAiCandidateScore(engine, candidate.action, candidate.score, danger, useRouteSearch);

      candidates.push({
        ...candidate,
        score: adjusted.score,
        info: { ...candidate.info, ...adjusted.info, routeSearch: useRouteSearch },
      });
    }

    candidates.sort((a, b) => a.score - b.score);

    let chosen = candidates[0];
    if (!chosen) return normal;

    // Small human-like imperfection: about 10% choose the next-best candidate.
    // Disable it when the board is high or incoming garbage is scary.
    if (!danger && Math.random() < 0.10 && candidates.length >= 2) {
      const maxAltIndex = Math.min(2, candidates.length - 1);
      const altIndex = maxAltIndex >= 2 && Math.random() < 0.20 ? 2 : 1;
      chosen = candidates[altIndex];
      return {
        ...chosen.action,
        aiScore: chosen.score,
        aiInfo: {
          ...chosen.info,
          randomVariant: true,
          randomVariantRank: altIndex + 1,
          normalScore: normal.aiScore,
        },
      };
    }

    return {
      ...chosen.action,
      aiScore: chosen.score,
      aiInfo: {
        ...chosen.info,
        spinAwareRerank: true,
        normalScore: normal.aiScore,
      },
    };
  }

  private startAiAction(engine: TetrisEngine, opponent: TetrisEngine, ai: AiLike, side?: BattleSide): boolean {
    if (this.roundOver || this.matchOver || engine.dead) return false;
    if (this.getPendingAction(side)) return true;

    const stateBefore = engine.stateDict();
    const opponentBefore = opponent.stateDict();

    const legal = engine.legalPlacements(true);
    const spinFinisher = this.findReadySpinFinisher(engine, legal);
    const chosenAction = spinFinisher
      ? {
          ...spinFinisher.action,
          aiScore: Number.NEGATIVE_INFINITY,
          aiInfo: {
            source: spinFinisher.source,
            spinFinisher: true,
            spinKind: spinFinisher.kindLabel,
            expectedSpin: spinFinisher.expectedSpinKind,
            expectedLines: spinFinisher.expectedClearLines,
            routeLength: spinFinisher.ops.length,
            finalOp: spinFinisher.ops[spinFinisher.ops.length - 1] ?? "none",
            targetX: spinFinisher.targetX,
            targetY: spinFinisher.targetY,
            targetRot: spinFinisher.targetRot,
          },
        }
      : this.chooseAiAction(engine, ai);
    if (!chosenAction) return false;

    const spinPotential = (chosenAction.aiInfo as { spinPotential?: { bestTarget?: { kind?: string; score?: number; x?: number; y?: number } | null } }).spinPotential;
    const bestTarget = spinPotential?.bestTarget;
    this.lastAiSpinLine = bestTarget
      ? `spin: ${bestTarget.kind ?? "TSlot"} bonus ${(Number(bestTarget.score) || 0).toFixed(2)} at ${bestTarget.x ?? 0},${bestTarget.y ?? 0}`
      : "";

    const plannedAction = this.applyQuickPlayModToAction(chosenAction);
    const execution = spinFinisher
      ? { ...this.executeAiPlacementByMoves(engine, plannedAction, true), ops: spinFinisher.ops }
      : this.executeAiPlacementByMoves(engine, plannedAction);
    if (spinFinisher) {
      const finalOp = execution.ops[execution.ops.length - 1] ?? "none";
      this.lastAiSpinLine = `spin finisher: ${spinFinisher.kindLabel} route ${execution.ops.length} final=${finalOp} target=${spinFinisher.targetX},${spinFinisher.targetY},r${spinFinisher.targetRot}`;
    }
    const pending: PendingAiAction = {
      stateBefore,
      opponentBefore,
      plannedAction,
      ops: execution.ops,
      opIndex: 0,
      routeFailed: !execution.reachedTarget,
      spinFinisherPlanned: Boolean(spinFinisher),
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
    const result = this.applyQuickPlayModToResult(rawResult, action, slot);
    if (pending.spinFinisherPlanned) {
      this.lastAiSpinLine = `${this.lastAiSpinLine} -> actual ${result.spin}/${result.linesCleared}`;
    }
    this.applyAllSpinBreakGarbage(engine, slot, result);
    this.applySpecialAfterLock(engine, slot, result);
    const attackApplied = this.applyAttackWithCancelableIncoming(engine, opponent, result.attackSent);
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
    this.applySpecialInstantGround(engine);

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
    if (this.mode !== "human_vs_ai" || this.roundOver || this.matchOver || this.aiEngine.dead || this.isSpecialStunned("right")) return;
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
    if (this.isSpecialStunned(side)) return;
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
    if (!usesQuickPlayMod(this.mode)) return 1;
    const special = this.specialMod();
    return (currentQuickPlayMod.incomingMultiplier ?? 1) * (special.incomingMultiplier ?? 1);
  }

  private scheduleIncomingGarbage(slot: EngineSlot, amount: number, now = performance.now(), applyIncomingMultiplier = true): void {
    const multiplier = applyIncomingMultiplier ? this.incomingMultiplierForCurrentMode() : 1;
    const scaled = Math.max(0, Math.floor(amount * multiplier));
    if (scaled <= 0) return;
    this.advanceLastStandIndicator(slot, scaled);
    this.delayedIncomingGarbage[slot].push({
      amount: scaled,
      receivedAtMs: now,
      readyAtMs: now + LAB_GARBAGE_DELAY_MS,
    });
  }

  private cancelDelayedIncomingGarbage(slot: EngineSlot, amount: number): number {
    let remaining = Math.max(0, Math.floor(amount));
    if (remaining <= 0) return 0;

    const items = [...this.delayedIncomingGarbage[slot]]
      .sort((a, b) => a.readyAtMs - b.readyAtMs || a.receivedAtMs - b.receivedAtMs);
    const next: TimedIncomingGarbage[] = [];

    for (const item of items) {
      if (remaining <= 0) {
        next.push(item);
        continue;
      }

      const cancel = Math.min(item.amount, remaining);
      remaining -= cancel;
      const left = item.amount - cancel;
      if (left > 0) next.push({ ...item, amount: left });
    }

    this.delayedIncomingGarbage[slot] = next;
    return amount - remaining;
  }

  private applyAttackWithCancelableIncoming(sender: TetrisEngine, receiver: TetrisEngine, amount: number, now = performance.now()): AttackApplyResult {
    const rawAttack = Math.max(0, Math.floor(amount));
    let outgoing = rawAttack;
    let canceled = 0;

    // Red ready garbage is canceled first because it is the immediate threat.
    const redCancel = Math.min(sender.pendingGarbage, outgoing);
    if (redCancel > 0) {
      sender.pendingGarbage -= redCancel;
      outgoing -= redCancel;
      canceled += redCancel;
    }

    // Gray scheduled garbage is also always cancelable.
    if (outgoing > 0) {
      const grayCancel = this.cancelDelayedIncomingGarbage(this.slotForEngine(sender), outgoing);
      outgoing -= grayCancel;
      canceled += grayCancel;
    }

    const sent = Math.max(0, outgoing);
    if (sent > 0) {
      const receiverSlot = this.slotForEngine(receiver);
      const received = sent * this.attackReceiveMultiplierForSlot(receiverSlot);
      this.scheduleIncomingGarbage(receiverSlot, received, now, false);
    }

    return { rawAttack, canceled, sent };
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
    this.applySpecialInstantGroundToActiveEngines();
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
      if (isHoldDisabledByMods(this.mode)) return;
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
      if (isHoldDisabledByMods(this.mode)) return;
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
  ctx.fillText("TetraFlux Web FT7 Trainer", 26, 42);
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
  const invisibleActive = isInvisibleModeActive(trainer.mode);
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
    holdDisabled: isHoldDisabledByMods(trainer.mode),
    garbageSegments: trainer.garbageSegmentsFor("human", now),
    nextVisibleCount: nextVisibleCountForMode(trainer.mode),
    topCutRows: currentEffectiveSpecialMod(trainer.mode).topCutRows,
    visibleGarbageRows: currentEffectiveSpecialMod(trainer.mode).visibleGarbageRows,
    lastStandIndicators: trainer.lastStandIndicatorsFor("human"),
  });
  if (trainer.mode === "zenith") {
    drawZenithTower(ctx, trainer, 540, boardY, 500, Math.max(520, h - boardY - 18));
  } else if (trainer.mode === "lab") {
    drawPanel(ctx, 540, boardY, 500, 300, "Garbage Lab", [
      [`AI: ${trainer.aiName}`, "#e5e7eb"],
      [`garbage/bag: ${settings.labGarbagePerBag}`, "#94a3b8"],
      [`delay: ${(LAB_GARBAGE_DELAY_MS / 1000).toFixed(1)}s / cap ${MAX_RED_GARBAGE_ENTRY_PER_LOCK}`, "#94a3b8"],
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
      holdDisabled: isHoldDisabledByMods(trainer.mode),
      garbageSegments: trainer.garbageSegmentsFor("ai", now),
      nextVisibleCount: nextVisibleCountForMode(trainer.mode),
      topCutRows: currentEffectiveSpecialMod(trainer.mode).topCutRows,
      visibleGarbageRows: currentEffectiveSpecialMod(trainer.mode).visibleGarbageRows,
      lastStandIndicators: trainer.lastStandIndicatorsFor("ai"),
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
    specialModApplies(trainer.mode) ? ["Special", "#fb923c"] : ["", "#fb923c"],
    specialModApplies(trainer.mode) ? [`${currentSpecialMod.name}`, "#fed7aa"] : ["", "#fed7aa"],
    usesQuickPlayMod(trainer.mode) && isAllSpinEnabled(trainer.mode) ? [`breaks: L${trainer.allSpinBreakRows.left} R${trainer.allSpinBreakRows.right}  streak ${trainer.allSpinClearStreak.left}/${trainer.allSpinClearStreak.right}`, "#fb7185"] : ["", "#64748b"],
    [""],
    ["AI", "#38bdf8"],
    ...trainer.aiDetails.slice(0, 4).map((line) => [line, "#94a3b8"] as [string, string]),
    trainer.lastAiSpinLine ? [short(trainer.lastAiSpinLine, 48), "#c4b5fd"] : ["", "#94a3b8"],
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
