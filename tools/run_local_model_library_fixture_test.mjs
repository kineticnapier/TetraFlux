import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "tetraflux-local-model-library-fixture-"));
const outfile = join(dir, "local_model_library_fixture_test.mjs");
await build({
  entryPoints: ["tools/local_model_library_fixture_test.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
});
await import(pathToFileURL(outfile).href);
