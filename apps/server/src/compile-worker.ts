import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { inspect } from "node:util";
import { parentPort, workerData } from "node:worker_threads";
import { gzipSync } from "node:zlib";
import type { CatalogEntry, StaticFeed } from "@odjazd/cities";
import { ingestGtfsZip, walkGraphFromPbf } from "@odjazd/ingest";
import type { BoundingBox } from "@odjazd/model";
import { encodeTimetable } from "@odjazd/timetable";
import { computeFootpaths, decodeWalkGraph, encodeWalkGraph, makeWalkNetwork } from "@odjazd/walk";
import { Effect } from "effect";

/*
 * The heavy half of publishing, on a worker thread so the server keeps
 * answering (manifests, downloads, live vehicles) while a city compiles. One
 * job per thread: the thread's memory goes back when it exits.
 */

export type CompileJob =
  | {
      readonly kind: "timetable";
      readonly zip: Uint8Array;
      readonly entry: CatalogEntry;
      readonly feed: StaticFeed;
      /** Encoded walk graph to measure footpaths on. */
      readonly streets: Uint8Array | undefined;
    }
  | {
      readonly kind: "streets";
      /** An `.osm.pbf` extract on disk. */
      readonly file: string;
      readonly entry: CatalogEntry;
      readonly bbox: BoundingBox;
    };

/** A file ready to publish, with what the log line and manifest need. */
export interface CompiledFile {
  readonly bytes: Uint8Array;
  readonly compressed: Uint8Array;
  readonly hash: string;
  readonly summary: Readonly<Record<string, string | number | undefined>>;
}

const finish = (bytes: Uint8Array, summary: CompiledFile["summary"]): CompiledFile => ({
  bytes,
  // A copy: small gzip outputs can sit in Node's shared buffer pool, which can't be transferred.
  compressed: new Uint8Array(gzipSync(bytes, { level: 9 })),
  hash: createHash("sha256").update(bytes).digest("hex"),
  summary,
});

const run = async (job: CompileJob): Promise<CompiledFile> => {
  if (job.kind === "streets") {
    const graph = await walkGraphFromPbf(
      createReadStream(job.file, { highWaterMark: 1 << 20 }),
      job.entry.id,
      job.bbox,
    );
    return finish(encodeWalkGraph(graph), {
      nodes: graph.nodes.count,
      edges: graph.edges.count,
      osmTimestamp: graph.osmTimestamp,
    });
  }
  const { timetable: ingested } = await Effect.runPromise(
    ingestGtfsZip(job.zip, job.entry, job.feed),
  );
  const timetable =
    job.streets === undefined
      ? ingested
      : {
          ...ingested,
          footpaths: computeFootpaths(
            makeWalkNetwork(decodeWalkGraph(job.streets)),
            ingested.stops,
          ),
        };
  return finish(encodeTimetable(timetable), {
    feedVersion: timetable.feedVersion,
    footpaths: timetable.footpaths?.to.length,
  });
};

if (parentPort !== null) {
  const port = parentPort;
  run(workerData as CompileJob).then(
    (result) =>
      port.postMessage({ ok: true, result }, [
        result.bytes.buffer,
        result.compressed.buffer,
      ] as never),
    (error: unknown) =>
      port.postMessage({
        ok: false,
        error: inspect(error, { depth: 6 }),
      }),
  );
}
