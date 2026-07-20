import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tetraflux-bench-heuristic-profile-"));
const outfile = join(dir, "benchmark_heuristic_profile.mjs");
await build({ entryPoints: ["tools/benchmark_heuristic_profile.ts"], outfile, bundle: true, format: "esm", platform: "node", target: "node20" });
process.argv = [process.argv[0], outfile, ...process.argv.slice(2)];
await import(pathToFileURL(outfile).href);
