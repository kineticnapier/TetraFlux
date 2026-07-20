import {
  createInitialHeuristicCheckpoint,
  parseHeuristicTrainingCheckpoint,
  runHeuristicGeneration,
  type HeuristicTrainingCheckpoint,
  type HeuristicTrainingConfig,
} from "./heuristicTrainer";
import type { PopulationScheduler } from "./scheduler/types";
import { SequentialPopulationScheduler } from "./scheduler/sequentialScheduler";
import { WorkerPoolPopulationScheduler } from "./scheduler/workerPoolScheduler";

interface RunMessage {
  type: "run";
  generations: number;
  parallelWorkers?: number;
  config?: Partial<HeuristicTrainingConfig>;
  checkpoint?: HeuristicTrainingCheckpoint | null;
}

type WorkerMessage = RunMessage | { type: "cancel" };
let canceled = false;
let activeScheduler: PopulationScheduler | null = null;

function normalizeWorkerCount(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(16, n)) : 1;
}

function createScheduler(workerCount: number): PopulationScheduler {
  return workerCount > 1
    ? new WorkerPoolPopulationScheduler(workerCount)
    : new SequentialPopulationScheduler();
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    canceled = true;
    activeScheduler?.cancel?.();
    return;
  }

  canceled = false;
  const workerCount = normalizeWorkerCount(message.parallelWorkers);
  activeScheduler = createScheduler(workerCount);

  try {
    let checkpoint = message.checkpoint
      ? parseHeuristicTrainingCheckpoint(message.checkpoint)
      : createInitialHeuristicCheckpoint(message.config ?? {});
    const targetGenerations = Math.max(1, Math.min(10_000, Math.floor(Number(message.generations) || 1)));
    self.postMessage({
      type: "started",
      checkpoint,
      scheduler: activeScheduler.mode,
      parallelWorkers: workerCount,
    });

    for (let i = 0; i < targetGenerations; i++) {
      if (canceled) throw new Error("Training canceled");
      const generation = await runHeuristicGeneration(checkpoint, activeScheduler, {
        isCanceled: () => canceled,
        onCandidate: (completed, total, candidate) => {
          self.postMessage({
            type: "candidate",
            generation: checkpoint.generation + 1,
            completed,
            total,
            candidateIndex: candidate.index,
            fitness: candidate.fitness,
            survivalRate: candidate.aggregate.survivalRate,
            scheduler: activeScheduler?.mode,
            parallelWorkers: workerCount,
          });
        },
      });
      checkpoint = generation.checkpoint;
      self.postMessage({
        type: "generation",
        result: generation,
        scheduler: activeScheduler.mode,
        parallelWorkers: workerCount,
      });
    }

    self.postMessage({
      type: "finished",
      checkpoint,
      scheduler: activeScheduler.mode,
      parallelWorkers: workerCount,
    });
  } catch (error) {
    self.postMessage({
      type: canceled ? "canceled" : "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    activeScheduler?.dispose?.();
    activeScheduler = null;
  }
};
