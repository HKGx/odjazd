import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [solid()],
  worker: { format: "es" },
  server: {
    // The API runs separately (`pnpm dev:server`); same origin in the browser, so no CORS.
    proxy: { "/api": `http://localhost:${process.env["ODJAZD_API_PORT"] ?? "8787"}` },
  },
  preview: {
    proxy: { "/api": `http://localhost:${process.env["ODJAZD_API_PORT"] ?? "8787"}` },
  },
});
