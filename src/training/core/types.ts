import type { BenchmarkGarbageEnvironmentConfig } from "../../ai/benchmarkEnvironment";
import type { HeuristicWeightKey, HeuristicWeightProfileV1, HeuristicWeightVector } from "../heuristicWeights";

export interface HeuristicEvaluationConfig {
  games: number;
  maxPieces: number;
  seedBase: number;
  seeds?: number[];
  benchmarkGarbage?: Partial<BenchmarkGarbageEnvironmentConfig>;
}

export interface HeuristicGameResult {
  seed: number;
  pieces: number;
  reachedCap: boolean;
  topout: boolean;
  lines: number;
  attack: number;
  avgHoles: number;
  avgMaxHeight: number;
  avgBumpiness: number;
  avgTotalHeight: number;
  maxObservedHeight: number;
}

export interface HeuristicEvaluationAggregate {
  games: number;
  maxPieces: number;
  pieces: number;
  survivalRate: number;
  meanSurvivalCubed: number;
  percentile10Survival: number;
  topouts: number;
  topoutRate: number;
  lines: number;
  attack: number;
  linesPerPiece: number;
  attackPerPiece: number;
  avgHoles: number;
  avgMaxHeight: number;
  avgBumpiness: number;
  avgTotalHeight: number;
  maxObservedHeight: number;
  fitness: number;
}

export interface HeuristicEvaluationResult {
  config: HeuristicEvaluationConfig;
  aggregate: HeuristicEvaluationAggregate;
  perGame: HeuristicGameResult[];
}

export interface HeuristicEvaluationRuntime {
  isCanceled?: () => boolean;
  onGame?: (completed: number, total: number, result: HeuristicGameResult) => void;
  yieldEveryGame?: boolean;
}

export interface HeuristicTrainingConfig {
  population: number;
  eliteCount: number;
  gamesPerCandidate: number;
  maxPieces: number;
  trainingSeedBase: number;
  seedStride: number;
  initialSigma: number;
  minRelativeSigma: number;
  smoothing: number;
  fixedKeys: HeuristicWeightKey[];
}

export interface HeuristicTrainingBest {
  generation: number;
  candidateIndex: number;
  fitness: number;
  weights: HeuristicWeightVector;
  aggregate: HeuristicEvaluationAggregate;
}

export interface HeuristicTrainingCheckpoint {
  format: "tetraflux_heuristic_training_checkpoint_v1";
  schemaVersion: 1;
  featureSet: "flat-14-v1";
  algorithm: "cem";
  generation: number;
  rngState: number;
  config: HeuristicTrainingConfig;
  mean: HeuristicWeightVector;
  deviation: HeuristicWeightVector;
  best: HeuristicTrainingBest | null;
  updatedAt: string;
}

export interface SampledHeuristicCandidate {
  index: number;
  weights: HeuristicWeightVector;
}

export interface HeuristicGenerationCandidate extends SampledHeuristicCandidate {
  fitness: number;
  aggregate: HeuristicEvaluationAggregate;
}

export interface HeuristicGenerationResult {
  generation: number;
  seedBase: number;
  candidates: HeuristicGenerationCandidate[];
  best: HeuristicGenerationCandidate;
  checkpoint: HeuristicTrainingCheckpoint;
  profile: HeuristicWeightProfileV1;
}

export interface HeuristicGenerationRuntime extends HeuristicEvaluationRuntime {
  onCandidate?: (completed: number, total: number, candidate: HeuristicGenerationCandidate) => void;
}

export interface CandidateEvaluationTask extends SampledHeuristicCandidate {
  evaluationConfig: HeuristicEvaluationConfig;
}
