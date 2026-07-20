import {
  createInitialAllSpinCheckpoint,
  finalizeAllSpinGeneration,
  parseAllSpinTrainingCheckpoint,
  sampleAllSpinPopulation,
  evaluateAllSpinWeights,
  type AllSpinCandidate,
  type AllSpinTrainingCheckpoint,
  type AllSpinTrainingConfig,
} from "./allspinTrainer";
import type { AllSpinSearchProfile, AllSpinWeightKey } from "./allspinWeights";

interface RunMessage {
  type: "run";
  generations: number;
  parallelWorkers?: number;
  config?: Partial<AllSpinTrainingConfig>;
  baseHeuristic?: unknown;
  search?: Partial<AllSpinSearchProfile>;
  checkpoint?: AllSpinTrainingCheckpoint | null;
  initialWeights?: Partial<Record<AllSpinWeightKey, unknown>>;
  parentModelId?: string;
}

type WorkerMessage = RunMessage | { type: "cancel" };

type CandidateWorkerResult = {
  type: "result";
  taskId: number;
  candidate: AllSpinCandidate;
};

type CandidateWorkerError = {
  type: "error" | "canceled";
  taskId: number;
  message?: string;
};

let canceled = false;
let activeWorkers = new Set<Worker>();

function workerCount(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(16, n)) : 1;
}

function terminateWorkers(): void {
  for (const worker of activeWorkers) worker.terminate();
  activeWorkers.clear();
}

async function evaluatePopulation(
  checkpoint: AllSpinTrainingCheckpoint,
  sampled: Array<{ index: number; weights: AllSpinCandidate["weights"] }>,
  seedBase: number,
  concurrency: number,
): Promise<AllSpinCandidate[]> {
  if (concurrency <= 1) {
    const results: AllSpinCandidate[] = [];
    for (let index = 0; index < sampled.length; index++) {
      if (canceled) throw new Error("Training canceled");
      const item = sampled[index];
      const aggregate = await evaluateAllSpinWeights({
        baseHeuristic: checkpoint.baseHeuristic,
        weights: item.weights,
        search: checkpoint.search,
        games: checkpoint.config.gamesPerCandidate,
        maxPieces: checkpoint.config.maxPieces,
        seedBase,
        runtime: { isCanceled: () => canceled },
      });
      const candidate = { index: item.index, weights: item.weights, fitness: aggregate.fitness, aggregate };
      results.push(candidate);
      self.postMessage({
        type: "candidate",
        completed: results.length,
        total: sampled.length,
        candidateIndex: candidate.index,
        fitness: candidate.fitness,
        survivalRate: candidate.aggregate.survivalRate,
        allSpinRate: candidate.aggregate.allSpinClearsPerPiece,
        scheduler: "sequential",
        parallelWorkers: 1,
      });
    }
    return results;
  }

  const results = new Array<AllSpinCandidate>(sampled.length);
  let nextTask = 0;
  let completed = 0;
  let settled = false;
  const actualConcurrency = Math.min(concurrency, sampled.length);

  return await new Promise<AllSpinCandidate[]>((resolve, reject) => {
    const cleanup = () => {
      terminateWorkers();
    };
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(results);
    };
    const assign = (worker: Worker) => {
      if (settled) return;
      if (canceled) {
        fail(new Error("Training canceled"));
        return;
      }
      if (nextTask >= sampled.length) return;
      const taskId = nextTask++;
      const item = sampled[taskId];
      worker.postMessage({
        type: "evaluate",
        taskId,
        candidateIndex: item.index,
        checkpoint: { baseHeuristic: checkpoint.baseHeuristic, search: checkpoint.search },
        weights: item.weights,
        games: checkpoint.config.gamesPerCandidate,
        maxPieces: checkpoint.config.maxPieces,
        seedBase,
      });
    };

    for (let index = 0; index < actualConcurrency; index++) {
      const worker = new Worker(new URL("./browser/allSpinCandidateWorker.ts", import.meta.url), { type: "module" });
      activeWorkers.add(worker);
      worker.onmessage = (event: MessageEvent<CandidateWorkerResult | CandidateWorkerError>) => {
        if (settled) return;
        const message = event.data;
        if (message.type !== "result") {
          fail(new Error(message.message ?? "All-Spin candidate worker failed"));
          return;
        }
        results[message.taskId] = message.candidate;
        completed++;
        self.postMessage({
          type: "candidate",
          completed,
          total: sampled.length,
          candidateIndex: message.candidate.index,
          fitness: message.candidate.fitness,
          survivalRate: message.candidate.aggregate.survivalRate,
          allSpinRate: message.candidate.aggregate.allSpinClearsPerPiece,
          scheduler: "worker-pool",
          parallelWorkers: actualConcurrency,
        });
        if (completed >= sampled.length) finish();
        else assign(worker);
      };
      worker.onerror = (event) => fail(new Error(event.message || "All-Spin candidate worker crashed"));
      assign(worker);
    }
  });
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    canceled = true;
    for (const worker of activeWorkers) {
      try { worker.postMessage({ type: "cancel" }); } catch { /* no-op */ }
    }
    terminateWorkers();
    return;
  }

  canceled = false;
  const parallelWorkers = workerCount(message.parallelWorkers);
  try {
    let checkpoint = message.checkpoint
      ? parseAllSpinTrainingCheckpoint(message.checkpoint)
      : createInitialAllSpinCheckpoint({
        baseHeuristic: message.baseHeuristic,
        config: message.config,
        weights: message.initialWeights,
        search: message.search,
        parentModelId: message.parentModelId,
      });
    const generations = Math.max(1, Math.min(10_000, Math.floor(Number(message.generations) || 1)));
    self.postMessage({
      type: "started",
      checkpoint,
      scheduler: parallelWorkers > 1 ? "worker-pool" : "sequential",
      parallelWorkers,
    });

    for (let step = 0; step < generations; step++) {
      if (canceled) throw new Error("Training canceled");
      const generation = checkpoint.generation + 1;
      const seedBase = (checkpoint.config.trainingSeedBase + generation * checkpoint.config.seedStride) >>> 0;
      const sampled = sampleAllSpinPopulation(checkpoint);
      const candidates = await evaluatePopulation(checkpoint, sampled.candidates, seedBase, parallelWorkers);
      const result = finalizeAllSpinGeneration(
        checkpoint,
        candidates,
        generation,
        seedBase,
        sampled.nextRngState,
      );
      checkpoint = result.checkpoint;
      self.postMessage({
        type: "generation",
        result,
        scheduler: parallelWorkers > 1 ? "worker-pool" : "sequential",
        parallelWorkers,
      });
    }

    self.postMessage({
      type: "finished",
      checkpoint,
      scheduler: parallelWorkers > 1 ? "worker-pool" : "sequential",
      parallelWorkers,
    });
  } catch (error) {
    self.postMessage({
      type: canceled ? "canceled" : "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    terminateWorkers();
  }
};
