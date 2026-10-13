import solid from "@solidjs/vite-plugin"
import { defineConfig } from "vite"

// TODO: add vite-plugin-pwa once verified with the Solid 2 plugin (see PROJECT_BRIEF.md)
export default defineConfig({
  plugins: [solid()],
  worker: { format: "es" }
})
