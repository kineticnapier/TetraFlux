import "./style.css";
import { HeuristicAI } from "./ai/heuristic";
import type { AiChoice } from "./ai/heuristic";
import { WebPolicyAI } from "./ai/webPolicy";
import { TetrisEngine, type PlacementAction, type PieceState } from "./engine/tetris";
import { MovementInput, type LogicalMoveKey } from "./input";
import { MatchLogger, uploadLogs } from "./logging";
import { PresenceClient } from "./presence";
import { drawBoard, drawPanel } from "./render";

type Winner = "human" | "ai";
type AutoUploadStatus = "idle" | "uploading" | "uploaded" | "failed" | "skipped";

interface AiLike {
  choose(engine: TetrisEngine): AiChoice | null;
}

interface KeyBindings {
  left: string[];
  right: string[];
  softDrop: string[];
  rotateCw: string[];
  rotateCcw: string[];
  rotate180: string[];
  hold: string[];
  hardDrop: string[];
  nextRound: string[];
  reset: string[];
}

interface GameSettings {
  aiPps: number;
  dasMs: number;
  arrMs: number;
  sdfCellsPerSecond: number;
  gravityCellsPerSecond: number;
  lockDelayMs: number;
  keys: KeyBindings;
}

const DEFAULT_SETTINGS: GameSettings = {
  aiPps: 1.4,
  dasMs: 130,
  arrMs: 10,
  sdfCellsPerSecond: 30,
  gravityCellsPerSecond: 1,
  lockDelayMs: 500,
  keys: {
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    softDrop: ["ArrowDown"],
    hardDrop: [" "],
    rotateCcw: ["Control", "z"],
    rotateCw: ["ArrowUp", "x"],
    rotate180: ["a"],
    hold: ["Shift", "c"],
    nextRound: ["Enter"],
    reset: ["r"],
  },
};

const SETTINGS_KEY = "tetraflux_settings_v2_multikey";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;

const newMatchBtn = document.querySelector<HTMLButtonElement>("#newMatch")!;
const nextRoundBtn = document.querySelector<HTMLButtonElement>("#nextRound")!;
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

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function cloneSettings(s: GameSettings): GameSettings {
  return JSON.parse(JSON.stringify(s)) as GameSettings;
}

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

    const defaultKeys = DEFAULT_SETTINGS.keys;
    const parsedKeys = (parsed.keys ?? {}) as Partial<Record<keyof KeyBindings, unknown>>;

    return {
      ...cloneSettings(DEFAULT_SETTINGS),
      ...parsed,
      keys: {
        left: asKeyArray(parsedKeys.left, defaultKeys.left),
        right: asKeyArray(parsedKeys.right, defaultKeys.right),
        softDrop: asKeyArray(parsedKeys.softDrop, defaultKeys.softDrop),
        rotateCw: asKeyArray(parsedKeys.rotateCw, defaultKeys.rotateCw),
        rotateCcw: asKeyArray(parsedKeys.rotateCcw, defaultKeys.rotateCcw),
        rotate180: asKeyArray(parsedKeys.rotate180, defaultKeys.rotate180),
        hold: asKeyArray(parsedKeys.hold, defaultKeys.hold),
        hardDrop: asKeyArray(parsedKeys.hardDrop, defaultKeys.hardDrop),
        nextRound: asKeyArray(parsedKeys.nextRound, defaultKeys.nextRound),
        reset: asKeyArray(parsedKeys.reset, defaultKeys.reset),
      },
    };
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

function saveSettingsToStorage(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

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

function keysLabel(keys: string[]): string {
  return keys.map(keyLabel).join(", ");
}

function parseKeyList(text: string, fallback: string[]): string[] {
  const parts = text
    .split(",")
    .map((x) => keyValue(x))
    .filter((x) => x.length > 0);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
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

  for (const [k, input] of Object.entries(keyInputs) as Array<[keyof KeyBindings, HTMLInputElement]>) {
    input.value = keysLabel(settings.keys[k]);
  }
}

function readSettingsFromDom(): void {
  settings.aiPps = Math.max(0.1, Math.min(20, numInput(aiPpsInput, DEFAULT_SETTINGS.aiPps)));
  settings.dasMs = Math.max(0, Math.min(500, numInput(dasInput, DEFAULT_SETTINGS.dasMs)));
  settings.arrMs = Math.max(0, Math.min(200, numInput(arrInput, DEFAULT_SETTINGS.arrMs)));
  settings.sdfCellsPerSecond = Math.max(1, Math.min(240, numInput(sdfInput, DEFAULT_SETTINGS.sdfCellsPerSecond)));
  settings.gravityCellsPerSecond = Math.max(0, Math.min(60, numInput(gravityInput, DEFAULT_SETTINGS.gravityCellsPerSecond)));
  settings.lockDelayMs = Math.max(0, Math.min(3000, numInput(lockDelayInput, DEFAULT_SETTINGS.lockDelayMs)));

  for (const [k, input] of Object.entries(keyInputs) as Array<[keyof KeyBindings, HTMLInputElement]>) {
    settings.keys[k] = parseKeyList(input.value, DEFAULT_SETTINGS.keys[k]);
  }

  saveSettingsToStorage();
}

function openSettings(): void {
  applySettingsToDom();
  settingsModal.classList.remove("hidden");
  settingsModal.setAttribute("aria-hidden", "false");
}

function closeSettings(): void {
  settingsModal.classList.add("hidden");
  settingsModal.setAttribute("aria-hidden", "true");
}

function bindSettingsUi(): void {
  for (const input of Object.values(keyInputs)) {
    input.addEventListener("keydown", (e) => {
      e.preventDefault();
      input.value = keyLabel(e.key);
    });
  }

  settingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  saveSettingsBtn.addEventListener("click", () => {
    readSettingsFromDom();
    closeSettings();
    setStatus("Settings saved.");
  });

  resetSettingsBtn.addEventListener("click", () => {
    settings = cloneSettings(DEFAULT_SETTINGS);
    saveSettingsToStorage();
    applySettingsToDom();
    setStatus("Settings reset.");
  });
}

function seedNow(): number {
  return (Date.now() ^ Math.floor(Math.random() * 1_000_000_000)) >>> 0;
}

function short(text: unknown, max = 86): string {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function isBound(e: KeyboardEvent, keys: string[]): boolean {
  return keys.includes(e.key);
}

function gameKeys(): Set<string> {
  return new Set(Object.values(settings.keys).flat());
}

interface GarbageResolveResult {
  rawAttack: number;
  canceled: number;
  sent: number;
  remainingIncoming: number;
}

function applyAttack(sender: TetrisEngine, receiver: TetrisEngine, amount: number): GarbageResolveResult {
  const rawAttack = Math.max(0, Math.floor(amount));
  let atk = rawAttack;

  const canceled = Math.min(sender.pendingGarbage, atk);
  sender.pendingGarbage -= canceled;
  atk -= canceled;

  const sent = atk;
  if (sent > 0) receiver.queueGarbage(sent);

  return { rawAttack, canceled, sent, remainingIncoming: sender.pendingGarbage };
}

function shouldMaterializeGarbageAfterLock(result: { rawAttack: number; linesCleared: number }): boolean {
  return result.rawAttack <= 0 && result.linesCleared <= 0;
}

function applyRemainingGarbageAfterCounter(engine: TetrisEngine, result: { rawAttack: number; linesCleared: number }): void {
  if (shouldMaterializeGarbageAfterLock(result)) engine.applyPendingGarbage();
}

class Ft5Trainer {
  firstTo = 5;
  baseSeed = seedNow();
  roundIndex = 0;
  stepIndex = 0;
  score = { human: 0, ai: 0 };
  roundOver = false;
  matchOver = false;
  roundWinner: Winner | null = null;
  message = "";

  human!: TetrisEngine;
  aiEngine!: TetrisEngine;
  ai: AiLike = new HeuristicAI();
  aiName = "HeuristicAI";
  aiDetails: string[] = ["No model JSON found, fallback"];
  logger = new MatchLogger();
  input!: MovementInput;
  aiAccumulatorMs = 0;

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

  setAi(ai: AiLike, name: string, details: string[] = []): void {
    this.ai = ai;
    this.aiName = name;
    this.aiDetails = details;
    setStatus(`AI loaded: ${name}`);
  }

  inputSettings() {
    return {
      dasMs: settings.dasMs,
      arrMs: settings.arrMs,
      sdfCellsPerSecond: settings.sdfCellsPerSecond,
    };
  }

  resetMatch(): void {
    this.baseSeed = seedNow();
    this.roundIndex = 0;
    this.stepIndex = 0;
    this.score = { human: 0, ai: 0 };
    this.roundOver = false;
    this.matchOver = false;
    this.roundWinner = null;
    this.logger = new MatchLogger();
    this.presence.stop();
    this.presence = new PresenceClient(this.logger.anonymousPlayerId);
    this.presence.start();
    this.autoUploadStatus = "idle";
    this.autoUploadDetail = "match end upload enabled";
    this.autoUploadInFlight = false;
    this.autoUploadedMatchId = null;
    this.resetRound();
    setStatus("New FT5 match started.");
  }

  resetRound(): void {
    const seed = (this.baseSeed + this.roundIndex * 1009) >>> 0;
    this.human = new TetrisEngine(seed, seed + 17);
    this.aiEngine = new TetrisEngine(seed, seed + 31);
    this.input = new MovementInput(this.human, () => this.inputSettings());
    this.aiAccumulatorMs = 0;
    this.humanGravityCarry = 0;
    this.humanGroundedSince = null;
    this.roundOver = false;
    this.roundWinner = null;
    this.stepIndex = 0;
    this.message = `Round ${this.roundIndex + 1}: async play.`;
  }

  finishRound(winner: Winner): void {
    if (this.roundOver) return;
    this.roundOver = true;
    this.roundWinner = winner;
    this.score[winner] += 1;
    this.logger.finishRound(winner, this.score);

    if (this.score.human >= this.firstTo || this.score.ai >= this.firstTo) {
      this.matchOver = true;
      this.message = `Match over: ${winner} wins FT${this.firstTo}. Auto-uploading logs...`;
      this.autoUploadFinishedMatch();
    } else {
      this.message = `Round winner: ${winner}. Press ${keysLabel(settings.keys.nextRound)} or Next Round.`;
    }
  }

  private autoUploadFinishedMatch(): void {
    const matchId = this.logger.matchId;
    if (this.autoUploadInFlight) return;
    if (this.autoUploadedMatchId === matchId) return;

    const jsonl = this.logger.toJsonl(false);
    const rows = jsonl.trim() ? jsonl.trim().split(/\r?\n/).length : 0;

    if (!jsonl.trim()) {
      this.autoUploadStatus = "skipped";
      this.autoUploadDetail = "no completed logs to upload";
      this.message = "Match over. Auto-upload skipped: no logs.";
      setStatus(this.message);
      return;
    }

    this.autoUploadInFlight = true;
    this.autoUploadStatus = "uploading";
    this.autoUploadDetail = `${rows} rows, match ${matchId.slice(0, 8)}...`;
    setStatus(`Auto-uploading ${rows} rows...`);

    void uploadLogs(jsonl)
      .then((res) => {
        this.autoUploadInFlight = false;
        this.autoUploadedMatchId = matchId;
        this.autoUploadStatus = "uploaded";
        this.autoUploadDetail = short(res, 110);
        this.message = `Match over. Logs auto-uploaded (${rows} rows).`;
        setStatus(this.message);
      })
      .catch((err) => {
        this.autoUploadInFlight = false;
        this.autoUploadStatus = "failed";
        this.autoUploadDetail = short(err instanceof Error ? err.message : String(err), 110);
        this.message = "Match over. Auto-upload failed; use Download Logs or Upload Logs.";
        setStatus(`${this.message} ${this.autoUploadDetail}`);
      });
  }

  nextRound(): void {
    if (!this.roundOver || this.matchOver) return;
    this.roundIndex++;
    this.resetRound();
  }

  private resetHumanGroundTimer(): void {
    this.humanGroundedSince = null;
  }

  private isHumanGrounded(): boolean {
    return this.human.hardDropDistance(this.human.active) <= 0;
  }

  private updateHumanGravity(dtMs: number, now: number): void {
    if (this.roundOver || this.matchOver || this.human.dead) return;

    const gravity = Math.max(0, settings.gravityCellsPerSecond);
    if (gravity > 0) {
      this.humanGravityCarry += (dtMs / 1000) * gravity;
      const steps = Math.min(20, Math.floor(this.humanGravityCarry));
      if (steps > 0) this.humanGravityCarry -= steps;

      for (let i = 0; i < steps; i++) {
        const moved = this.human.move(0, 1);
        if (moved) this.resetHumanGroundTimer();
        else break;
      }
    }

    if (this.isHumanGrounded()) {
      if (this.humanGroundedSince === null) this.humanGroundedSince = now;
      if (now - this.humanGroundedSince >= settings.lockDelayMs) this.humanLockCurrent(now);
    } else {
      this.humanGroundedSince = null;
    }
  }

  private humanLockCurrent(now: number): void {
    if (this.roundOver || this.matchOver || this.human.dead) return;

    const stateBefore = this.human.stateDict();
    const aiStateBefore = this.aiEngine.stateDict();
    const activeBefore: PieceState = { ...this.human.active };
    const usedHold = this.human.holdUsedForCurrentPiece;

    const result = this.human.lockPiece();
    const rot = ((activeBefore.rot % 4) + 4) % 4;
    const action: PlacementAction = {
      piece: activeBefore.kind,
      x: activeBefore.x,
      rot,
      hold: usedHold,
      key: `${usedHold ? "H:" : ""}${activeBefore.kind}:${activeBefore.x}:${rot}`,
    };

    this.logger.logHumanMove({
      roundIndex: this.roundIndex,
      stepIndex: this.stepIndex,
      state: stateBefore,
      aiState: aiStateBefore,
      action,
      result,
    });

    applyAttack(this.human, this.aiEngine, result.attackSent);
    applyRemainingGarbageAfterCounter(this.human, result);

    this.humanGravityCarry = 0;
    this.humanGroundedSince = null;

    if (this.human.dead || result.topout) {
      this.finishRound("ai");
      return;
    }

    this.input.resetRepeatAfterPieceChange(now);
  }

  humanHardDrop(): void {
    if (this.roundOver || this.matchOver || this.human.dead) return;

    const stateBefore = this.human.stateDict();
    const aiStateBefore = this.aiEngine.stateDict();
    const activeBefore: PieceState = { ...this.human.active };
    const usedHold = this.human.holdUsedForCurrentPiece;

    const result = this.human.hardDrop();
    const rot = ((activeBefore.rot % 4) + 4) % 4;
    const action: PlacementAction = {
      piece: activeBefore.kind,
      x: activeBefore.x,
      rot,
      hold: usedHold,
      key: `${usedHold ? "H:" : ""}${activeBefore.kind}:${activeBefore.x}:${rot}`,
    };

    this.logger.logHumanMove({
      roundIndex: this.roundIndex,
      stepIndex: this.stepIndex,
      state: stateBefore,
      aiState: aiStateBefore,
      action,
      result,
    });

    applyAttack(this.human, this.aiEngine, result.attackSent);
    applyRemainingGarbageAfterCounter(this.human, result);

    this.humanGravityCarry = 0;
    this.humanGroundedSince = null;

    if (this.human.dead || result.topout) {
      this.finishRound("ai");
      return;
    }

    this.input.resetRepeatAfterPieceChange(performance.now());
  }

  aiTurn(): void {
    if (this.roundOver || this.matchOver || this.aiEngine.dead) return;

    const action = this.ai.choose(this.aiEngine);
    if (!action) {
      this.finishRound("human");
      return;
    }

    const result = this.aiEngine.applyAction(action);
    applyAttack(this.aiEngine, this.human, result.attackSent);
    applyRemainingGarbageAfterCounter(this.aiEngine, result);
    this.stepIndex++;

    if (this.aiEngine.dead || result.topout) {
      this.finishRound("human");
      return;
    }

    if (this.human.dead) this.finishRound("ai");
  }

  update(dtMs: number, now: number): void {
    if (this.roundOver || this.matchOver) return;

    this.input.update(now);
    this.updateHumanGravity(dtMs, now);

    const pps = Math.max(0.1, Math.min(20, settings.aiPps));
    const interval = 1000 / pps;
    this.aiAccumulatorMs += dtMs;

    let guard = 0;
    while (this.aiAccumulatorMs >= interval && guard < 5 && !this.roundOver && !this.matchOver) {
      this.aiTurn();
      this.aiAccumulatorMs -= interval;
      guard++;
    }
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (settingsModal.classList.contains("hidden") === false) return;

    if (gameKeys().has(e.key)) e.preventDefault();

    if (isBound(e, settings.keys.reset)) {
      this.resetMatch();
      return;
    }

    if (this.roundOver) {
      if (isBound(e, settings.keys.nextRound)) this.nextRound();
      return;
    }

    if (this.matchOver) return;

    const now = performance.now();

    let logical: LogicalMoveKey | null = null;
    if (isBound(e, settings.keys.left)) logical = "left";
    else if (isBound(e, settings.keys.right)) logical = "right";
    else if (isBound(e, settings.keys.softDrop)) logical = "down";

    if (logical) {
      this.input.keyDown(logical, now);
      this.resetHumanGroundTimer();
      return;
    }

    if (isBound(e, settings.keys.rotateCw)) {
      if (this.human.rotateCw()) {
        this.input.notifyTransform(now);
        this.resetHumanGroundTimer();
      }
    } else if (isBound(e, settings.keys.rotateCcw)) {
      if (this.human.rotateCcw()) {
        this.input.notifyTransform(now);
        this.resetHumanGroundTimer();
      }
    } else if (isBound(e, settings.keys.rotate180)) {
      if (this.human.rotate180()) {
        this.input.notifyTransform(now);
        this.resetHumanGroundTimer();
      }
    } else if (isBound(e, settings.keys.hold)) {
      const beforeKind = this.human.active.kind;
      const beforeHold = this.human.hold;
      const ok = this.human.holdPiece();
      if (ok && (this.human.active.kind !== beforeKind || this.human.hold !== beforeHold)) {
        this.input.resetRepeatAfterPieceChange(now);
        this.resetHumanGroundTimer();
      }
    } else if (isBound(e, settings.keys.hardDrop)) {
      this.humanHardDrop();
    }
  }

  handleKeyUp(e: KeyboardEvent): void {
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
  if (ai) trainer.setAi(ai, ai.displayName(), ai.infoLines());
  else trainer.setAi(new HeuristicAI(), "HeuristicAI fallback", [`No model JSON found at ${modelUrl}`]);
}

function resizeCanvasForDisplay(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const ww = Math.floor(rect.width * dpr);
  const hh = Math.floor(rect.height * dpr);
  if (canvas.width !== ww || canvas.height !== hh) {
    canvas.width = ww;
    canvas.height = hh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function render(): void {
  presenceBadge.textContent = trainer.presence.status;

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
  ctx.fillText(
    `FT${trainer.firstTo}   Human ${trainer.score.human} - ${trainer.score.ai} AI   |   ${trainer.aiName}   |   playing ${trainer.presence.online || "?"}`,
    26,
    70
  );

  ctx.fillStyle = trainer.roundOver ? "#fbbf24" : "#94a3b8";
  ctx.fillText(trainer.message, 26, 94);

  const boardY = 180;
  const cell = Math.max(15, Math.min(20, Math.floor((h - boardY - 120) / 20)));

  drawBoard(ctx, trainer.human, { x: 24, y: boardY, cell, title: "Human", showGhost: true, active: true });
  drawBoard(ctx, trainer.aiEngine, { x: 540, y: boardY, cell, title: "AI", showGhost: false, active: true });

  const panelX = 1068;
  const panelY = boardY;
  const panelW = Math.max(300, w - panelX - 26);
  const panelH = Math.max(430, Math.min(720, h - panelY - 36));

  const lines: Array<[string, string?]> = [
    ["AI", "#38bdf8"],
    [`${trainer.aiName}`],
    ...trainer.aiDetails.slice(0, 10).map((line) => [line, "#94a3b8"] as [string, string]),
    [""],
    ["Online", "#38bdf8"],
    [`playing now: ${trainer.presence.online || "?"}`],
    [trainer.presence.status, "#94a3b8"],
    [""],
    ["Auto upload", "#38bdf8"],
    [`status: ${trainer.autoUploadStatus}`],
    [short(trainer.autoUploadDetail, 52), trainer.autoUploadStatus === "failed" ? "#f87171" : "#94a3b8"],
    [""],
    ["Controls", "#38bdf8"],
    [`${keysLabel(settings.keys.left)}/${keysLabel(settings.keys.right)} : move`],
    [`${keysLabel(settings.keys.softDrop)} : soft drop`],
    [`${keysLabel(settings.keys.rotateCcw)}/${keysLabel(settings.keys.rotateCw)}/${keysLabel(settings.keys.rotate180)} : rotate`],
    [`${keysLabel(settings.keys.hold)} : hold`],
    [`${keysLabel(settings.keys.hardDrop)} : hard drop`],
    [""],
    [`Logs: ${trainer.logger.records.length + trainer.logger.roundBuffer.length} moves`, "#94a3b8"],
    [`ID: ${trainer.logger.anonymousPlayerId.slice(0, 8)}...`, "#94a3b8"]
  ];
  drawPanel(ctx, panelX, panelY, panelW, panelH, "Status", lines);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px Consolas";
  ctx.fillText("This is a local web trainer. It does not connect to TETR.IO.", 26, h - 18);

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
downloadBtn.addEventListener("click", () => {
  trainer.logger.download();
  setStatus("Downloaded current match log.");
});
copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(trainer.logger.toJsonl(true));
  setStatus("Copied logs to clipboard.");
});
clearBtn.addEventListener("click", () => {
  trainer.logger.clearLocal();
  setStatus("Cleared local saved log copy. Current in-memory match remains.");
});
uploadBtn.addEventListener("click", async () => {
  try {
    const text = trainer.logger.toJsonl(true);
    if (!text.trim()) {
      setStatus("No logs to upload.");
      return;
    }
    const res = await uploadLogs(text);
    setStatus(`Uploaded logs: ${res.slice(0, 120)}`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  }
});

loadAiModel();
render();
requestAnimationFrame(tick);
