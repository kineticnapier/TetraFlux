import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { evaluateHeuristicWeights } from "../src/training/heuristicEvaluation";
import { parseHeuristicWeightProfile } from "../src/training/heuristicWeights";

function valueArg(args: string[], names: string[], fallback: string): string {
  for (let i = 0; i < args.length; i++) if (names.includes(args[i]) && args[i + 1]) return args[i + 1];
  return fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const profilePath = resolve(valueArg(args, ["--profile"], "models/heuristic-flat-v1.json"));
  const outputPath = resolve(valueArg(args, ["--output"], "data/heuristic_profile_benchmark.json"));
  const games = Math.max(1, Math.floor(Number(valueArg(args, ["-n", "--games"], "64"))));
  const maxPieces = Math.max(20, Math.floor(Number(valueArg(args, ["-p", "--max-pieces"], "1000"))));
  const seedBase = Math.floor(Number(valueArg(args, ["-s", "--seed"], "987654321"))) >>> 0;
  const profile = parseHeuristicWeightProfile(JSON.parse(readFileSync(profilePath, "utf8")));
  const evaluation = await evaluateHeuristicWeights(profile.weights, { games, maxPieces, seedBase }, { yieldEveryGame: false });
  const payload = { generatedAt: new Date().toISOString(), profile, evaluation };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  const a = evaluation.aggregate;
  console.log(`profile=${profile.profileId} games=${a.games} pieces=${a.pieces} survival=${(a.survivalRate * 100).toFixed(2)}% topouts=${a.topouts}`);
  console.log(`fitness=${a.fitness.toFixed(2)} lines/piece=${a.linesPerPiece.toFixed(4)} attack/piece=${a.attackPerPiece.toFixed(4)} holes=${a.avgHoles.toFixed(3)} height=${a.avgMaxHeight.toFixed(3)}`);
  console.log(`wrote ${outputPath}`);
}

await main();
