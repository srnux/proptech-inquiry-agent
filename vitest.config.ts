import { defineConfig } from "vitest/config";

// One run over every package and the eval code (not the eval run itself: pnpm eval). The web app's Playwright tests are separate: pnpm test:e2e.
export default defineConfig({
  test: { projects: ["packages/*", "evals"] },
});
