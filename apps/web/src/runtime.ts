import { BrowserKeyValueStore } from "@effect/platform-browser";
import { OdjazdApi } from "@odjazd/api";
import { UserDataStore } from "@odjazd/user-data";
import { TimetableClient } from "@odjazd/worker";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

const makeApi = HttpApiClient.make(OdjazdApi);

/** Typed client for the odjazd server, same origin (the dev server proxies `/api`). */
export class Api extends Context.Service<Api, Effect.Success<typeof makeApi>>()(
  "@odjazd/web/runtime/Api",
) {
  static readonly layer = Layer.effect(Api, makeApi).pipe(Layer.provide(FetchHttpClient.layer));
}

const timetableWorker = TimetableClient.layer(
  () => new Worker(new URL("./timetable.worker.ts", import.meta.url), { type: "module" }),
);

/** Everything the UI runs on. Built once, lazily, on first use. */
export const runtime = ManagedRuntime.make(
  Layer.mergeAll(Api.layer, timetableWorker, UserDataStore.layer).pipe(
    Layer.provideMerge(BrowserKeyValueStore.layerLocalStorage),
  ),
);

export type AppServices = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;
