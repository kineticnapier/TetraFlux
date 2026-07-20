import {
  checkpointBestProfile,
  createInitialHeuristicCheckpoint,
  parseHeuristicTrainingCheckpoint,
  type HeuristicTrainingCheckpoint,
  type HeuristicTrainingConfig,
} from "../heuristicTrainer";
import {
  parseHeuristicWeightProfile,
  type HeuristicWeightProfileV1,
} from "../heuristicWeights";
import {
  HEURISTIC_CHECKPOINT_STORAGE_KEY,
  clearStoredHeuristicProfile,
  readStoredHeuristicProfileSync,
  writeStoredHeuristicProfile,
} from "../browserHeuristicProfile";

export interface BrowserTrainingRunRequest {
  generations: number;
  parallelWorkers: number;
  config: Partial<HeuristicTrainingConfig>;
  checkpoint?: HeuristicTrainingCheckpoint | null;
}

export interface BrowserTrainingControllerState {
  running: boolean;
  checkpoint: HeuristicTrainingCheckpoint | null;
  profile: HeuristicWeightProfileV1 | null;
}

export interface BrowserTrainingControllerEvents {
  onState?: (state: BrowserTrainingControllerState) => void;
  onStarted?: (message: any) => void;
  onCandidate?: (message: any) => void;
  onGeneration?: (message: any) => void;
  onFinished?: (message: any) => void;
  onError?: (message: string) => void;
}

function readStoredCheckpoint(): HeuristicTrainingCheckpoint | null {
  try {
    const raw = localStorage.getItem(HEURISTIC_CHECKPOINT_STORAGE_KEY);
    return raw ? parseHeuristicTrainingCheckpoint(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export class BrowserTrainingController {
  private worker: Worker | null = null;
  private checkpoint: HeuristicTrainingCheckpoint | null = readStoredCheckpoint();
  private profile: HeuristicWeightProfileV1 | null = readStoredHeuristicProfileSync()
    ?? (this.checkpoint ? checkpointBestProfile(this.checkpoint) : null);
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(private readonly events: BrowserTrainingControllerEvents = {}) {
    if (this.profile) void this.saveProfile(this.profile);
    this.emitState();
  }

  get state(): BrowserTrainingControllerState {
    return {
      running: this.worker !== null,
      checkpoint: this.checkpoint,
      profile: this.profile,
    };
  }

  start(request: BrowserTrainingRunRequest): void {
    if (this.worker) throw new Error("Training is already running");
    const checkpoint = request.checkpoint === undefined
      ? createInitialHeuristicCheckpoint(request.config)
      : request.checkpoint;
    const worker = new Worker(new URL("../heuristicTrainingWorker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    this.emitState();

    worker.onmessage = (event: MessageEvent<any>) => {
      this.messageQueue = this.messageQueue
        .then(() => this.handleWorkerMessage(event.data))
        .catch((error) => this.fail(error instanceof Error ? error.message : String(error)));
    };
    worker.onerror = (event) => this.fail(`Training worker crashed: ${event.message}`);
    worker.postMessage({
      type: "run",
      generations: request.generations,
      parallelWorkers: request.parallelWorkers,
      config: request.config,
      checkpoint,
    });
  }

  resume(request: Omit<BrowserTrainingRunRequest, "checkpoint">): void {
    if (!this.checkpoint) throw new Error("No saved checkpoint");
    this.start({ ...request, checkpoint: this.checkpoint });
  }

  cancel(): void {
    this.worker?.postMessage({ type: "cancel" });
  }

  async importProfile(input: unknown): Promise<HeuristicWeightProfileV1> {
    const profile = parseHeuristicWeightProfile(input);
    await this.saveProfile(profile);
    return profile;
  }

  async importCheckpoint(input: unknown): Promise<HeuristicTrainingCheckpoint> {
    const checkpoint = parseHeuristicTrainingCheckpoint(input);
    await this.saveCheckpoint(checkpoint);
    return checkpoint;
  }

  async clearSaved(): Promise<void> {
    if (this.worker) throw new Error("Stop training before clearing saved data");
    localStorage.removeItem(HEURISTIC_CHECKPOINT_STORAGE_KEY);
    await clearStoredHeuristicProfile();
    this.checkpoint = null;
    this.profile = null;
    this.emitState();
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.emitState();
  }

  private async handleWorkerMessage(message: any): Promise<void> {
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
      if (message.type === "error") this.events.onError?.(message.message ?? "Training failed");
      else this.events.onFinished?.(message);
    }
  }

  private async saveProfile(profileInput: unknown): Promise<void> {
    this.profile = await writeStoredHeuristicProfile(profileInput);
    this.emitState();
  }

  private async saveCheckpoint(checkpointInput: unknown): Promise<void> {
    const checkpoint = parseHeuristicTrainingCheckpoint(checkpointInput);
    this.checkpoint = checkpoint;
    localStorage.setItem(HEURISTIC_CHECKPOINT_STORAGE_KEY, JSON.stringify(checkpoint));
    await this.saveProfile(checkpointBestProfile(checkpoint));
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
