// Worker program: serves TimetableRpcs over the worker's message port.
import { BrowserRuntime, BrowserWorkerRunner } from "@effect/platform-browser";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcServer } from "effect/rpc";
import { TimetableRpcs } from "./rpc.ts";
import { handlersLayer } from "./server.ts";
import { TimetableStore } from "./store.ts";

const Main = RpcServer.layer(TimetableRpcs).pipe(
  Layer.provide(handlersLayer({ baseUrl: self.location.origin })),
  Layer.provide([TimetableStore.cacheStorage, FetchHttpClient.layer]),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(BrowserWorkerRunner.layer),
);

BrowserRuntime.runMain(Layer.launch(Main));
