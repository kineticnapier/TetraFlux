import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Local Vite and preview servers expose the app at the origin root.
  base: process.env.VITE_BASE ?? "/",
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        game: resolve(projectRoot, "index.html"),
        benchmark: resolve(projectRoot, "benchmark/index.html"),
        training: resolve(projectRoot, "training/index.html"),
        allspinTraining: resolve(projectRoot, "training/allspin/index.html"),
      },
    },
  },
});
