import { createServer } from "node:http";
import { NodeHttpClient, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { OdjazdApi } from "@odjazd/api";
import { ingested, loadCatalog } from "@odjazd/cities";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { port } from "./config.ts";
import { citiesHandlers, feedsHandlers } from "./http.ts";
import { Publisher } from "./publisher.ts";

const main = Effect.gen(function* () {
  const entries = ingested(yield* loadCatalog);
  const publisher = Publisher.layer(entries).pipe(Layer.provide(NodeHttpClient.layerUndici));
  const api = HttpApiBuilder.layer(OdjazdApi).pipe(
    Layer.provide([citiesHandlers(entries), feedsHandlers]),
  );
  const server = HttpRouter.serve(api).pipe(
    Layer.merge(Publisher.schedule(entries)),
    Layer.provide(publisher),
    Layer.provide(NodeHttpServer.layer(createServer, { port: yield* port })),
  );
  return yield* Layer.launch(server);
});

NodeRuntime.runMain(main);
