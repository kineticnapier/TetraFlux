import type {
  CandidateEvaluationTask,
  HeuristicGenerationCandidate,
  HeuristicGenerationRuntime,
} from "../core/types";
import type { PopulationScheduler } from "./types";

type WorkerResultMessage = {
  type: "result";
  taskId: number;
  candidate: HeuristicGenerationCandidate;
};

type WorkerErrorMessage = {
  type: "error" | "canceled";
  taskId: number;
  message?: string;
};

type CandidateWorkerMessage = WorkerResultMessage | WorkerErrorMessage;

export class WorkerPoolPopulationScheduler implements PopulationScheduler {
  readonly mode = "worker-pool" as const;
  private workers = new Set<Worker>();
  private rejectActive: ((reason?: unknown) => void) | null = null;
  private canceled = false;

  constructor(readonly workerCount: number) {
    if (!Number.isFinite(workerCount) || workerCount < 2) {
      throw new Error("Worker pool requires at least two workers");
    }
  }

  async evaluate(
    tasks: CandidateEvaluationTask[],
    runtime: HeuristicGenerationRuntime = {},
  ): Promise<HeuristicGenerationCandidate[]> {
    if (tasks.length === 0) return [];
    this.dispose();
    this.canceled = false;

    const concurrency = Math.max(1, Math.min(Math.floor(this.workerCount), tasks.length));
    const results = new Array<HeuristicGenerationCandidate>(tasks.length);
    let nextTaskIndex = 0;
    let completed = 0;
    let settled = false;

    return await new Promise<HeuristicGenerationCandidate[]>((resolve, reject) => {
      this.rejectActive = reject;

      const cleanup = () => {
        for (const worker of this.workers) worker.terminate();
        this.workers.clear();
        this.rejectActive = null;
      };

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(results);
      };

      const assign = (worker: Worker) => {
        if (settled) return;
        if (this.canceled || runtime.isCanceled?.()) {
          fail(new Error("Training canceled"));
          return;
        }
        if (nextTaskIndex >= tasks.length) return;
        const taskId = nextTaskIndex++;
        worker.postMessage({ type: "evaluate", taskId, task: tasks[taskId] });
      };

      for (let workerIndex = 0; workerIndex < concurrency; workerIndex++) {
        let worker: Worker;
        try {
          worker = new Worker(new URL("../browser/candidateWorker.ts", import.meta.url), { type: "module" });
        } catch (error) {
          fail(error);
          return;
        }
        this.workers.add(worker);
        worker.onmessage = (event: MessageEvent<CandidateWorkerMessage>) => {
          if (settled) return;
          const message = event.data;
          if (message.type !== "result") {
            fail(new Error(message.message ?? "Candidate worker failed"));
            return;
          }
          results[message.taskId] = message.candidate;
          completed++;
          runtime.onCandidate?.(completed, tasks.length, message.candidate);
          if (completed >= tasks.length) finish();
          else assign(worker);
        };
        worker.onerror = (event) => fail(new Error(event.message || "Candidate worker crashed"));
        assign(worker);
      }
    });
  }

  cancel(): void {
    this.canceled = true;
    for (const worker of this.workers) {
      try { worker.postMessage({ type: "cancel" }); } catch { /* ignore */ }
      worker.terminate();
    }
    this.workers.clear();
    const reject = this.rejectActive;
    this.rejectActive = null;
    reject?.(new Error("Training canceled"));
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.clear();
    this.rejectActive = null;
  }
}
