import type { CityId } from "@odjazd/model";
import { describe, expect, it } from "vitest";
import type { WalkGraph } from "./graph.ts";
import { WalkFormatError, decodeWalkGraph, encodeWalkGraph } from "./graph.ts";

/** Three junction nodes in a chain; the second edge has one inner shape point. */
const makeGraph = (osmTimestamp: string | undefined): WalkGraph => ({
  cityId: "pl-test" as CityId,
  osmTimestamp,
  nodes: {
    count: 3,
    lat: Int32Array.of(51_770_000, 51_770_000, 51_771_000),
    lon: Int32Array.of(19_450_000, 19_451_000, 19_451_000),
  },
  edges: {
    count: 2,
    a: Uint32Array.of(0, 1),
    b: Uint32Array.of(1, 2),
    length: Uint32Array.of(1000, 1420),
    firstPoint: Uint32Array.of(0, 0, 1),
  },
  points: {
    lat: Int32Array.of(51_770_500),
    lon: Int32Array.of(19_450_500),
  },
});

const expectSameGraph = (actual: WalkGraph, expected: WalkGraph) => {
  expect(actual.cityId).toBe(expected.cityId);
  expect(actual.osmTimestamp).toBe(expected.osmTimestamp);
  expect(actual.nodes.count).toBe(expected.nodes.count);
  expect(actual.edges.count).toBe(expected.edges.count);
  expect(actual.nodes.lat).toEqual(expected.nodes.lat);
  expect(actual.nodes.lon).toEqual(expected.nodes.lon);
  expect(actual.edges.a).toEqual(expected.edges.a);
  expect(actual.edges.b).toEqual(expected.edges.b);
  expect(actual.edges.length).toEqual(expected.edges.length);
  expect(actual.edges.firstPoint).toEqual(expected.edges.firstPoint);
  expect(actual.points.lat).toEqual(expected.points.lat);
  expect(actual.points.lon).toEqual(expected.points.lon);
};

describe("walk graph round trip", () => {
  it("keeps every column, the city, and the OSM timestamp", () => {
    const graph = makeGraph("2026-10-01T00:00:00Z");
    expectSameGraph(decodeWalkGraph(encodeWalkGraph(graph)), graph);
  });

  it("keeps an absent OSM timestamp absent", () => {
    const graph = makeGraph(undefined);
    const decoded = decodeWalkGraph(encodeWalkGraph(graph));
    expect(decoded.osmTimestamp).toBeUndefined();
    expectSameGraph(decoded, graph);
  });

  it("decodes from a copy that starts at an unaligned offset", () => {
    const graph = makeGraph("2026-10-01T00:00:00Z");
    const bytes = encodeWalkGraph(graph);
    const shifted = new Uint8Array(bytes.byteLength + 1);
    shifted.set(bytes, 1);
    const unaligned = shifted.subarray(1);
    expect(unaligned.byteOffset % 8).not.toBe(0);
    expectSameGraph(decodeWalkGraph(unaligned), graph);
  });

  it("rejects a file that is too short", () => {
    const bytes = encodeWalkGraph(makeGraph(undefined));
    expect(() => decodeWalkGraph(bytes.subarray(0, 11))).toThrow(WalkFormatError);
    expect(() => decodeWalkGraph(new Uint8Array(0))).toThrow("file too short");
  });

  it("rejects a file with the wrong magic", () => {
    const bytes = encodeWalkGraph(makeGraph(undefined)).slice();
    bytes[0] = 0;
    expect(() => decodeWalkGraph(bytes)).toThrow(WalkFormatError);
    expect(() => decodeWalkGraph(bytes)).toThrow("not a walk graph file");
  });

  it("rejects a future format version", () => {
    const bytes = encodeWalkGraph(makeGraph(undefined)).slice();
    new DataView(bytes.buffer).setUint32(4, 2, true);
    expect(() => decodeWalkGraph(bytes)).toThrow(WalkFormatError);
    expect(() => decodeWalkGraph(bytes)).toThrow("unsupported format version 2");
  });
});
