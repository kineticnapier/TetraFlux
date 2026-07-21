import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  checkpointBestProfile,
  createInitialHeuristicCheckpoint,
  parseHeuristicTrainingCheckpoint,
  runHeuristicTrainingGeneration,
  type HeuristicTrainingConfig,
} from "../src/training/heuristicTrainer";

interface Args {
  generations: number;
  checkpointPath: string;
  profilePath: string;
  historyPath: string;
  resume: boolean;
  config: Partial<HeuristicTrainingConfig>;
}

function numberArg(args: string[], names: string[], fallback: number): number {
  for (let i = 0; i < args.length; i++) if (names.includes(args[i]) && args[i + 1]) return Number(args[i + 1]);
  return fallback;
}

function stringArg(args: string[], names: string[], fallback: string): string {
  for (let i = 0; i < args.length; i++) if (names.includes(args[i]) && args[i + 1]) return args[i + 1];
  return fallback;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const outputDir = stringArg(args, ["--output-dir"], "data/training/heuristic-flat-v1");
  return {
    generations: Math.max(1, Math.floor(numberArg(args, ["-g", "--generations"], 25))),
    checkpointPath: resolve(stringArg(args, ["--checkpoint"], `${outputDir}/checkpoint.json`)),
    profilePath: resolve(stringArg(args, ["--profile"], "models/heuristic-flat-v1.json")),
    historyPath: resolve(stringArg(args, ["--history"], `${outputDir}/history.jsonl`)),
    resume: args.includes("--resume"),
    config: {
      population: numberArg(args, ["--population"], 16),
      eliteCount: numberArg(args, ["--elite"], 4),
      gamesPerCandidate: numberArg(args, ["-n", "--games"], 8),
      maxPieces: numberArg(args, ["-p", "--max-pieces"], 300),
      trainingSeedBase: numberArg(args, ["-s", "--seed"], 123456789),
      initialSigma: numberArg(args, ["--sigma"], 0.18),
      fixedKeys: ["holeWeight"],
    },
  };
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, path);
}

async function main(): Promise<void> {
  const args = parseArgs();
  let checkpoint = args.resume && existsSync(args.checkpointPath)
    ? parseHeuristicTrainingCheckpoint(JSON.parse(readFileSync(args.checkpointPath, "utf8")))
    : createInitialHeuristicCheckpoint(args.config);

  console.log(`Heuristic CEM training: generation=${checkpoint.generation} +${args.generations}`);
  console.log(`population=${checkpoint.config.population} games=${checkpoint.config.gamesPerCandidate} maxPieces=${checkpoint.config.maxPieces}`);

  for (let i = 0; i < args.generations; i++) {
    const result = await runHeuristicTrainingGeneration(checkpoint, {
      onCandidate: (completed, total, candidate) => {
        console.log(`gen ${checkpoint.generation + 1} candidate ${completed}/${total} fitness=${candidate.fitness.toFixed(2)} survival=${(candidate.aggregate.survivalRate * 100).toFixed(1)}%`);
      },
      yieldEveryGame: false,
    });
    checkpoint = result.checkpoint;
    const profile = checkpointBestProfile(checkpoint);
    atomicJson(args.checkpointPath, checkpoint);
    atomicJson(args.profilePath, profile);
    mkdirSync(dirname(args.historyPath), { recursive: true });
    appendFileSync(args.historyPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      generation: result.generation,
      seedBase: result.seedBase,
      best: result.best,
      globalBest: checkpoint.best,
      mean: checkpoint.mean,
      deviation: checkpoint.deviation,
    })}\n`);
    console.log(`generation ${result.generation} saved: best=${result.best.fitness.toFixed(2)} global=${checkpoint.best?.fitness.toFixed(2) ?? "n/a"}`);
  }

  console.log(`checkpoint: ${args.checkpointPath}`);
  console.log(`profile: ${args.profilePath}`);
  console.log(`history: ${args.historyPath}`);
}

await main();
