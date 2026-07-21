import type {
  CandidateEvaluationTask,
  HeuristicGenerationCandidate,
  HeuristicGenerationRuntime,
} from "../core/types";

export interface PopulationScheduler {
  readonly mode: "sequential" | "worker-pool";
  evaluate(
    tasks: CandidateEvaluationTask[],
    runtime?: HeuristicGenerationRuntime,
  ): Promise<HeuristicGenerationCandidate[]>;
  cancel?(): void;
  dispose?(): void;
}
