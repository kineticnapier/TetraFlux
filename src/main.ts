import "./style.css";
import { HeuristicAI } from "./ai/heuristic";
import type { AiChoice } from "./ai/heuristic";
import { WebPolicyAI } from "./ai/webPolicy";
import { TetrisEngine, type PlacementAction, type PieceState } from "./engine/tetris";
import { MovementInput } from "./input";
import { MatchLogger, uploadLogs } from "./logging";
import { drawBoard, drawPanel } from "./render";

type Winner = "human" | "ai";
type AutoUploadStatus = "idle" | "uploading" | "uploaded" | "failed" | "skipped";

interface AiLike {
  choose(engine: TetrisEngine): AiChoice | null;
}

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;

const newMatchBtn = document.querySelector<HTMLButtonElement>("#newMatch")!;
const nextRoundBtn = document.querySelector<HTMLButtonElement>("#nextRound")!;
const downloadBtn = document.querySelector<HTMLButtonElement>("#downloadLogs")!;
const uploadBtn = document.querySelector<HTMLButtonElement>("#uploadLogs")!;
const copyBtn = document.querySelector<HTMLButtonElement>("#copyLogs")!;
const clearBtn = document.querySelector<HTMLButtonElement>("#clearLogs")!;

const aiPpsInput = document.querySelector<HTMLInputElement>("#aiPps")!;
const dasInput = document.querySelector<HTMLInputElement>("#dasMs")!;
const arrInput = document.querySelector<HTMLInputElement>("#arrMs")!;
const sdfInput = document.querySelector<HTMLInputElement>("#sdf")!;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function numInput(input: HTMLInputElement, fallback: number): number {
  const n = Number(input.value);
  return Number.isFinite(n) ? n : fallback;
}

function seedNow(): number {
  return (Date.now() ^ Math.floor(Math.random() * 1_000_000_000)) >>> 0;
}

function short(text: unknown, max = 86): string {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
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

  return {
    rawAttack,
    canceled,
    sent,
    remainingIncoming: sender.pendingGarbage
  };
}

function applyRemainingGarbageAfterCounter(engine: TetrisEngine): void {
  // TETR.IO-like flow:
  // 1. Lock piece and calculate attack.
  // 2. Outgoing attack cancels this player's visible incoming garbage first.
  // 3. Any remaining incoming garbage materializes after the lock.
  engine.applyPendingGarbage();
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

  constructor() {
    this.resetRound();
  }

  setAi(ai: AiLike, name: string, details: string[] = []): void {
    this.ai = ai;
    this.aiName = name;
    this.aiDetails = details;
    setStatus(`AI loaded: ${name}`);
  }

  inputSettings() {
    return {
      dasMs: Math.max(0, numInput(dasInput, 130)),
      arrMs: Math.max(0, numInput(arrInput, 10)),
      sdfCellsPerSecond: Math.max(1, Math.min(240, numInput(sdfInput, 30)))
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
      this.message = `Round winner: ${winner}. Press Enter or Next Round.`;
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
      key: `${usedHold ? "H:" : ""}${activeBefore.kind}:${activeBefore.x}:${rot}`
    };

    this.logger.logHumanMove({
      roundIndex: this.roundIndex,
      stepIndex: this.stepIndex,
      state: stateBefore,
      aiState: aiStateBefore,
      action,
      result
    });

    applyAttack(this.human, this.aiEngine, result.attackSent);
    applyRemainingGarbageAfterCounter(this.human);

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
    applyRemainingGarbageAfterCounter(this.aiEngine);
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

    const pps = Math.max(0.1, Math.min(20, numInput(aiPpsInput, 1.4)));
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
    const gameKeys = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " ", "z", "x", "a", "c", "Shift", "Enter"];
    if (gameKeys.includes(e.key)) e.preventDefault();

    if (e.key === "q" || e.key === "Escape") return;
    if (e.key === "r") {
      this.resetMatch();
      return;
    }

    if (this.roundOver) {
      if (e.key === "Enter") this.nextRound();
      return;
    }

    if (this.matchOver) return;

    const now = performance.now();
    if (this.input.keyDown(e.key, now)) return;

    if (e.key === "ArrowUp" || e.key === "x") {
      if (this.human.rotateCw()) this.input.notifyTransform(now);
    } else if (e.key === "z") {
      if (this.human.rotateCcw()) this.input.notifyTransform(now);
    } else if (e.key === "a") {
      if (this.human.rotate180()) this.input.notifyTransform(now);
    } else if (e.key === "c" || e.key === "Shift") {
      const beforeKind = this.human.active.kind;
      const beforeHold = this.human.hold;
      const ok = this.human.holdPiece();
      if (ok && (this.human.active.kind !== beforeKind || this.human.hold !== beforeHold)) {
        this.input.resetRepeatAfterPieceChange(now);
      }
    } else if (e.key === " ") {
      this.humanHardDrop();
    }
  }

  handleKeyUp(e: KeyboardEvent): void {
    this.input.keyUp(e.key, performance.now());
  }
}

const trainer = new Ft5Trainer();

async function loadAiModel(): Promise<void> {
  const modelUrl = `${import.meta.env.BASE_URL}models/web_policy.json`;
  const ai = await WebPolicyAI.load(modelUrl);
  if (ai) {
    trainer.setAi(ai, ai.displayName(), ai.infoLines());
  } else {
    trainer.setAi(new HeuristicAI(), "HeuristicAI fallback", [`No model JSON found at ${modelUrl}`]);
  }
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
  ctx.fillText(`FT${trainer.firstTo}   Human ${trainer.score.human} - ${trainer.score.ai} AI   |   ${trainer.aiName}   |   ${numInput(aiPpsInput, 1.4).toFixed(1)} mino/s`, 26, 70);

  ctx.fillStyle = trainer.roundOver ? "#fbbf24" : "#94a3b8";
  ctx.fillText(trainer.message, 26, 94);

  const boardY = 180;
  const cell = Math.max(15, Math.min(20, Math.floor((h - boardY - 120) / 20)));

  drawBoard(ctx, trainer.human, { x: 24, y: boardY, cell, title: "Human", showGhost: true, active: true });
  drawBoard(ctx, trainer.aiEngine, { x: 540, y: boardY, cell, title: "AI", showGhost: false, active: true });

  const panelX = 1068;
  const panelY = boardY;
  const panelW = Math.max(300, w - panelX - 26);
  const panelH = Math.max(560, Math.min(800, h - panelY - 36));
  const sdf = numInput(sdfInput, 30);
  const lines: Array<[string, string?]> = [
    ["AI", "#38bdf8"],
    [`${trainer.aiName}`],
    ...trainer.aiDetails.slice(0, 12).map((line) => [line, "#94a3b8"] as [string, string]),
    [""],
    ["Auto upload", "#38bdf8"],
    [`status: ${trainer.autoUploadStatus}`],
    [short(trainer.autoUploadDetail, 52), trainer.autoUploadStatus === "failed" ? "#f87171" : "#94a3b8"],
    [""],
    ["Input", "#38bdf8"],
    [`DAS=${numInput(dasInput, 130)}ms ARR=${numInput(arrInput, 10)}ms`],
    [`SDF=${sdf} cells/s${sdf > 60 ? " = instant" : ""}`],
    [""],
    ["Garbage", "#38bdf8"],
    [`Human incoming=${trainer.human.pendingGarbage}`],
    [`AI incoming=${trainer.aiEngine.pendingGarbage}`],
    ["Attack cancels own incoming first"],
    [""],
    ["Controls", "#38bdf8"],
    ["←/→ hold : DAS/ARR move"],
    ["↓ hold   : SDF soft drop"],
    ["Z/X/A    : CCW/CW/180"],
    ["C/Shift  : hold"],
    ["Space    : hard drop"],
    ["Enter    : next round"],
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
