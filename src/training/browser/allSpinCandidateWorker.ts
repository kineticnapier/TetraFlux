import {
  evaluateAllSpinWeights,
  type AllSpinTrainingCheckpoint,
} from "../allspinTrainer";
import type { AllSpinWeightVector } from "../allspinWeights";

type EvaluateMessage = {
  type: "evaluate";
  taskId: number;
  candidateIndex: number;
  checkpoint: Pick<AllSpinTrainingCheckpoint, "baseHeuristic" | "search">;
  weights: AllSpinWeightVector;
  games: number;
  maxPieces: number;
  seedBase: number;
};

type WorkerMessage = EvaluateMessage | { type: "cancel" };
let canceled = false;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    canceled = true;
    return;
  }
  canceled = false;
  try {
    const aggregate = await evaluateAllSpinWeights({
      baseHeuristic: message.checkpoint.baseHeuristic,
      weights: message.weights,
      search: message.checkpoint.search,
      games: message.games,
      maxPieces: message.maxPieces,
      seedBase: message.seedBase,
      runtime: { isCanceled: () => canceled },
    });
    self.postMessage({
      type: "result",
      taskId: message.taskId,
      candidate: {
        index: message.candidateIndex,
        weights: message.weights,
        fitness: aggregate.fitness,
        aggregate,
      },
    });
  } catch (error) {
    self.postMessage({
      type: canceled ? "canceled" : "error",
      taskId: message.taskId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
