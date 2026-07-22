import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  evaluateHeuristicWeights,
  type HeuristicEvaluationConfig,
} from "../src/training/heuristicEvaluation";
import {
  DEFAULT_HEURISTIC_WEIGHTS,
  HEURISTIC_FEATURE_SET,
  HEURISTIC_PROFILE_FORMAT,
  HEURISTIC_WEIGHT_KEYS,
  HEURISTIC_WEIGHT_LIMITS,
  normalizeHeuristicWeights,
  type HeuristicWeightVector,
} from "../src/training/heuristicWeights";

export const TRAINING_PROTOCOL_VERSION = 1 as const;

export interface TrainingRequest {
  id: string;
  type: string;
  payload?: unknown;
}

export interface TrainingResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    name: string;
    message: string;
  };
}

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function evaluationConfig(payload: JsonObject): HeuristicEvaluationConfig {
  const seeds = Array.isArray(payload.seeds)
    ? payload.seeds.map((seed) => Math.floor(Number(seed)) >>> 0)
    : undefined;
  const benchmarkGarbage = payload.benchmarkGarbage && typeof payload.benchmarkGarbage === "object"
    ? payload.benchmarkGarbage as HeuristicEvaluationConfig["benchmarkGarbage"]
    : undefined;
  return {
    games: integerValue(payload.games, seeds?.length || 1, 1, 4096),
    maxPieces: integerValue(payload.maxPieces, 200, 1, 100_000),
    seedBase: Math.floor(Number(payload.seedBase) || 0) >>> 0,
    seeds,
    benchmarkGarbage,
  };
}

function normalizedWeights(value: unknown): HeuristicWeightVector {
  const weights = objectValue(value ?? {}, "weights");
  return normalizeHeuristicWeights(weights as Partial<Record<keyof HeuristicWeightVector, unknown>>);
}

async function evaluateFlat(payloadInput: unknown): Promise<unknown> {
  const payload = objectValue(payloadInput ?? {}, "payload");
  const weights = normalizedWeights(payload.weights);
  return await evaluateHeuristicWeights(weights, evaluationConfig(payload), { yieldEveryGame: false });
}

async function evaluateFlatPopulation(payloadInput: unknown): Promise<unknown> {
  const payload = objectValue(payloadInput ?? {}, "payload");
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    throw new Error("candidates must be a non-empty array");
  }
  if (payload.candidates.length > 1024) throw new Error("candidate population is too large");
  const config = evaluationConfig(payload);
  const candidates = [];
  for (let index = 0; index < payload.candidates.length; index++) {
    const candidate = objectValue(payload.candidates[index], `candidates[${index}]`);
    const candidateId = String(candidate.candidateId ?? index);
    const weights = normalizedWeights(candidate.weights);
    const evaluation = await evaluateHeuristicWeights(weights, config, { yieldEveryGame: false });
    candidates.push({
      candidateId,
      weights,
      fitness: evaluation.aggregate.fitness,
      aggregate: evaluation.aggregate,
      perGame: evaluation.perGame,
    });
  }
  return { config, candidates };
}

export async function handleTrainingRequest(requestInput: unknown): Promise<TrainingResponse> {
  let id = "unknown";
  try {
    const request = objectValue(requestInput, "request");
    id = String(request.id ?? "unknown");
    const type = String(request.type ?? "");
    switch (type) {
      case "ping":
        return {
          id,
          ok: true,
          result: {
            protocolVersion: TRAINING_PROTOCOL_VERSION,
            service: "tetraflux-headless-training",
          },
        };
      case "describe":
        return {
          id,
          ok: true,
          result: {
            protocolVersion: TRAINING_PROTOCOL_VERSION,
            capabilities: ["evaluate_flat", "evaluate_flat_population"],
            flat: {
              profileFormat: HEURISTIC_PROFILE_FORMAT,
              featureSet: HEURISTIC_FEATURE_SET,
              weightKeys: HEURISTIC_WEIGHT_KEYS,
              weightLimits: HEURISTIC_WEIGHT_LIMITS,
              defaultWeights: DEFAULT_HEURISTIC_WEIGHTS,
            },
          },
        };
      case "evaluate_flat":
        return { id, ok: true, result: await evaluateFlat(request.payload) };
      case "evaluate_flat_population":
        return { id, ok: true, result: await evaluateFlatPopulation(request.payload) };
      case "shutdown":
        return { id, ok: true, result: { shuttingDown: true } };
      default:
        throw new Error(`Unsupported request type: ${type || "missing"}`);
    }
  } catch (error) {
    return {
      id,
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function runJsonlServer(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch (error) {
      const response: TrainingResponse = {
        id: "unknown",
        ok: false,
        error: {
          name: "SyntaxError",
          message: error instanceof Error ? error.message : String(error),
        },
      };
      process.stdout.write(`${JSON.stringify(response)}\n`);
      continue;
    }
    const response = await handleTrainingRequest(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
    if ((request as { type?: unknown })?.type === "shutdown" && response.ok) break;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runJsonlServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
