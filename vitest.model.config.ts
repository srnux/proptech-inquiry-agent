import { defineConfig } from "vitest/config";

// Runs the tests that need the real embedding model. The first run downloads it (about 120 MB).
export default defineConfig({
  test: { include: ["test/retrieval-model.test.ts"], env: { RUN_MODEL_TESTS: "1" }, testTimeout: 300_000 },
});
