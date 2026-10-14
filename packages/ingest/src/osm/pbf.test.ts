import { describe, expect, it } from "vitest";
import { inChunks, writePbf, type NodeSpec, type WaySpec } from "./pbf-fixture.ts";
import { OsmFormatError, readOsmPbf, type OsmHeader } from "./pbf.ts";

// Microdegrees near Łódź.
const LAT0 = 51_770_000;
const LON0 = 19_450_000;

interface Seen {
  header: OsmHeader | undefined;
  nodes: Array<{ id: number; lat: number; lon: number }>;
  ways: Array<{
    id: number;
    refs: Array<number>;
    highway: string | undefined;
    name: string | undefined;
  }>;
}

/** Runs the reader and collects everything it reports, copying the reused arrays. */
const read = async (chunks: AsyncIterable<Uint8Array>): Promise<Seen> => {
  const seen: Seen = { header: undefined, nodes: [], ways: [] };
  await readOsmPbf(chunks, {
    header: (header) => {
      seen.header = header;
    },
    nodes: (ids, lat, lon, count) => {
      for (let i = 0; i < count; i++) {
        seen.nodes.push({ id: ids[i] ?? 0, lat: lat[i] ?? 0, lon: lon[i] ?? 0 });
      }
    },
    way: (id, refs, count, tag) => {
      seen.ways.push({
        id,
        refs: Array.from(refs.subarray(0, count)),
        highway: tag("highway"),
        name: tag("name"),
      });
    },
  });
  return seen;
};

const nodesOf = (points: ReadonlyArray<readonly [number, number, number]>): Array<NodeSpec> =>
  points.map(([id, lat, lon]) => ({ id, lat, lon }));

describe("readOsmPbf", () => {
  it("reads the header's features and replication timestamp", async () => {
    const bytes = writePbf([], { timestamp: 1_790_000_000 });
    const seen = await read(inChunks(bytes, bytes.length));
    expect(seen.header).toEqual({
      requiredFeatures: ["OsmSchema-V0.6", "DenseNodes"],
      optionalFeatures: ["Sort.Type_then_ID"],
      timestamp: 1_790_000_000,
    });
  });

  it("leaves the timestamp undefined when the header has none", async () => {
    const bytes = writePbf([]);
    const seen = await read(inChunks(bytes, bytes.length));
    expect(seen.header?.timestamp).toBeUndefined();
  });

  it("decodes dense nodes to microdegrees, including negative deltas", async () => {
    const nodes = nodesOf([
      [10, LAT0, LON0],
      [12, LAT0 + 5_000, LON0 - 7_000],
      [15, LAT0 + 1_000, LON0 - 7_000],
      [16, LAT0 + 1_000, LON0 + 250],
      // Big ids (past 32 bits) and a western longitude: the absolute value goes negative.
      [3_000_000_000, LAT0 - 90_000, -1_000_000],
    ]);
    const bytes = writePbf([{ kind: "nodes", nodes }]);
    const seen = await read(inChunks(bytes, bytes.length));
    expect(seen.nodes).toEqual(nodes.map((n) => ({ id: n.id, lat: n.lat, lon: n.lon })));
  });

  it("honours a non-default granularity", async () => {
    const nodes = nodesOf([
      [1, LAT0, LON0],
      [2, LAT0 + 1_234, LON0 - 4_321],
    ]);
    const bytes = writePbf([{ kind: "nodes", nodes, granularity: 1000 }]);
    const seen = await read(inChunks(bytes, bytes.length));
    expect(seen.nodes).toEqual(nodes.map((n) => ({ id: n.id, lat: n.lat, lon: n.lon })));
  });

  it("decodes ways: refs as delta-coded ids and tag lookups by key", async () => {
    const ways: Array<WaySpec> = [
      {
        id: 100,
        refs: [1, 2, 3, 40, 5],
        tags: { highway: "footway", name: "Piotrkowska" },
      },
      { id: 101, refs: [5, 6] },
    ];
    const bytes = writePbf([{ kind: "ways", ways }]);
    const seen = await read(inChunks(bytes, bytes.length));
    expect(seen.ways).toEqual([
      { id: 100, refs: [1, 2, 3, 40, 5], highway: "footway", name: "Piotrkowska" },
      { id: 101, refs: [5, 6], highway: undefined, name: undefined },
    ]);
  });

  it("gives the same result when the bytes arrive in 7-byte pieces", async () => {
    const bytes = writePbf(
      [
        {
          kind: "nodes",
          nodes: nodesOf([
            [1, LAT0, LON0],
            [2, LAT0 + 900, LON0 + 1450],
            [3, LAT0 - 300, LON0 + 2900],
          ]),
        },
        { kind: "ways", ways: [{ id: 9, refs: [1, 2, 3], tags: { highway: "path" } }] },
      ],
      { timestamp: 1_700_000_000 },
    );
    const whole = await read(inChunks(bytes, bytes.length));
    const pieces = await read(inChunks(bytes, 7));
    expect(whole.nodes).toHaveLength(3);
    expect(whole.ways).toHaveLength(1);
    expect(pieces).toEqual(whole);
  });

  it("throws OsmFormatError on truncated input", async () => {
    const bytes = writePbf([
      { kind: "nodes", nodes: nodesOf([[1, LAT0, LON0]]) },
      { kind: "ways", ways: [{ id: 9, refs: [1, 1] }] },
    ]);
    // Cut into the last blob's data.
    await expect(read(inChunks(bytes.subarray(0, bytes.length - 3), 64))).rejects.toThrow(
      OsmFormatError,
    );
    // Cut into a length prefix.
    await expect(read(inChunks(bytes.subarray(0, 2), 64))).rejects.toThrow(OsmFormatError);
  });

  it("throws on a required feature it does not support", async () => {
    const bytes = writePbf([], { required: ["OsmSchema-V0.6", "Mystery-Feature"] });
    await expect(read(inChunks(bytes, bytes.length))).rejects.toThrow(
      "unsupported features: Mystery-Feature",
    );
  });
});
