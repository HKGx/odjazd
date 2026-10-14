import type { CityId } from "@odjazd/model";

/**
 * A city's walkable network: streets, paths, steps and squares from
 * OpenStreetMap, with chains of plain nodes merged into one edge each. Nodes
 * are junctions and dead ends; an edge keeps the shape between them for
 * drawing. Undirected: walking ignores one-way streets.
 */
export interface WalkGraph {
  readonly cityId: CityId;
  /** When the OSM extract it came from was cut, if the file says. */
  readonly osmTimestamp: string | undefined;
  readonly nodes: {
    readonly count: number;
    /** Microdegrees. */
    readonly lat: Int32Array;
    readonly lon: Int32Array;
  };
  readonly edges: {
    readonly count: number;
    readonly a: Uint32Array;
    readonly b: Uint32Array;
    /** Along the ground, decimeters. */
    readonly length: Uint32Array;
    /** Edge e's inner shape points are `points[firstPoint[e] .. firstPoint[e + 1])`, a to b. */
    readonly firstPoint: Uint32Array;
  };
  readonly points: {
    readonly lat: Int32Array;
    readonly lon: Int32Array;
  };
}

/*
 * Binary file, version 1, laid out like the timetable file:
 *
 *   0  "ODJW"   magic
 *   4  u32      format version
 *   8  u32      header length H
 *  12  H bytes  UTF-8 JSON header: scalars and section table
 *      pad to 8, then typed-array sections, each 8-byte aligned, little-endian
 */

const MAGIC = 0x574a444f; // "ODJW" read as little-endian u32
export const WALK_FORMAT_VERSION = 1;

type Kind = "u32" | "i32";
const sections = [
  ["nodes.lat", "i32"],
  ["nodes.lon", "i32"],
  ["edges.a", "u32"],
  ["edges.b", "u32"],
  ["edges.length", "u32"],
  ["edges.firstPoint", "u32"],
  ["points.lat", "i32"],
  ["points.lon", "i32"],
] as const satisfies ReadonlyArray<readonly [string, Kind]>;
type SectionName = (typeof sections)[number][0];

interface Header {
  readonly cityId: CityId;
  readonly osmTimestamp: string | null;
  readonly nodes: number;
  readonly edges: number;
  readonly sections: Record<SectionName, readonly [offset: number, length: number]>;
}

export class WalkFormatError extends Error {
  override readonly name = "WalkFormatError";
}

const align8 = (n: number) => (n + 7) & ~7;

const columnsOf = (g: WalkGraph): Record<SectionName, Int32Array | Uint32Array> => ({
  "nodes.lat": g.nodes.lat,
  "nodes.lon": g.nodes.lon,
  "edges.a": g.edges.a,
  "edges.b": g.edges.b,
  "edges.length": g.edges.length,
  "edges.firstPoint": g.edges.firstPoint,
  "points.lat": g.points.lat,
  "points.lon": g.points.lon,
});

export const encodeWalkGraph = (graph: WalkGraph): Uint8Array<ArrayBuffer> => {
  const columns = columnsOf(graph);
  const header = (base: number): Header => {
    let cursor = base;
    const table = {} as Record<SectionName, readonly [number, number]>;
    for (const [name] of sections) {
      table[name] = [cursor, columns[name].length];
      cursor = align8(cursor + columns[name].byteLength);
    }
    return {
      cityId: graph.cityId,
      osmTimestamp: graph.osmTimestamp ?? null,
      nodes: graph.nodes.count,
      edges: graph.edges.count,
      sections: table,
    };
  };
  // Offsets live in the header, so its length depends on them: settle in a round or two.
  let base = align8(12 + new TextEncoder().encode(JSON.stringify(header(0))).length);
  let bytes: Uint8Array;
  for (;;) {
    bytes = new TextEncoder().encode(JSON.stringify(header(base)));
    const needed = align8(12 + bytes.length);
    if (needed <= base) break;
    base = needed;
  }
  const final = header(base);
  const end = Math.max(
    ...sections.map(([name]) => align8(final.sections[name][0] + columns[name].byteLength)),
  );
  const out = new Uint8Array(end);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, WALK_FORMAT_VERSION, true);
  view.setUint32(8, bytes.length, true);
  out.set(bytes, 12);
  for (const [name] of sections) {
    const column = columns[name];
    out.set(
      new Uint8Array(column.buffer, column.byteOffset, column.byteLength),
      final.sections[name][0],
    );
  }
  return out;
};

/** Reads a walk graph; columns are views into `bytes`. Throws {@link WalkFormatError}. */
export const decodeWalkGraph = (bytes: Uint8Array): WalkGraph => {
  const data = bytes.byteOffset % 8 === 0 ? bytes : bytes.slice();
  if (data.byteLength < 12) throw new WalkFormatError("file too short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new WalkFormatError("not a walk graph file");
  const version = view.getUint32(4, true);
  if (version !== WALK_FORMAT_VERSION) {
    throw new WalkFormatError(`unsupported format version ${version}`);
  }
  const headerLength = view.getUint32(8, true);
  if (12 + headerLength > data.byteLength) throw new WalkFormatError("truncated header");
  let header: Header;
  try {
    header = JSON.parse(new TextDecoder().decode(data.subarray(12, 12 + headerLength))) as Header;
  } catch {
    throw new WalkFormatError("unreadable header");
  }
  const section = (name: SectionName, kind: Kind) => {
    const entry = header.sections[name];
    if (entry === undefined) throw new WalkFormatError(`missing section ${name}`);
    const [offset, length] = entry;
    if (offset % 8 !== 0 || offset + length * 4 > data.byteLength) {
      throw new WalkFormatError(`section ${name} out of bounds`);
    }
    const at = data.byteOffset + offset;
    return kind === "u32"
      ? new Uint32Array(data.buffer, at, length)
      : new Int32Array(data.buffer, at, length);
  };
  return {
    cityId: header.cityId,
    osmTimestamp: header.osmTimestamp ?? undefined,
    nodes: {
      count: header.nodes,
      lat: section("nodes.lat", "i32") as Int32Array,
      lon: section("nodes.lon", "i32") as Int32Array,
    },
    edges: {
      count: header.edges,
      a: section("edges.a", "u32") as Uint32Array,
      b: section("edges.b", "u32") as Uint32Array,
      length: section("edges.length", "u32") as Uint32Array,
      firstPoint: section("edges.firstPoint", "u32") as Uint32Array,
    },
    points: {
      lat: section("points.lat", "i32") as Int32Array,
      lon: section("points.lon", "i32") as Int32Array,
    },
  };
};
