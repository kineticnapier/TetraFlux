import {
  createInitialHeuristicCheckpoint,
  parseHeuristicTrainingCheckpoint,
  runHeuristicTrainingGeneration,
  type HeuristicTrainingCheckpoint,
  type HeuristicTrainingConfig,
} from "./heuristicTrainer";

interface RunMessage {
  type: "run";
  generations: number;
  config?: Partial<HeuristicTrainingConfig>;
  checkpoint?: HeuristicTrainingCheckpoint | null;
}

type WorkerMessage = RunMessage | { type: "cancel" };
let canceled = false;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    canceled = true;
    return;
  }
  canceled = false;
  try {
    let checkpoint = message.checkpoint
      ? parseHeuristicTrainingCheckpoint(message.checkpoint)
      : createInitialHeuristicCheckpoint(message.config ?? {});
    const targetGenerations = Math.max(1, Math.min(10_000, Math.floor(Number(message.generations) || 1)));
    self.postMessage({ type: "started", checkpoint });
    for (let i = 0; i < targetGenerations; i++) {
      if (canceled) throw new Error("Training canceled");
      const generation = await runHeuristicTrainingGeneration(checkpoint, {
        isCanceled: () => canceled,
        onCandidate: (completed, total, candidate) => {
          self.postMessage({
            type: "candidate",
            generation: checkpoint.generation + 1,
            completed,
            total,
            fitness: candidate.fitness,
            survivalRate: candidate.aggregate.survivalRate,
          });
        },
      });
      checkpoint = generation.checkpoint;
      self.postMessage({ type: "generation", result: generation });
    }
    self.postMessage({ type: "finished", checkpoint });
  } catch (error) {
    self.postMessage({ type: canceled ? "canceled" : "error", message: error instanceof Error ? error.message : String(error) });
  }
};
