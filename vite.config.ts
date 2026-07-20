import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Cloudflare Pages is deployed at the domain root.
  // Do not infer /TetraFlux/ from GITHUB_REPOSITORY in GitHub Actions,
  // because that breaks asset URLs on https://tetraflux.pages.dev/.
  base: process.env.VITE_BASE ?? "/",
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        game: resolve(projectRoot, "index.html"),
        benchmark: resolve(projectRoot, "benchmark/index.html"),
        training: resolve(projectRoot, "training/index.html"),
      },
    },
  },
});
