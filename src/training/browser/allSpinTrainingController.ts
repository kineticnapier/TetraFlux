import {
  ALLSPIN_CHECKPOINT_STORAGE_KEY,
  clearStoredAllSpinProfile,
  readStoredAllSpinProfileSync,
  writeStoredAllSpinProfile,
} from "../browserAllSpinProfile";
import { readStoredHeuristicProfileSync } from "../browserHeuristicProfile";
import {
  checkpointBestAllSpinProfile,
  createInitialAllSpinCheckpoint,
  parseAllSpinTrainingCheckpoint,
  type AllSpinTrainingCheckpoint,
  type AllSpinTrainingConfig,
} from "../allspinTrainer";
import {
  parseAllSpinWeightProfile,
  type AllSpinSearchProfile,
  type AllSpinWeightProfileV1,
} from "../allspinWeights";
import type { HeuristicWeightProfileV1 } from "../heuristicWeights";

export interface AllSpinTrainingRunRequest {
  generations: number;
  parallelWorkers: number;
  config: Partial<AllSpinTrainingConfig>;
  search: Partial<AllSpinSearchProfile>;
  checkpoint?: AllSpinTrainingCheckpoint | null;
  initialProfile?: AllSpinWeightProfileV1 | null;
  parentModelId?: string;
}

export interface AllSpinTrainingControllerState {
  running: boolean;
  baseProfile: HeuristicWeightProfileV1 | null;
  checkpoint: AllSpinTrainingCheckpoint | null;
  profile: AllSpinWeightProfileV1 | null;
}

export interface AllSpinTrainingControllerEvents {
  onState?: (state: AllSpinTrainingControllerState) => void;
  onStarted?: (message: any) => void;
  onCandidate?: (message: any) => void;
  onGeneration?: (message: any) => void;
  onFinished?: (message: any) => void;
  onError?: (message: string) => void;
}

function readCheckpoint(): AllSpinTrainingCheckpoint | null {
  try {
    const raw = localStorage.getItem(ALLSPIN_CHECKPOINT_STORAGE_KEY);
    return raw ? parseAllSpinTrainingCheckpoint(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export class AllSpinTrainingController {
  private worker: Worker | null = null;
  private baseProfile: HeuristicWeightProfileV1 | null = readStoredHeuristicProfileSync();
  private checkpoint: AllSpinTrainingCheckpoint | null = readCheckpoint();
  private profile: AllSpinWeightProfileV1 | null = readStoredAllSpinProfileSync()
    ?? (this.checkpoint ? checkpointBestAllSpinProfile(this.checkpoint) : null);
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly events: AllSpinTrainingControllerEvents = {}) {
    if (this.profile) void writeStoredAllSpinProfile(this.profile);
    this.emitState();
  }

  get state(): AllSpinTrainingControllerState {
    return {
      running: this.worker !== null,
      baseProfile: this.baseProfile,
      checkpoint: this.checkpoint,
      profile: this.profile,
    };
  }

  refreshBaseProfile(): HeuristicWeightProfileV1 | null {
    this.baseProfile = readStoredHeuristicProfileSync();
    this.emitState();
    return this.baseProfile;
  }

  start(request: AllSpinTrainingRunRequest): void {
    if (this.worker) throw new Error("All-Spin training is already running");
    const baseProfile = this.baseProfile ?? this.refreshBaseProfile();
    if (!baseProfile && !request.checkpoint && !request.initialProfile) {
      throw new Error("A Learned Heuristic profile is required before All-Spin training");
    }

    let checkpoint = request.checkpoint ?? null;
    if (!checkpoint && request.initialProfile) {
      const profile = parseAllSpinWeightProfile(request.initialProfile);
      checkpoint = createInitialAllSpinCheckpoint({
        baseHeuristic: profile.baseHeuristic,
        config: request.config,
        weights: profile.weights,
        search: request.search ?? profile.search,
        parentModelId: request.parentModelId ?? profile.training?.parentModelId,
      });
    }
    if (!checkpoint) {
      checkpoint = createInitialAllSpinCheckpoint({
        baseHeuristic: baseProfile,
        config: request.config,
        search: request.search,
        parentModelId: request.parentModelId,
      });
    }

    const worker = new Worker(new URL("../allspinTrainingWorker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    this.emitState();
    worker.onmessage = (event: MessageEvent<any>) => {
      this.queue = this.queue
        .then(() => this.handleMessage(event.data))
        .catch((error) => this.fail(error instanceof Error ? error.message : String(error)));
    };
    worker.onerror = (event) => this.fail(`All-Spin training worker crashed: ${event.message}`);
    worker.postMessage({
      type: "run",
      generations: request.generations,
      parallelWorkers: request.parallelWorkers,
      checkpoint,
    });
  }

  resume(request: Omit<AllSpinTrainingRunRequest, "checkpoint" | "initialProfile">): void {
    if (!this.checkpoint) throw new Error("No saved All-Spin checkpoint");
    this.start({ ...request, checkpoint: this.checkpoint });
  }

  cancel(): void {
    this.worker?.postMessage({ type: "cancel" });
  }

  async importProfile(input: unknown): Promise<AllSpinWeightProfileV1> {
    const profile = parseAllSpinWeightProfile(input);
    this.profile = await writeStoredAllSpinProfile(profile);
    this.baseProfile = profile.baseHeuristic;
    this.emitState();
    return profile;
  }

  async importCheckpoint(input: unknown): Promise<AllSpinTrainingCheckpoint> {
    const checkpoint = parseAllSpinTrainingCheckpoint(input);
    await this.saveCheckpoint(checkpoint);
    return checkpoint;
  }

  async clearSaved(): Promise<void> {
    if (this.worker) throw new Error("Stop training before clearing All-Spin data");
    localStorage.removeItem(ALLSPIN_CHECKPOINT_STORAGE_KEY);
    await clearStoredAllSpinProfile();
    this.checkpoint = null;
    this.profile = null;
    this.emitState();
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.emitState();
  }

  private async handleMessage(message: any): Promise<void> {
    if (message.type === "started") {
      this.events.onStarted?.(message);
      return;
    }
    if (message.type === "candidate") {
      this.events.onCandidate?.(message);
      return;
    }
    if (message.type === "generation") {
      await this.saveCheckpoint(message.result.checkpoint);
      this.events.onGeneration?.(message);
      return;
    }
    if (message.type === "finished") {
      await this.saveCheckpoint(message.checkpoint);
      this.stopWorker();
      this.events.onFinished?.(message);
      return;
    }
    if (message.type === "error" || message.type === "canceled") {
      this.stopWorker();
      if (message.type === "error") this.events.onError?.(message.message ?? "All-Spin training failed");
      else this.events.onFinished?.(message);
    }
  }

  private async saveCheckpoint(input: unknown): Promise<void> {
    const checkpoint = parseAllSpinTrainingCheckpoint(input);
    this.checkpoint = checkpoint;
    this.baseProfile = checkpoint.baseHeuristic;
    localStorage.setItem(ALLSPIN_CHECKPOINT_STORAGE_KEY, JSON.stringify(checkpoint));
    this.profile = await writeStoredAllSpinProfile(checkpointBestAllSpinProfile(checkpoint));
    this.emitState();
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.emitState();
  }

  private fail(message: string): void {
    this.stopWorker();
    this.events.onError?.(message);
  }

  private emitState(): void {
    this.events.onState?.(this.state);
  }
}
