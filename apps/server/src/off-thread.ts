import { Worker } from "node:worker_threads";
import { NodeWorker } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { RpcClient, type RpcClientError } from "effect/rpc";
import { CompileFailed, CompileRpcs } from "./compile-rpc.ts";

// Next to this file: the TypeScript source in development, the bundled `.mjs` in the image.
const workerUrl = new URL(
  import.meta.url.endsWith(".ts") ? "./compile-worker.ts" : "./compile-worker.mjs",
  import.meta.url,
);

// Without this variable: under `node --watch`, a thread that has it posts the files it loads
// to its parent port, where the worker protocol can't read them.
const { WATCH_REPORT_DEPENDENCIES: _watch, ...env } = process.env;

const thread = RpcClient.layerProtocolWorker({ size: 1 }).pipe(
  Layer.provide(NodeWorker.layer(() => new Worker(workerUrl, { env }))),
);

type CompileClient = RpcClient.FromGroup<typeof CompileRpcs, RpcClientError.RpcClientError>;

/**
 * Runs `use` against a compile thread of its own, closed afterwards so the memory a
 * compile held goes back; interrupting stops the thread.
 */
export const offThread = <A>(
  use: (client: CompileClient) => Effect.Effect<A, CompileFailed | RpcClientError.RpcClientError>,
): Effect.Effect<A, CompileFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(thread);
      const client = yield* RpcClient.make(CompileRpcs).pipe(Effect.provideContext(context));
      return yield* use(client);
    }),
  ).pipe(
    Effect.catchTags({
      WorkerError: (error) => Effect.fail(CompileFailed.make({ message: String(error) })),
      RpcClientError: (error) => Effect.fail(CompileFailed.make({ message: String(error) })),
    }),
  );
