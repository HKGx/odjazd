import { defineConfig } from "rolldown";

/**
 * The server as plain JS for the container: workspace packages and their
 * dependencies inlined, so the image needs no pnpm workspace or TypeScript.
 */
export default defineConfig({
  input: "src/index.ts",
  platform: "node",
  // Undici is CommonJS; bundled, its named exports (`Agent`) are lost. The image ships it as a package.
  external: ["undici"],
  output: { dir: "dist", entryFileNames: "server.mjs", format: "esm", sourcemap: true },
});
