import { createServer } from "node:http";
import { NodeHttpClient, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { OdjazdApi } from "@odjazd/api";
import { ingested, loadCatalog } from "@odjazd/cities";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { port } from "./config.ts";
import { citiesHandlers, feedsHandlers, realtimeHandlers } from "./http.ts";
import { Publisher } from "./publisher.ts";
import { Realtime } from "./realtime/service.ts";

const main = Effect.gen(function* () {
  const entries = ingested(yield* loadCatalog);
  const publisher = Publisher.layer(entries);
  const realtime = Realtime.layer(entries).pipe(Layer.provideMerge(publisher));
  const api = HttpApiBuilder.layer(OdjazdApi).pipe(
    Layer.provide([citiesHandlers(entries), feedsHandlers, realtimeHandlers]),
  );
  const server = HttpRouter.serve(api).pipe(
    Layer.merge(Publisher.schedule(entries)),
    Layer.provide(realtime),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(NodeHttpServer.layer(createServer, { port: yield* port })),
  );
  return yield* Layer.launch(server);
});

NodeRuntime.runMain(main);
