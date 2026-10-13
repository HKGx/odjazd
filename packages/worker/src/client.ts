import { BrowserWorker } from "@effect/platform-browser";
import { Context, Effect, Layer } from "effect";
import { RpcClient } from "effect/rpc";
import { TimetableRpcs } from "./rpc.ts";

const make = RpcClient.make(TimetableRpcs);

/** Main-thread client for the timetable worker. */
export class TimetableClient extends Context.Service<
  TimetableClient,
  Effect.Success<typeof make>
>()("@odjazd/worker/client/TimetableClient") {
  /** `spawn` creates the worker, e.g. `() => new Worker(new URL(...), { type: "module" })`. */
  static readonly layer = (spawn: () => Worker) =>
    Layer.effect(TimetableClient, make).pipe(
      Layer.provide(
        // One worker, many in-flight requests: the default (1) would let the long-lived
        // `Live` stream block every other call.
        RpcClient.layerProtocolWorker({ size: 1, concurrency: 64 }),
      ),
      Layer.provide(BrowserWorker.layer(spawn)),
    );
}
