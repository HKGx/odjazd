import { type BoundingBox, type CityId, distanceMeters } from "@odjazd/model";
import { describe, expect, it } from "vitest";
import { inChunks, writePbf, type NodeSpec, type WaySpec } from "./pbf-fixture.ts";
import { buildGraph, isWalkable, walkGraphFromPbf } from "./walk-graph.ts";
import { OsmFormatError } from "./pbf.ts";

// Microdegrees near Łódź: 1 µdeg lat ≈ 0.111 m, 1 µdeg lon ≈ 0.069 m.
const LAT0 = 51_770_000;
const LON0 = 19_450_000;
const EAST_200M = 2900;
const NORTH_200M = 1800;
const EAST_150M = 2175;
const NORTH_150M = 1350;

const cityId = "pl-lodz" as CityId;
type Point = readonly [lat: number, lon: number];

/** Points given as (north, east) offsets in microdegrees from the origin. */
const at = (north: number, east: number): Point => [LAT0 + north, LON0 + east];

const build = (points: ReadonlyArray<Point>, pieces: ReadonlyArray<number>) =>
  buildGraph(
    cityId,
    Int32Array.from(points, (p) => p[0]),
    Int32Array.from(points, (p) => p[1]),
    Int32Array.from(pieces),
  );

/** Summed ground distance, in decimeters, along a run of points. */
const decimetersAlong = (points: ReadonlyArray<Point>) => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [aLat, aLon] = points[i - 1] ?? [0, 0];
    const [bLat, bLon] = points[i] ?? [0, 0];
    total += distanceMeters(aLat / 1e6, aLon / 1e6, bLat / 1e6, bLon / 1e6) * 10;
  }
  return total;
};

/** Five points 200 m apart, going east: 800 m in all. */
const chain = (startNorth = 0): Array<Point> =>
  [0, 1, 2, 3, 4].map((i) => at(startNorth, i * EAST_200M));

const tagsOf = (tags: Readonly<Record<string, string>>) => (key: string) => tags[key];

describe("isWalkable", () => {
  it("accepts a footway", () => {
    expect(isWalkable(tagsOf({ highway: "footway" }))).toBe(true);
  });

  it("rejects a motorway", () => {
    expect(isWalkable(tagsOf({ highway: "motorway" }))).toBe(false);
  });

  it("rejects a residential street with foot=no", () => {
    expect(isWalkable(tagsOf({ highway: "residential", foot: "no" }))).toBe(false);
  });

  it("accepts a service road with private access when foot=yes says walking is fine", () => {
    expect(isWalkable(tagsOf({ highway: "service", access: "private", foot: "yes" }))).toBe(true);
    expect(isWalkable(tagsOf({ highway: "service", access: "private" }))).toBe(false);
  });

  it("rejects a trunk road without a sidewalk, accepts one with sidewalk=both", () => {
    expect(isWalkable(tagsOf({ highway: "trunk" }))).toBe(false);
    expect(isWalkable(tagsOf({ highway: "trunk", sidewalk: "both" }))).toBe(true);
    expect(isWalkable(tagsOf({ highway: "trunk", sidewalk: "no" }))).toBe(false);
  });

  it("rejects a way without a highway tag", () => {
    expect(isWalkable(tagsOf({ name: "Nameless" }))).toBe(false);
  });
});

describe("buildGraph", () => {
  it("turns a straight chain of 800 m into two nodes and one edge", () => {
    const points = chain();
    const graph = build(points, [0, 1, 2, 3, 4, -1]);
    expect(graph.nodes.count).toBe(2);
    expect(graph.edges.count).toBe(1);
    expect(Array.from(graph.edges.a)).toEqual([0]);
    expect(Array.from(graph.edges.b)).toEqual([1]);
    expect(graph.edges.length[0]).toBeCloseTo(decimetersAlong(points), 0);
    expect(graph.edges.length[0]).toBeGreaterThan(7_900);
  });

  it("makes a T junction into four nodes and three edges", () => {
    const west = at(0, 0);
    const center = at(0, EAST_200M);
    const east = at(0, 2 * EAST_200M);
    const south = at(-NORTH_200M, EAST_200M);
    const graph = build([west, center, east, south], [0, 1, 2, -1, 1, 3, -1]);
    expect(graph.nodes.count).toBe(4);
    expect(graph.edges.count).toBe(3);
    const expected = [
      decimetersAlong([west, center]),
      decimetersAlong([center, east]),
      decimetersAlong([center, south]),
    ].sort((a, b) => a - b);
    const lengths = Array.from(graph.edges.length).sort((a, b) => a - b);
    lengths.forEach((length, i) => expect(length).toBeCloseTo(expected[i] ?? NaN, 0));
  });

  it("merges two ways that meet end to end into one edge", () => {
    const points = chain();
    // Way one covers points 0-2, way two picks up at 2 and runs to 4.
    const graph = build(points, [0, 1, 2, -1, 2, 3, 4, -1]);
    expect(graph.nodes.count).toBe(2);
    expect(graph.edges.count).toBe(1);
    expect(graph.edges.length[0]).toBeCloseTo(decimetersAlong(points), 0);
  });

  it("drops a fragment shorter than 500 m and keeps the long chain", () => {
    const points = [
      ...chain(),
      // A 150 m fragment about 1 km north of the chain.
      at(9_000, 0),
      at(9_000, EAST_150M),
    ];
    const graph = build(points, [0, 1, 2, 3, 4, -1, 5, 6, -1]);
    expect(graph.nodes.count).toBe(2);
    expect(graph.edges.count).toBe(1);
    expect(Array.from(graph.nodes.lat)).not.toContain(LAT0 + 9_000);
  });

  it("keeps a closed loop of plain points as one self-loop edge", () => {
    const corners = [at(0, 0), at(0, EAST_150M), at(NORTH_150M, EAST_150M), at(NORTH_150M, 0)];
    const graph = build(corners, [0, 1, 2, 3, 0, -1]);
    expect(graph.nodes.count).toBe(1);
    expect(graph.edges.count).toBe(1);
    expect(graph.edges.a[0]).toBe(0);
    expect(graph.edges.b[0]).toBe(0);
    expect(graph.edges.length[0]).toBeCloseTo(
      decimetersAlong([...corners, corners[0] ?? at(0, 0)]),
      0,
    );
  });
});

describe("walkGraphFromPbf", () => {
  const bbox: BoundingBox = { south: 51.75, north: 51.8, west: 19.4, east: 19.5 };
  const timestamp = 1_700_000_000;

  // Nodes 1-5 form a footway chain; node 6 lies north of the box; node 7 sits 200 m
  // north of node 3 and is crossed only by a motorway, which must be ignored.
  const nodes: Array<NodeSpec> = [
    { id: 1, lat: LAT0, lon: LON0 },
    { id: 2, lat: LAT0, lon: LON0 + EAST_200M },
    { id: 3, lat: LAT0, lon: LON0 + 2 * EAST_200M },
    { id: 4, lat: LAT0, lon: LON0 + 3 * EAST_200M },
    { id: 5, lat: LAT0, lon: LON0 + 4 * EAST_200M },
    { id: 6, lat: 52_000_000, lon: LON0 + 4 * EAST_200M },
    { id: 7, lat: LAT0 + NORTH_200M, lon: LON0 + 2 * EAST_200M },
  ];
  const ways: Array<WaySpec> = [
    { id: 100, refs: [1, 2, 3, 4, 5], tags: { highway: "footway" } },
    // Runs out of the box: the piece inside is a lone point, so nothing is added.
    { id: 101, refs: [5, 6], tags: { highway: "footway" } },
    { id: 102, refs: [3, 7], tags: { highway: "motorway" } },
  ];
  const bytes = writePbf(
    [
      { kind: "nodes", nodes },
      { kind: "ways", ways },
    ],
    { timestamp, optional: ["Sort.Type_then_ID"] },
  );

  it("keeps only walkable ways and the nodes inside the box", async () => {
    const graph = await walkGraphFromPbf(inChunks(bytes, 64), "pl-lodz" as never, bbox);
    expect(graph.cityId).toBe("pl-lodz");
    expect(graph.osmTimestamp).toBe(new Date(timestamp * 1000).toISOString());
    expect(graph.nodes.count).toBe(2);
    expect(graph.edges.count).toBe(1);
    expect(Array.from(graph.nodes.lat)).toEqual([LAT0, LAT0]);
    expect(Array.from(graph.nodes.lon)).toEqual([LON0, LON0 + 4 * EAST_200M]);
    expect(graph.edges.length[0]).toBeCloseTo(
      decimetersAlong(nodes.slice(0, 5).map((n) => [n.lat, n.lon] as const)),
      0,
    );
  });

  it("refuses an extract that is not sorted by type then id", async () => {
    const unsorted = writePbf([{ kind: "nodes", nodes }], { optional: [] });
    await expect(
      walkGraphFromPbf(inChunks(unsorted, 64), "pl-lodz" as never, bbox),
    ).rejects.toThrow(OsmFormatError);
  });
});
