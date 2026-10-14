import { CatalogEntry, StaticFeed } from "@odjazd/cities";
import { BoundingBox } from "@odjazd/model";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { Transferable } from "effect/workers";

/*
 * The heavy half of publishing, served by a worker thread (`compile-worker.ts`)
 * so the server keeps answering (manifests, downloads, live vehicles) while a
 * city compiles. Inputs are copied to the thread; results are moved back.
 */

export class CompileFailed extends Schema.TaggedError<CompileFailed>()("CompileFailed", {
  message: Schema.String,
}) {}

const compiled = {
  bytes: Transferable.Uint8Array,
  /** Gzip of `bytes`, level 9. */
  compressed: Transferable.Uint8Array,
  /** SHA-256 of `bytes`, hex. */
  hash: Schema.String,
};

/** A file ready to publish. */
export const CompiledFile = Schema.Struct(compiled);
export type CompiledFile = typeof CompiledFile.Type;

export class CompileRpcs extends RpcGroup.make(
  Rpc.make("Timetable", {
    payload: {
      zip: Schema.Uint8Array,
      entry: CatalogEntry,
      feed: StaticFeed,
      /** Encoded walk graph to measure footpaths on. */
      streets: Schema.optionalKey(Schema.Uint8Array),
    },
    success: Schema.Struct({ ...compiled, footpaths: Schema.optionalKey(Schema.Int) }),
    error: CompileFailed,
  }),
  Rpc.make("Streets", {
    payload: {
      /** An `.osm.pbf` extract on disk. */
      file: Schema.String,
      entry: CatalogEntry,
      bbox: BoundingBox,
    },
    success: Schema.Struct({
      ...compiled,
      nodes: Schema.Int,
      edges: Schema.Int,
      osmTimestamp: Schema.optionalKey(Schema.String),
    }),
    error: CompileFailed,
  }),
) {}
