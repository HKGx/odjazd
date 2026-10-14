import { createServer } from "node:http";
import { NodeHttpClient, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { OdjazdApi } from "@odjazd/api";
import { ingested, loadCatalog } from "@odjazd/cities";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerResponse, HttpStaticServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { port, webDir } from "./config.ts";
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
  // For the container's health check: the process is up and serving.
  const health = HttpRouter.add("GET", "/api/health", HttpServerResponse.text("ok"));
  const web = Option.match(yield* webDir, {
    onNone: () => Layer.empty,
    onSome: (root) =>
      Layer.mergeAll(
        // Hashed file names: a new build means new names, so cache them for good.
        HttpStaticServer.layer({
          root: `${root}/assets`,
          prefix: "/assets",
          cacheControl: "public, max-age=31536000, immutable",
          mimeTypes: { mjs: "text/javascript" },
        }),
        // index.html points at the current hashes, sw.js must update: always revalidate.
        HttpStaticServer.layer({
          root,
          cacheControl: "no-cache",
          mimeTypes: { webmanifest: "application/manifest+json" },
        }),
      ),
  });
  const server = HttpRouter.serve(Layer.mergeAll(api, health, web)).pipe(
    Layer.merge(Publisher.schedule(entries)),
    Layer.provide(realtime),
    Layer.provide(NodeHttpClient.layerUndici),
    Layer.provide(NodeHttpServer.layer(createServer, { port: yield* port })),
  );
  return yield* Layer.launch(server);
});

NodeRuntime.runMain(main);
