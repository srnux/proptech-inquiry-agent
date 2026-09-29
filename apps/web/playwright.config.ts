import { defineConfig, devices } from "@playwright/test";

// Its own ports, so the test runs next to `pnpm dev`. The demo model and the hashing embedder need no key,
// no network and no model download (DECISIONS.md 28).
const API_PORT = 3100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @proptech/server dev",
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: { MODEL_PROVIDER: "demo", EMBEDDER: "hashing", PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm exec vite",
      url: `http://localhost:${WEB_PORT}`,
      env: { API_URL: `http://127.0.0.1:${API_PORT}`, WEB_PORT: String(WEB_PORT) },
      reuseExistingServer: false,
    },
  ],
});
