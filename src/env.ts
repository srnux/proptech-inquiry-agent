// Loads .env from the working directory into process.env. Real environment variables win; a missing file is fine.
try {
  process.loadEnvFile();
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
