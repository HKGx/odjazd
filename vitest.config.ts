import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { passWithNoTests: true, projects: ["packages/*", "apps/server", "apps/web", "tools/*"] },
});
