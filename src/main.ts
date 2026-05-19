import "./style.css";
import { HeuristicAI } from "./ai/heuristic";
import type { AiChoice } from "./ai/heuristic";
import { WebPolicyAI } from "./ai/webPolicy";
import { TetrisEngine, type PlacementAction, type PieceState } from "./engine/tetris";
import { MovementInput, type LogicalMoveKey } from "./input";
import { MatchLogger, SelfplayLogger, type BattleSide, uploadLogs, uploadSelfplayLogs } from "./logging";
import { PresenceClient } from "./presence";
import { drawBoard, drawPanel } from "./render";

type Winner = "human" | "ai";
type GameMode = "human_vs_ai" | "ai_vs_ai";
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
  settings.aiPps = Math.max(0.1, Math.min(20, numInput(aiPpsInput, DEFAULT_SETTINGS.aiPps)));
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

function applyAttack(sender: TetrisEngine, receiver: TetrisEngine, amount: number): void {
  let atk = Math.max(0, Math.floor(amount));
  const canceled = Math.min(sender.pendingGarbage, atk);
  sender.pendingGarbage -= canceled;
  atk -= canceled;
  if (atk > 0) receiver.queueGarbage(atk);
}

function applyRemainingGarbageAfterCounter(engine: TetrisEngine, result: { rawAttack: number; linesCleared: number }): void {
  if (result.rawAttack <= 0 && result.linesCleared <= 0) engine.applyPendingGarbage();
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
  input!: MovementInput;
  aiAccumulatorMs = 0;
  battleLeftAccumulatorMs = 0;
  battleRightAccumulatorMs = 0;

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

  toggleMode(): void { this.setMode(this.mode === "human_vs_ai" ? "ai_vs_ai" : "human_vs_ai"); }
  modeLabel(): string { return this.mode === "human_vs_ai" ? "Human vs AI" : "AI Battle"; }
  updateModeButton(): void { toggleModeBtn.textContent = `Mode: ${this.modeLabel()}`; }

  inputSettings() { return { dasMs: settings.dasMs, arrMs: settings.arrMs, sdfCellsPerSecond: settings.sdfCellsPerSecond }; }

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
      if (this.mode === "ai_vs_ai" && this.roundOver && !this.matchOver) {
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
    this.matchStarted = this.mode === "ai_vs_ai";
    this.clearAiBattleAutoNext();
    this.logger = new MatchLogger();
    this.selfplayLogger = new SelfplayLogger();
    this.presence?.stop();
    this.presence = new PresenceClient(this.logger.anonymousPlayerId);
    this.presence.start();
    this.autoUploadStatus = "idle";
    this.autoUploadDetail = this.mode === "human_vs_ai" ? "human logs upload to raw/" : "selfplay upload to selfplay/";
    this.autoUploadInFlight = false;
    this.autoUploadedMatchId = null;
    this.resetRound();
    this.updateModeButton();
    setStatus(this.mode === "human_vs_ai" ? "Press R to start Human vs AI FT5." : "New AI Battle FT5 started.");
  }

  startHumanMatch(): void {
    if (this.mode !== "human_vs_ai") {
      this.resetMatch();
      return;
    }

    this.resetMatch();
    this.matchStarted = true;
    this.resetRound();
    setStatus("Human vs AI FT5 started.");
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
    this.roundOver = false;
    this.roundWinner = null;
    this.stepIndex = 0;
    this.message = this.mode === "human_vs_ai"
      ? (this.matchStarted ? `Round ${this.roundIndex + 1}: play against AI.` : "Press R to start Human vs AI.")
      : `Round ${this.roundIndex + 1}: ${this.battleLeftName} vs ${this.battleRightName}.`;
  }

  finishRound(winner: Winner): void {
    if (this.roundOver) return;
    this.roundOver = true;
    this.roundWinner = winner;
    this.score[winner] += 1;

    const willMatchEnd = this.score.human >= this.firstTo || this.score.ai >= this.firstTo;

    if (this.mode === "human_vs_ai") {
      this.logger.finishRound(winner, this.score);
    } else {
      const sideWinner: BattleSide = winner === "human" ? "left" : "right";
      const matchWinner = willMatchEnd ? sideWinner : null;
      this.selfplayLogger.finishRound(sideWinner, { left: this.score.human, right: this.score.ai }, matchWinner);
    }

    if (willMatchEnd) {
      this.matchOver = true;
      if (this.mode === "ai_vs_ai") {
        this.message = `AI Battle over: ${this.winnerDisplay(winner)} wins FT${this.firstTo}. Uploading selfplay logs...`;
        this.autoUploadSelfplayMatch();
      } else {
        this.message = `Match over: ${winner} wins FT${this.firstTo}. Auto-uploading logs...`;
        this.autoUploadHumanMatch();
      }
    } else {
      if (this.mode === "ai_vs_ai") {
        this.scheduleAiBattleAutoNext();
        this.message = `Round winner: ${this.winnerDisplay(winner)}. Auto next round...`;
      } else {
        this.message = `Round winner: ${this.winnerDisplay(winner)}. Press ${keysLabel(settings.keys.nextRound)} or Next Round.`;
      }
    }
  }

  winnerDisplay(winner: Winner): string {
    if (this.mode === "ai_vs_ai") return winner === "human" ? this.battleLeftName : this.battleRightName;
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
    if (this.mode !== "human_vs_ai" || this.roundOver || this.matchOver || this.human.dead) return;
    const gravity = Math.max(0, settings.gravityCellsPerSecond);
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

  private humanLockCurrent(now: number): void {
    if (this.roundOver || this.matchOver || this.human.dead || this.mode !== "human_vs_ai") return;
    const stateBefore = this.human.stateDict();
    const aiStateBefore = this.aiEngine.stateDict();
    const activeBefore: PieceState = { ...this.human.active };
    const usedHold = this.human.holdUsedForCurrentPiece;
    const result = this.human.lockPiece();
    this.logHumanAction(activeBefore, usedHold, stateBefore, aiStateBefore, result);
    applyAttack(this.human, this.aiEngine, result.attackSent);
    applyRemainingGarbageAfterCounter(this.human, result);
    this.humanGravityCarry = 0;
    this.humanGroundedSince = null;
    if (this.human.dead || result.topout) { this.finishRound("ai"); return; }
    this.input.resetRepeatAfterPieceChange(now);
  }

  humanHardDrop(): void {
    if (this.roundOver || this.matchOver || this.human.dead || this.mode !== "human_vs_ai") return;
    const stateBefore = this.human.stateDict();
    const aiStateBefore = this.aiEngine.stateDict();
    const activeBefore: PieceState = { ...this.human.active };
    const usedHold = this.human.holdUsedForCurrentPiece;
    const result = this.human.hardDrop();
    this.logHumanAction(activeBefore, usedHold, stateBefore, aiStateBefore, result);
    applyAttack(this.human, this.aiEngine, result.attackSent);
    applyRemainingGarbageAfterCounter(this.human, result);
    this.humanGravityCarry = 0;
    this.humanGroundedSince = null;
    if (this.human.dead || result.topout) { this.finishRound("ai"); return; }
    this.input.resetRepeatAfterPieceChange(performance.now());
  }

  private aiAction(engine: TetrisEngine, opponent: TetrisEngine, ai: AiLike, side?: BattleSide): boolean {
    if (this.roundOver || this.matchOver || engine.dead) return false;

    const stateBefore = engine.stateDict();
    const opponentBefore = opponent.stateDict();

    const action = ai.choose(engine);
    if (!action) return false;

    const result = engine.applyAction(action);
    applyAttack(engine, opponent, result.attackSent);
    applyRemainingGarbageAfterCounter(engine, result);

    const stateAfter = engine.stateDict();
    const opponentAfter = opponent.stateDict();

    if (this.mode === "ai_vs_ai" && side) {
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

  battleTurn(side: "left" | "right"): void {
    if (this.mode !== "ai_vs_ai" || this.roundOver || this.matchOver) return;
    if (side === "left") {
      const alive = this.aiAction(this.human, this.aiEngine, this.battleLeftAi, "left");
      if (!alive) { this.finishRound("ai"); return; }
      if (this.aiEngine.dead) this.finishRound("human");
    } else {
      const alive = this.aiAction(this.aiEngine, this.human, this.battleRightAi, "right");
      if (!alive) { this.finishRound("human"); return; }
      if (this.human.dead) this.finishRound("ai");
    }
  }

  update(dtMs: number, now: number): void {
    if (this.mode === "ai_vs_ai" && this.roundOver && !this.matchOver && this.aiBattleAutoNextAt !== null && now >= this.aiBattleAutoNextAt) {
      this.nextRound();
    }

    if (this.roundOver || this.matchOver) return;
    if (this.mode === "human_vs_ai" && !this.matchStarted) return;

    const pps = Math.max(0.1, Math.min(20, settings.aiPps));
    const interval = 1000 / pps;
    if (this.mode === "human_vs_ai") {
      this.input.update(now);
      this.updateHumanGravity(dtMs, now);
      this.aiAccumulatorMs += dtMs;
      let guard = 0;
      while (this.aiAccumulatorMs >= interval && guard < 5 && !this.roundOver && !this.matchOver) {
        this.aiTurn(); this.aiAccumulatorMs -= interval; guard++;
      }
    } else {
      this.battleLeftAccumulatorMs += dtMs;
      this.battleRightAccumulatorMs += dtMs;
      let guard = 0;
      while (this.battleLeftAccumulatorMs >= interval && guard < 5 && !this.roundOver && !this.matchOver) {
        this.battleTurn("left"); this.battleLeftAccumulatorMs -= interval; guard++;
      }
      guard = 0;
      while (this.battleRightAccumulatorMs >= interval && guard < 5 && !this.roundOver && !this.matchOver) {
        this.battleTurn("right"); this.battleRightAccumulatorMs -= interval; guard++;
      }
    }
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (!settingsModal.classList.contains("hidden")) return;
    if (gameKeys().has(e.key)) e.preventDefault();
    if (isBound(e, settings.keys.reset)) {
      if (this.mode === "human_vs_ai") this.startHumanMatch();
      else this.resetMatch();
      return;
    }
    if (this.roundOver) { if (isBound(e, settings.keys.nextRound)) this.nextRound(); return; }
    if (this.matchOver || this.mode !== "human_vs_ai" || !this.matchStarted) return;
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
  if (trainer.mode !== "ai_vs_ai" || settings.aiPps <= 15 || trainer.roundOver || trainer.matchOver) {
    lastFullRenderAt = now;
    lastFullRenderStep = trainer.stepIndex;
    return false;
  }

  const stepDelta = trainer.stepIndex - lastFullRenderStep;
  const minStepDelta = settings.aiPps >= 19 ? 6 : 4;
  const maxSilentMs = 220;

  if (stepDelta < minStepDelta && now - lastFullRenderAt < maxSilentMs) {
    return true;
  }

  lastFullRenderAt = now;
  lastFullRenderStep = trainer.stepIndex;
  return false;
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
  const leftName = trainer.mode === "ai_vs_ai" ? trainer.battleLeftName : "Human";
  const rightName = trainer.mode === "ai_vs_ai" ? trainer.battleRightName : "AI";
  const startState = trainer.mode === "human_vs_ai" && !trainer.matchStarted ? "WAITING: press R" : trainer.modeLabel();
  ctx.fillText(`FT${trainer.firstTo}   ${leftName} ${trainer.score.human} - ${trainer.score.ai} ${rightName}   |   ${startState}   |   ${playingText}`, 26, 70);
  ctx.fillStyle = trainer.roundOver ? "#fbbf24" : "#94a3b8";
  ctx.fillText(trainer.message, 26, 94);
  const boardY = 180;
  const cell = Math.max(15, Math.min(20, Math.floor((h - boardY - 120) / 20)));
  drawBoard(ctx, trainer.human, { x: 24, y: boardY, cell, title: leftName, showGhost: trainer.mode === "human_vs_ai", active: true });
  drawBoard(ctx, trainer.aiEngine, { x: 540, y: boardY, cell, title: rightName, showGhost: false, active: true });
  const panelX = 1068;
  const panelY = boardY;
  const panelW = Math.max(300, w - panelX - 26);
  const panelH = Math.max(420, h - panelY - 18);
  const lines: Array<[string, string?]> = [
    ["Mode", "#38bdf8"],
    [trainer.modeLabel()],
    trainer.mode === "ai_vs_ai" ? [`${trainer.battleLeftName} vs ${trainer.battleRightName}`, "#94a3b8"] : [`Human vs ${trainer.aiName}`, "#94a3b8"],
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
    [`Logs: ${trainer.mode === "ai_vs_ai" ? trainer.selfplayLogger.records.length + trainer.selfplayLogger.roundBuffer.length : trainer.logger.records.length + trainer.logger.roundBuffer.length}`, "#94a3b8"],
    [`ID: ${trainer.logger.anonymousPlayerId.slice(0, 8)}...`, "#94a3b8"]
  ];
  drawPanel(ctx, panelX, panelY, panelW, panelH, "Status", lines);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px Consolas";
  ctx.fillText("AI Battle uploads to selfplay/ and is never mixed into human raw/ logs.", 26, h - 18);
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
  if (trainer.mode === "ai_vs_ai") {
    trainer.selfplayLogger.download();
    setStatus("Downloaded current selfplay log.");
  } else {
    trainer.logger.download();
    setStatus("Downloaded current match log.");
  }
});
copyBtn.addEventListener("click", async () => {
  const text = trainer.mode === "ai_vs_ai" ? trainer.selfplayLogger.toJsonl(true) : trainer.logger.toJsonl(true);
  await navigator.clipboard.writeText(text);
  setStatus(trainer.mode === "ai_vs_ai" ? "Copied selfplay logs to clipboard." : "Copied logs to clipboard.");
});
clearBtn.addEventListener("click", () => {
  trainer.logger.clearLocal();
  trainer.selfplayLogger.clearLocal();
  setStatus("Cleared local saved log copies. Current in-memory match remains.");
});
uploadBtn.addEventListener("click", async () => {
  try {
    if (trainer.mode === "ai_vs_ai") {
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
