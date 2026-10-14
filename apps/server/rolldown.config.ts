import { defineConfig } from "rolldown";

/**
 * The server as plain JS for the container: workspace packages and their
 * dependencies inlined, so the image needs no pnpm workspace or TypeScript.
 */
export default defineConfig({
  // The compile thread is its own entry: `new Worker` loads it from a file next to the server.
  input: { server: "src/index.ts", "compile-worker": "src/compile-worker.ts" },
  platform: "node",
  // Undici is CommonJS; bundled, its named exports (`Agent`) are lost. The image ships it as a package.
  external: ["undici"],
  output: { dir: "dist", entryFileNames: "[name].mjs", format: "esm", sourcemap: true },
});
