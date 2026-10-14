// Worker program: serves CompileRpcs over the thread's parent port.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { inspect } from "node:util";
import { gzipSync } from "node:zlib";
import { NodeRuntime, NodeWorkerRunner } from "@effect/platform-node";
import { ingestGtfsZip, walkGraphFromPbf } from "@odjazd/ingest";
import { encodeTimetable } from "@odjazd/timetable";
import { computeFootpaths, decodeWalkGraph, encodeWalkGraph, makeWalkNetwork } from "@odjazd/walk";
import { Effect, Layer } from "effect";
import { RpcServer } from "effect/rpc";
import { CompileFailed, CompileRpcs } from "./compile-rpc.ts";

const failed = (error: unknown) => CompileFailed.make({ message: inspect(error, { depth: 6 }) });

const finish = (bytes: Uint8Array<ArrayBuffer>) => ({
  bytes,
  // A copy: small gzip outputs can sit in Node's shared buffer pool, which can't be transferred.
  compressed: new Uint8Array(gzipSync(bytes, { level: 9 })),
  hash: createHash("sha256").update(bytes).digest("hex"),
});

const handlers = CompileRpcs.toLayer({
  Timetable: ({ zip, entry, feed, streets }) =>
    ingestGtfsZip(zip, entry, feed).pipe(
      Effect.mapError(failed),
      Effect.flatMap(({ timetable: ingested }) =>
        Effect.try({
          try: () => {
            const timetable =
              streets === undefined
                ? ingested
                : {
                    ...ingested,
                    footpaths: computeFootpaths(
                      makeWalkNetwork(decodeWalkGraph(streets)),
                      ingested.stops,
                    ),
                  };
            const footpaths = timetable.footpaths?.to.length;
            return {
              ...finish(encodeTimetable(timetable)),
              ...(footpaths === undefined ? {} : { footpaths }),
            };
          },
          catch: failed,
        }),
      ),
    ),
  Streets: ({ file, entry, bbox }) =>
    Effect.tryPromise({
      try: () =>
        walkGraphFromPbf(createReadStream(file, { highWaterMark: 1 << 20 }), entry.id, bbox),
      catch: failed,
    }).pipe(
      Effect.map((graph) => ({
        ...finish(encodeWalkGraph(graph)),
        nodes: graph.nodes.count,
        edges: graph.edges.count,
        ...(graph.osmTimestamp === undefined ? {} : { osmTimestamp: graph.osmTimestamp }),
      })),
    ),
});

const Main = RpcServer.layer(CompileRpcs).pipe(
  Layer.provide(handlers),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
);

NodeRuntime.runMain(Layer.launch(Main));
