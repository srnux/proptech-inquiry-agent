import { fileURLToPath } from "node:url";

// Loads .env from the repository root into process.env. Real environment variables win; a missing file is fine.
// No other imports: this module runs first, before core reads LISTINGS_FILE and the rest from the environment.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
