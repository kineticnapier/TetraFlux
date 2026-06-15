import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { rm, mkdir } from "node:fs/promises";

const outdir = ".tmp/garbage-hole-fixture";
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: ["tools/garbage_hole_fixture_test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: `${outdir}/test.mjs`,
  sourcemap: false,
});
await import(pathToFileURL(`${process.cwd()}/${outdir}/test.mjs`).href);
