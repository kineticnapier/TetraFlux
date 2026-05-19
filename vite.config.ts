import { defineConfig } from "vite";

export default defineConfig({
  // Cloudflare Pages is deployed at the domain root.
  // Do not infer /TetraFlux/ from GITHUB_REPOSITORY in GitHub Actions,
  // because that breaks asset URLs on https://tetraflux.pages.dev/.
  base: process.env.VITE_BASE ?? "/",
  server: { port: 5173 }
});
