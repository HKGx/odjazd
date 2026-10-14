import { Worker } from "node:worker_threads";
import { Effect, Schema } from "effect";
import type { CompiledFile, CompileJob } from "./compile-worker.ts";

// Next to this file: the TypeScript source in development, the bundled `.mjs` in the image.
const workerUrl = new URL(
  import.meta.url.endsWith(".ts") ? "./compile-worker.ts" : "./compile-worker.mjs",
  import.meta.url,
);

export class CompileFailed extends Schema.TaggedError<CompileFailed>()("CompileFailed", {
  message: Schema.String,
}) {}

/** Runs one compile job on its own thread; interrupting stops the thread. */
export const offThread = (job: CompileJob): Effect.Effect<CompiledFile, CompileFailed> =>
  Effect.callback<CompiledFile, CompileFailed>((resume) => {
    const worker = new Worker(workerUrl, { workerData: job });
    let settled = false;
    const settle = (effect: Effect.Effect<CompiledFile, CompileFailed>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    // Only our reply counts: under `node --watch`, the runtime posts its own messages too.
    worker.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null || !("ok" in message)) return;
      const reply = message as { ok: true; result: CompiledFile } | { ok: false; error: string };
      settle(
        reply.ok
          ? Effect.succeed(reply.result)
          : Effect.fail(CompileFailed.make({ message: String(reply.error) })),
      );
    });
    worker.once("error", (error: Error) =>
      settle(Effect.fail(CompileFailed.make({ message: String(error.stack ?? error.message) }))),
    );
    worker.once("exit", (code) =>
      settle(
        Effect.fail(
          CompileFailed.make({
            message: `compile thread exited with code ${code} before answering`,
          }),
        ),
      ),
    );
    return Effect.promise(() => worker.terminate());
  });
