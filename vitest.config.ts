import { defineConfig } from "vitest/config";

// One run over every package. The web app's Playwright tests are separate: pnpm test:e2e.
export default defineConfig({
  test: { projects: ["packages/*"] },
});
