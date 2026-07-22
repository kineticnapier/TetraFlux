import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "tetraflux-headless-trainer-"));
const outfile = join(dir, "headless_training_server.mjs");

await build({
  entryPoints: ["tools/headless_training_server.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: "inline",
});

const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
