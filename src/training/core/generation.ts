import { sampleHeuristicPopulation } from "./candidateSampler";
import { finalizeHeuristicGeneration } from "./cemOptimizer";
import { parseHeuristicTrainingCheckpoint } from "./checkpoint";
import type {
  CandidateEvaluationTask,
  HeuristicGenerationResult,
  HeuristicGenerationRuntime,
  HeuristicTrainingCheckpoint,
} from "./types";
import type { PopulationScheduler } from "../scheduler/types";

export async function runHeuristicGeneration(
  checkpointInput: HeuristicTrainingCheckpoint,
  scheduler: PopulationScheduler,
  runtime: HeuristicGenerationRuntime = {},
): Promise<HeuristicGenerationResult> {
  const checkpoint = parseHeuristicTrainingCheckpoint(checkpointInput);
  if (runtime.isCanceled?.()) throw new Error("Training canceled");

  const generation = checkpoint.generation + 1;
  const seedBase = (checkpoint.config.trainingSeedBase + (generation - 1) * checkpoint.config.seedStride) >>> 0;
  const sampled = sampleHeuristicPopulation(checkpoint);
  const tasks: CandidateEvaluationTask[] = sampled.candidates.map((candidate) => ({
    ...candidate,
    evaluationConfig: {
      games: checkpoint.config.gamesPerCandidate,
      maxPieces: checkpoint.config.maxPieces,
      seedBase,
    },
  }));

  const evaluated = await scheduler.evaluate(tasks, runtime);
  if (runtime.isCanceled?.()) throw new Error("Training canceled");
  return finalizeHeuristicGeneration(checkpoint, evaluated, generation, seedBase, sampled.nextRngState);
}
