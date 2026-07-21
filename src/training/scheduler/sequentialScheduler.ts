import { evaluateHeuristicWeights } from "../evaluation/heuristicEvaluator";
import type {
  CandidateEvaluationTask,
  HeuristicGenerationCandidate,
  HeuristicGenerationRuntime,
} from "../core/types";
import type { PopulationScheduler } from "./types";

export class SequentialPopulationScheduler implements PopulationScheduler {
  readonly mode = "sequential" as const;

  async evaluate(
    tasks: CandidateEvaluationTask[],
    runtime: HeuristicGenerationRuntime = {},
  ): Promise<HeuristicGenerationCandidate[]> {
    const candidates: HeuristicGenerationCandidate[] = [];

    for (let index = 0; index < tasks.length; index++) {
      if (runtime.isCanceled?.()) throw new Error("Training canceled");
      const task = tasks[index];
      const evaluation = await evaluateHeuristicWeights(task.weights, task.evaluationConfig, runtime);
      const candidate: HeuristicGenerationCandidate = {
        index: task.index,
        weights: task.weights,
        fitness: evaluation.aggregate.fitness,
        aggregate: evaluation.aggregate,
      };
      candidates.push(candidate);
      runtime.onCandidate?.(index + 1, tasks.length, candidate);
    }

    return candidates;
  }
}
