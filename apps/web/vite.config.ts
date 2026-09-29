import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API server runs separately (pnpm dev starts both); the dev server forwards its routes to it.
const api = process.env.API_URL ?? "http://127.0.0.1:3000";
const routes = ["/inquiries", "/handoffs", "/sources", "/health"];

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: Object.fromEntries(routes.map((r) => [r, { target: api }])),
  },
});
