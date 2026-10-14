// Test helper: writes small OSM PBF files (https://wiki.openstreetmap.org/wiki/PBF_Format).
// Not used by the app; only the tests import it.
import { zlibSync } from "fflate";

type Bytes = Array<number>;

export interface NodeSpec {
  readonly id: number;
  /** Microdegrees. */
  readonly lat: number;
  /** Microdegrees. */
  readonly lon: number;
}

export interface WaySpec {
  readonly id: number;
  readonly refs: ReadonlyArray<number>;
  readonly tags?: Readonly<Record<string, string>>;
}

export type OsmBlock =
  | {
      readonly kind: "nodes";
      readonly nodes: ReadonlyArray<NodeSpec>;
      readonly granularity?: number;
    }
  | { readonly kind: "ways"; readonly ways: ReadonlyArray<WaySpec> };

export interface HeaderSpec {
  readonly required?: ReadonlyArray<string>;
  readonly optional?: ReadonlyArray<string>;
  readonly timestamp?: number;
}

const varint = (value: number): Bytes => {
  const out: Bytes = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
  return out;
};

/** Zigzag for plain numbers: 0, -1, 1, -2, 2 … map to 0, 1, 2, 3, 4 …. */
const zigzag = (n: number) => (n >= 0 ? 2 * n : -2 * n - 1);
const encoder = new TextEncoder();
const key = (field: number, wire: number) => varint(field * 8 + wire);
const varintField = (field: number, value: number): Bytes => [...key(field, 0), ...varint(value)];
const bytesField = (field: number, payload: Iterable<number>): Bytes => {
  const body = Array.from(payload);
  return [...key(field, 2), ...varint(body.length), ...body];
};
const stringField = (field: number, text: string) => bytesField(field, encoder.encode(text));
const deltas = (values: ReadonlyArray<number>) => values.map((v, i) => v - (values[i - 1] ?? 0));
const packedSint = (values: ReadonlyArray<number>): Bytes =>
  values.flatMap((v) => varint(zigzag(v)));
const packedUint = (values: ReadonlyArray<number>): Bytes => values.flatMap((v) => varint(v));

/** Index 0 is always the empty string, as the format requires. */
const stringTable = () => {
  const strings: Array<string> = [""];
  const indexOf = (text: string) => {
    let i = strings.indexOf(text);
    if (i < 0) {
      strings.push(text);
      i = strings.length - 1;
    }
    return i;
  };
  return { strings, indexOf };
};

const nodesGroup = (nodes: ReadonlyArray<NodeSpec>, granularity: number): Bytes => {
  // Coordinates are stored as nanodegrees / granularity, delta-coded.
  const units = (micro: ReadonlyArray<number>) => micro.map((m) => (m * 1000) / granularity);
  const dense: Bytes = [
    ...bytesField(1, packedSint(deltas(nodes.map((n) => n.id)))),
    ...bytesField(8, packedSint(deltas(units(nodes.map((n) => n.lat))))),
    ...bytesField(9, packedSint(deltas(units(nodes.map((n) => n.lon))))),
  ];
  return bytesField(2, dense);
};

const waysGroup = (ways: ReadonlyArray<WaySpec>, table: ReturnType<typeof stringTable>): Bytes =>
  ways.flatMap((way) => {
    const tags = Object.entries(way.tags ?? {});
    const body: Bytes = [
      ...varintField(1, way.id),
      ...(tags.length === 0 ? [] : bytesField(2, packedUint(tags.map(([k]) => table.indexOf(k))))),
      ...(tags.length === 0
        ? []
        : bytesField(3, packedUint(tags.map(([, v]) => table.indexOf(v))))),
      ...bytesField(8, packedSint(deltas(way.refs))),
    ];
    return bytesField(3, body);
  });

const primitiveBlock = (block: OsmBlock): Bytes => {
  const table = stringTable();
  const granularity = block.kind === "nodes" ? (block.granularity ?? 100) : 100;
  const group =
    block.kind === "nodes" ? nodesGroup(block.nodes, granularity) : waysGroup(block.ways, table);
  // The string table is complete only after the group has been encoded.
  const strings = table.strings.flatMap((s) => stringField(1, s));
  return [...bytesField(1, strings), ...bytesField(2, group), ...varintField(17, granularity)];
};

const headerBlock = (spec: HeaderSpec): Bytes => [
  ...(spec.required ?? ["OsmSchema-V0.6", "DenseNodes"]).flatMap((f) => stringField(4, f)),
  ...(spec.optional ?? ["Sort.Type_then_ID"]).flatMap((f) => stringField(5, f)),
  ...(spec.timestamp === undefined ? [] : varintField(32, spec.timestamp)),
];

/** One blob: 4-byte big-endian BlobHeader length, BlobHeader, then the Blob. */
const blob = (type: string, data: Uint8Array): Bytes => {
  const body: Bytes = [...varintField(2, data.length), ...bytesField(3, zlibSync(data))];
  const header: Bytes = [...stringField(1, type), ...varintField(3, body.length)];
  const n = header.length;
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...header, ...body];
};

/** A whole file: the OSMHeader blob, then one OSMData blob per block. */
export const writePbf = (blocks: ReadonlyArray<OsmBlock>, header: HeaderSpec = {}): Uint8Array =>
  Uint8Array.from([
    ...blob("OSMHeader", Uint8Array.from(headerBlock(header))),
    ...blocks.flatMap((block) => blob("OSMData", Uint8Array.from(primitiveBlock(block)))),
  ]);

/** The bytes as a stream of `size`-byte pieces. */
export async function* inChunks(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}
