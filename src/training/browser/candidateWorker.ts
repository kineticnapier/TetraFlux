import type { CandidateEvaluationTask } from "../core/types";
import { evaluateHeuristicWeights } from "../evaluation/heuristicEvaluator";

type EvaluateMessage = {
  type: "evaluate";
  taskId: number;
  task: CandidateEvaluationTask;
};

type CancelMessage = { type: "cancel" };
type WorkerMessage = EvaluateMessage | CancelMessage;

let canceled = false;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    canceled = true;
    return;
  }

  canceled = false;
  try {
    const evaluation = await evaluateHeuristicWeights(
      message.task.weights,
      message.task.evaluationConfig,
      {
        isCanceled: () => canceled,
        yieldEveryGame: true,
      },
    );
    self.postMessage({
      type: "result",
      taskId: message.taskId,
      candidate: {
        index: message.task.index,
        weights: message.task.weights,
        fitness: evaluation.aggregate.fitness,
        aggregate: evaluation.aggregate,
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
