import type { Timetable } from "./timetable.ts";

/*
 * Binary timetable file, version 3 (2 lacks footpaths, 1 also lacks shapes):
 *
 *   0  "ODJT"            magic
 *   4  u32               format version
 *   8  u32               header length H (bytes)
 *  12  H bytes           UTF-8 JSON header: scalars, strings, section table
 *      pad to 8
 *      sections          typed-array columns, each 8-byte aligned, little-endian
 *
 * The reader returns views into the buffer for every numeric column, so a
 * timetable loaded from disk or the network costs one JSON.parse of the
 * strings plus no copying. Content-addressed by the caller (hash of the bytes).
 */

const MAGIC = 0x544a444f; // "ODJT" read as little-endian u32
export const TIMETABLE_FORMAT_VERSION = 3;
/** Older files still read, e.g. the device's offline copy from before an update. */
const READABLE_VERSIONS: ReadonlyArray<number> = [1, 2, 3];

type ArrayKind = "f64" | "u32" | "i32" | "u8" | "i8";

const sections = [
  ["days.anchors", "f64"],
  ["stops.lat", "f64"],
  ["stops.lon", "f64"],
  ["services.activeDays", "u8"],
  ["trips.line", "u32"],
  ["trips.service", "u32"],
  ["trips.firstStopTime", "u32"],
  ["trips.direction", "i8"],
  ["stopTimes.stop", "u32"],
  ["stopTimes.arrival", "i32"],
  ["stopTimes.departure", "i32"],
  ["stopTimes.flags", "u8"],
] as const satisfies ReadonlyArray<readonly [string, ArrayKind]>;

/** Written only when the timetable has shapes. */
const shapeSections = [
  ["shapes.firstPoint", "u32"],
  ["shapes.lat", "i32"],
  ["shapes.lon", "i32"],
  ["shapes.ofTrip", "i32"],
] as const satisfies ReadonlyArray<readonly [string, ArrayKind]>;

/** Written only when the timetable has footpaths. */
const footpathSections = [
  ["footpaths.first", "u32"],
  ["footpaths.to", "u32"],
  ["footpaths.meters", "u32"],
] as const satisfies ReadonlyArray<readonly [string, ArrayKind]>;

type SectionName =
  | (typeof sections)[number][0]
  | (typeof shapeSections)[number][0]
  | (typeof footpathSections)[number][0];

interface Header {
  readonly cityId: Timetable["cityId"];
  readonly timeZone: Timetable["timeZone"];
  readonly feedVersion: string | null;
  readonly days: { readonly first: Timetable["days"]["first"]; readonly count: number };
  readonly agencies: Timetable["agencies"];
  readonly lines: Timetable["lines"];
  readonly stops: {
    readonly count: number;
    readonly names: ReadonlyArray<string>;
    readonly feedIds: ReadonlyArray<string>;
  };
  readonly services: { readonly count: number; readonly bytesPerService: number };
  readonly trips: {
    readonly count: number;
    readonly headsigns: ReadonlyArray<string>;
    readonly feedIds: ReadonlyArray<string>;
  };
  readonly stopTimes: { readonly count: number };
  readonly shapes?: { readonly count: number };
  /** Byte offset and element count of each section, by name. */
  readonly sections: Partial<Record<SectionName, readonly [offset: number, length: number]>>;
}

export class TimetableFormatError extends Error {
  override readonly name = "TimetableFormatError";
}

const bytesPer: Record<ArrayKind, number> = { f64: 8, u32: 4, i32: 4, u8: 1, i8: 1 };

type Column = ArrayBufferView & { length: number };

const columnsOf = (t: Timetable): Partial<Record<SectionName, Column>> => ({
  "days.anchors": t.days.anchors,
  "stops.lat": t.stops.lat,
  "stops.lon": t.stops.lon,
  "services.activeDays": t.services.activeDays,
  "trips.line": t.trips.line,
  "trips.service": t.trips.service,
  "trips.firstStopTime": t.trips.firstStopTime,
  "trips.direction": t.trips.direction,
  "stopTimes.stop": t.stopTimes.stop,
  "stopTimes.arrival": t.stopTimes.arrival,
  "stopTimes.departure": t.stopTimes.departure,
  "stopTimes.flags": t.stopTimes.flags,
  ...(t.shapes === undefined
    ? {}
    : {
        "shapes.firstPoint": t.shapes.firstPoint,
        "shapes.lat": t.shapes.lat,
        "shapes.lon": t.shapes.lon,
        "shapes.ofTrip": t.shapes.ofTrip,
      }),
  ...(t.footpaths === undefined
    ? {}
    : {
        "footpaths.first": t.footpaths.first,
        "footpaths.to": t.footpaths.to,
        "footpaths.meters": t.footpaths.meters,
      }),
});

const align8 = (n: number) => (n + 7) & ~7;

const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

export const encodeTimetable = (timetable: Timetable): Uint8Array<ArrayBuffer> => {
  if (!littleEndian) throw new TimetableFormatError("big-endian hosts are not supported");
  const columns = columnsOf(timetable);
  const present: ReadonlyArray<readonly [SectionName, ArrayKind, Column]> = [
    ...sections,
    ...shapeSections,
    ...footpathSections,
  ].flatMap(([name, kind]) => {
    const column = columns[name];
    return column === undefined ? [] : [[name, kind, column] as const];
  });

  // Header size depends on section offsets, which depend on header size: lay
  // out sections relative to 0, then shift once the header length is known.
  const relative = new Map<SectionName, readonly [number, number]>();
  let cursor = 0;
  for (const [name, kind, column] of present) {
    relative.set(name, [cursor, column.length]);
    cursor = align8(cursor + column.length * bytesPer[kind]);
  }
  const bodyLength = cursor;

  const shifted = (base: number) => {
    const table: Partial<Record<SectionName, readonly [number, number]>> = {};
    for (const [name, [offset, length]] of relative) table[name] = [base + offset, length];
    return table;
  };

  const headerWith = (base: number): Header => ({
    cityId: timetable.cityId,
    timeZone: timetable.timeZone,
    feedVersion: timetable.feedVersion ?? null,
    days: { first: timetable.days.first, count: timetable.days.count },
    agencies: timetable.agencies,
    lines: timetable.lines,
    stops: {
      count: timetable.stops.count,
      names: timetable.stops.names,
      feedIds: timetable.stops.feedIds,
    },
    services: {
      count: timetable.services.count,
      bytesPerService: timetable.services.bytesPerService,
    },
    trips: {
      count: timetable.trips.count,
      headsigns: timetable.trips.headsigns,
      feedIds: timetable.trips.feedIds,
    },
    stopTimes: { count: timetable.stopTimes.count },
    ...(timetable.shapes === undefined ? {} : { shapes: { count: timetable.shapes.count } }),
    sections: shifted(base),
  });

  // Offsets are numbers in JSON, so their digit count can change the header
  // length; iterate until the layout is stable (one or two rounds).
  let base = align8(12 + new TextEncoder().encode(JSON.stringify(headerWith(0))).length);
  let headerBytes: Uint8Array;
  for (;;) {
    headerBytes = new TextEncoder().encode(JSON.stringify(headerWith(base)));
    const needed = align8(12 + headerBytes.length);
    if (needed <= base) break;
    base = needed;
  }

  const out = new Uint8Array(base + bodyLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, TIMETABLE_FORMAT_VERSION, true);
  view.setUint32(8, headerBytes.length, true);
  out.set(headerBytes, 12);
  for (const [name, , column] of present) {
    out.set(
      new Uint8Array(column.buffer, column.byteOffset, column.byteLength),
      base + (relative.get(name)?.[0] ?? 0),
    );
  }
  return out;
};

/**
 * Reads a timetable file. Numeric columns are views into `bytes` (copied once
 * if `bytes` isn't 8-byte aligned). Throws {@link TimetableFormatError}.
 */
export const decodeTimetable = (bytes: Uint8Array): Timetable => {
  if (!littleEndian) throw new TimetableFormatError("big-endian hosts are not supported");
  const data = bytes.byteOffset % 8 === 0 ? bytes : bytes.slice();
  if (data.byteLength < 12) throw new TimetableFormatError("file too short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new TimetableFormatError("not a timetable file");
  const version = view.getUint32(4, true);
  if (!READABLE_VERSIONS.includes(version)) {
    throw new TimetableFormatError(`unsupported format version ${version}`);
  }
  const headerLength = view.getUint32(8, true);
  if (12 + headerLength > data.byteLength) throw new TimetableFormatError("truncated header");
  const header = JSON.parse(
    new TextDecoder().decode(data.subarray(12, 12 + headerLength)),
  ) as Header;

  const section = <K extends ArrayKind>(name: SectionName, kind: K) => {
    const entry = header.sections[name];
    if (entry === undefined) throw new TimetableFormatError(`missing section ${name}`);
    const [offset, length] = entry;
    if (offset % 8 !== 0 || offset + length * bytesPer[kind] > data.byteLength) {
      throw new TimetableFormatError(`section ${name} out of bounds`);
    }
    const at = data.byteOffset + offset;
    switch (kind) {
      case "f64":
        return new Float64Array(data.buffer, at, length);
      case "u32":
        return new Uint32Array(data.buffer, at, length);
      case "i32":
        return new Int32Array(data.buffer, at, length);
      case "u8":
        return new Uint8Array(data.buffer, at, length);
      default:
        return new Int8Array(data.buffer, at, length);
    }
  };

  return {
    cityId: header.cityId,
    timeZone: header.timeZone,
    feedVersion: header.feedVersion ?? undefined,
    days: { ...header.days, anchors: section("days.anchors", "f64") as Float64Array },
    agencies: header.agencies,
    lines: header.lines,
    stops: {
      ...header.stops,
      lat: section("stops.lat", "f64") as Float64Array,
      lon: section("stops.lon", "f64") as Float64Array,
    },
    services: {
      ...header.services,
      activeDays: section("services.activeDays", "u8") as Uint8Array,
    },
    trips: {
      ...header.trips,
      line: section("trips.line", "u32") as Uint32Array,
      service: section("trips.service", "u32") as Uint32Array,
      firstStopTime: section("trips.firstStopTime", "u32") as Uint32Array,
      direction: section("trips.direction", "i8") as Int8Array,
    },
    stopTimes: {
      ...header.stopTimes,
      stop: section("stopTimes.stop", "u32") as Uint32Array,
      arrival: section("stopTimes.arrival", "i32") as Int32Array,
      departure: section("stopTimes.departure", "i32") as Int32Array,
      flags: section("stopTimes.flags", "u8") as Uint8Array,
    },
    ...(header.shapes === undefined
      ? {}
      : {
          shapes: {
            count: header.shapes.count,
            firstPoint: section("shapes.firstPoint", "u32") as Uint32Array,
            lat: section("shapes.lat", "i32") as Int32Array,
            lon: section("shapes.lon", "i32") as Int32Array,
            ofTrip: section("shapes.ofTrip", "i32") as Int32Array,
          },
        }),
    ...(header.sections["footpaths.first"] === undefined
      ? {}
      : {
          footpaths: {
            first: section("footpaths.first", "u32") as Uint32Array,
            to: section("footpaths.to", "u32") as Uint32Array,
            meters: section("footpaths.meters", "u32") as Uint32Array,
          },
        }),
  };
};
