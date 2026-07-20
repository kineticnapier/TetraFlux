import { runHeuristicGeneration } from "./core/generation";
import type {
  HeuristicGenerationResult,
  HeuristicGenerationRuntime,
  HeuristicTrainingCheckpoint,
} from "./core/types";
import { SequentialPopulationScheduler } from "./scheduler/sequentialScheduler";

export {
  HEURISTIC_CHECKPOINT_FORMAT,
  checkpointBestProfile,
  createInitialHeuristicCheckpoint,
  initialHeuristicDeviation,
  parseHeuristicTrainingCheckpoint,
} from "./core/checkpoint";
export {
  DEFAULT_HEURISTIC_TRAINING_CONFIG,
  normalizeHeuristicTrainingConfig,
} from "./core/config";
export { sampleHeuristicPopulation } from "./core/candidateSampler";
export { finalizeHeuristicGeneration } from "./core/cemOptimizer";
export { runHeuristicGeneration } from "./core/generation";
export type {
  CandidateEvaluationTask,
  HeuristicEvaluationAggregate,
  HeuristicEvaluationConfig,
  HeuristicEvaluationResult,
  HeuristicEvaluationRuntime,
  HeuristicGameResult,
  HeuristicGenerationCandidate,
  HeuristicGenerationResult,
  HeuristicGenerationRuntime,
  HeuristicTrainingBest,
  HeuristicTrainingCheckpoint,
  HeuristicTrainingConfig,
  SampledHeuristicCandidate,
} from "./core/types";

/**
 * Compatibility entry point used by Node tools and fixtures.
 * Browser training supplies a WorkerPoolPopulationScheduler instead.
 */
export async function runHeuristicTrainingGeneration(
  checkpoint: HeuristicTrainingCheckpoint,
  runtime: HeuristicGenerationRuntime = {},
): Promise<HeuristicGenerationResult> {
  const scheduler = new SequentialPopulationScheduler();
  return await runHeuristicGeneration(checkpoint, scheduler, runtime);
}
