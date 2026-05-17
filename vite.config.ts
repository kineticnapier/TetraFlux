import { defineConfig } from "vite";

function githubPagesBase(): string {
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  if (process.env.GITHUB_ACTIONS === "true" && repo) return `/${repo}/`;
  return "/";
}

export default defineConfig({
  base: process.env.VITE_BASE ?? githubPagesBase(),
  server: { port: 5173 }
});
