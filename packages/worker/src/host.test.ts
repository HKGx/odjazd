import { area, at, buildTimetable } from "@odjazd/engine/testing";
import { type Corridor, InterchangeArea } from "@odjazd/model";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { makeHost } from "./host.ts";
import { BoardQuery, CompareQuery } from "./schema.ts";

const stops = [
  ["a1", 51.7, 19.46],
  ["b1", 51.71, 19.46],
  ["c1", 51.72, 19.46],
] as const;

const timetable = buildTimetable(stops, [
  {
    line: "tram:1",
    id: "direct",
    stops: [
      ["a1", "08:10"],
      ["c1", "08:30"],
    ],
  },
  {
    line: "tram:2",
    id: "first",
    stops: [
      ["a1", "08:02"],
      ["b1", "08:08"],
    ],
  },
  {
    line: "bus:3",
    id: "second",
    stops: [
      ["b1", "08:12"],
      ["c1", "08:18"],
    ],
  },
]);

const areas = [area("a", 51.7, 19.46), area("b", 51.71, 19.46), area("c", 51.72, 19.46)];
const corridors: ReadonlyArray<typeof Corridor.Encoded> = [
  { slug: "direct", cityId: "pl-test", name: "Direct", legs: [{ from: "a", to: "c", allow: {} }] },
  {
    slug: "via-b",
    cityId: "pl-test",
    name: "Via B",
    legs: [
      { from: "a", to: "b", allow: {} },
      { from: "b", to: "c", allow: {} },
    ],
  },
  { slug: "broken", cityId: "pl-test", name: "Broken", legs: [{ from: "a", to: "x", allow: {} }] },
];

// Queries go through the RPC schemas, as they do on the wire.
const encode = { areas: areas.map((a) => Schema.encodeSync(InterchangeArea)(a)) };

describe("worker host", () => {
  const host = makeHost(timetable);
  const compare = (query: Omit<typeof CompareQuery.Encoded, "hash" | "areas">) =>
    host.compare(Schema.decodeSync(CompareQuery)({ hash: "h", areas: encode.areas, ...query }));
  const boardOf = (query: typeof BoardQuery.Encoded) =>
    host.board(Schema.decodeSync(BoardQuery)(query));

  it("compares corridors into plain DTOs", () => {
    const result = compare({
      corridors,
      date: "2026-10-14",
      from: "08:00",
      to: "08:00",
      stepMinutes: 5,
      transferBufferSec: 60,
    });
    expect(result.inRange).toBe(true);
    expect(result.rejected).toEqual([{ slug: "broken", reason: "unknown area x" }]);
    expect(result.corridors.map((c) => c.slug)).toEqual(["direct", "via-b"]);
    expect(result.corridors[1]?.legs[1]?.lines).toEqual([
      { id: expect.stringContaining("bus:3"), label: "3", mode: "bus", instances: 1 },
    ]);
    const [direct, viaB] = result.rows[0]?.results ?? [];
    expect(direct?.arriveAt).toBeGreaterThanOrEqual(at("08:30"));
    expect(viaB?.legs.map((leg) => [leg.label, leg.boardStop, leg.alightStop])).toEqual([
      ["2", "a1", "b1"],
      ["3", "b1", "c1"],
    ]);
    expect(result.summaries[1]?.earliest).toBe(1);
    expect(() => structuredClone(result)).not.toThrow();
  });

  it("flags dates outside the timetable", () => {
    const result = compare({
      corridors: [],
      date: "2027-01-01",
      from: "08:00",
      to: "09:00",
      stepMinutes: 5,
      transferBufferSec: 60,
    });
    expect(result.inRange).toBe(false);
  });

  it("boards an area", () => {
    const board = boardOf({
      hash: "h",
      area: encode.areas[0] ?? {
        slug: "a",
        cityId: "pl-test",
        name: "a",
        center: { lat: 0, lon: 0 },
        radiusMeters: 10,
      },
      at: at("08:00"),
      horizonMinutes: 60,
      limit: 10,
    });
    expect(board.stops).toEqual([{ name: "a1", distanceMeters: 0 }]);
    expect(board.departures.map((d) => d.label)).toEqual(["2", "1"]);
  });
});
