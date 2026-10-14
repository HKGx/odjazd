import type { AgencySlug, CityId, ServiceDate, TimeZone } from "@odjazd/model";
import type { Shapes, Timetable } from "@odjazd/timetable";
import { describe, expect, it } from "vitest";
import { ridePath } from "./shape-path.ts";

type Coord = readonly [lat: number, lon: number];

/**
 * One trip (index 0) visiting `visits` (indexes into `stops`) in order, optionally on a
 * single shape given as degrees. Only the fields ridePath reads carry real data.
 */
const makeTimetable = (
  stops: ReadonlyArray<Coord>,
  visits: ReadonlyArray<number>,
  shape?: ReadonlyArray<Coord>,
): Timetable => {
  const shapes: Shapes | undefined =
    shape === undefined
      ? undefined
      : {
          count: 1,
          firstPoint: Uint32Array.of(0, shape.length),
          lat: Int32Array.from(shape, ([lat]) => Math.round(lat * 1e6)),
          lon: Int32Array.from(shape, ([, lon]) => Math.round(lon * 1e6)),
          ofTrip: Int32Array.of(0),
        };
  return {
    cityId: "pl-test" as CityId,
    timeZone: "Europe/Warsaw" as TimeZone,
    feedVersion: undefined,
    days: { first: "2026-10-14" as ServiceDate, count: 1, anchors: Float64Array.of(0) },
    agencies: [{ slug: "test" as AgencySlug, name: "Test" }],
    lines: [],
    stops: {
      count: stops.length,
      names: stops.map((_, i) => `stop ${i}`),
      feedIds: stops.map((_, i) => `s${i}`),
      lat: Float64Array.from(stops, ([lat]) => lat),
      lon: Float64Array.from(stops, ([, lon]) => lon),
    },
    services: { count: 1, activeDays: Uint8Array.of(1), bytesPerService: 1 },
    trips: {
      count: 1,
      line: Uint32Array.of(0),
      service: Uint32Array.of(0),
      firstStopTime: Uint32Array.of(0, visits.length),
      direction: Int8Array.of(0),
      headsigns: [""],
      feedIds: ["t0"],
    },
    stopTimes: {
      count: visits.length,
      stop: Uint32Array.from(visits),
      arrival: new Int32Array(visits.length),
      departure: new Int32Array(visits.length),
      flags: new Uint8Array(visits.length),
    },
    shapes,
  };
};

/** Compare a path to expected degrees, point by point, to 1e-6 deg (about 0.1 m). */
const expectPath = (path: ReturnType<typeof ridePath>, expected: ReadonlyArray<Coord>) => {
  expect(path).toHaveLength(expected.length);
  expected.forEach(([lat, lon], i) => {
    expect(path[i]?.lat).toBeCloseTo(lat, 6);
    expect(path[i]?.lon).toBeCloseTo(lon, 6);
  });
};

/** A road running east along lat 51.77: shape points every 0.001 deg lon (about 69 m). */
const EAST_ROAD: ReadonlyArray<Coord> = [0, 1, 2, 3, 4, 5, 6].map((k) => [51.77, 19.45 + k / 1000]);

describe("ridePath without a usable shape", () => {
  // Three stops about 11 m north of the road.
  const stops: ReadonlyArray<Coord> = [
    [51.7701, 19.4505],
    [51.7701, 19.4535],
    [51.7701, 19.4555],
  ];

  it("returns the stop coordinates from board to alight when there is no shapes table", () => {
    const tt = makeTimetable(stops, [0, 1, 2]);
    expectPath(ridePath(tt, 0, 0, 2), stops);
    expectPath(ridePath(tt, 0, 1, 2), stops.slice(1));
  });

  it("returns the stop coordinates when the trip has no shape (ofTrip -1)", () => {
    const tt = makeTimetable(stops, [0, 1, 2], EAST_ROAD);
    const shapes = tt.shapes;
    if (shapes === undefined) throw new Error("expected shapes");
    const noShape: Timetable = {
      ...tt,
      shapes: { ...shapes, ofTrip: Int32Array.of(-1) },
    };
    expectPath(ridePath(noShape, 0, 0, 2), stops);
  });

  it("falls back to straight stop-to-stop when a stop is more than 150 m from the shape", () => {
    // Middle stop about 280 m north of the road.
    const far: ReadonlyArray<Coord> = [stops[0]!, [51.7725, 19.4535], stops[2]!];
    expectPath(ridePath(makeTimetable(far, [0, 1, 2], EAST_ROAD), 0, 0, 2), far);
  });

  it("still follows the shape when every stop is within 150 m of it", () => {
    // Middle stop about 134 m north of the road: inside the threshold.
    const near: ReadonlyArray<Coord> = [stops[0]!, [51.7712, 19.4535], stops[2]!];
    const path = ridePath(makeTimetable(near, [0, 1, 2], EAST_ROAD), 0, 0, 2);
    // Shape points 1..5 sit between the first and last stop, so the path is longer than 3.
    expect(path).toHaveLength(7);
  });
});

describe("ridePath along a straight shape", () => {
  // Stops sit about 11 m north of the road, between shape vertices.
  const stops: ReadonlyArray<Coord> = [
    [51.7701, 19.4505],
    [51.7701, 19.4535],
    [51.7701, 19.4555],
  ];
  const tt = makeTimetable(stops, [0, 1, 2], EAST_ROAD);

  it("runs from the first stop to the last, through the shape points between them", () => {
    // Stops are projected onto the road (lat 51.77); intermediate vertices 1..5 are included.
    expectPath(ridePath(tt, 0, 0, 2), [
      [51.77, 19.4505],
      [51.77, 19.451],
      [51.77, 19.452],
      [51.77, 19.453],
      [51.77, 19.454],
      [51.77, 19.455],
      [51.77, 19.4555],
    ]);
  });

  it("for a middle sub-range contains only the shape points between those stops", () => {
    expectPath(ridePath(tt, 0, 1, 2), [
      [51.77, 19.4535],
      [51.77, 19.454],
      [51.77, 19.455],
      [51.77, 19.4555],
    ]);
  });
});

describe("ridePath along an out-and-back shape", () => {
  // Outbound east along lat 51.77, return west along lat 51.7701 (about 11 m north).
  const OUT = [0, 1, 2, 3, 4, 5, 6].map((k): Coord => [51.77, 19.45 + k / 1000]);
  const RET = [0, 1, 2, 3, 4, 5, 6].map((k): Coord => [51.7701, 19.456 - k / 1000]);
  const loop = [...OUT, ...RET];
  const stops: ReadonlyArray<Coord> = [
    [51.77, 19.4505], // 0: outbound, first pass
    [51.77, 19.4555], // 1: outbound, second pass
    [51.7701, 19.4555], // 2: return leg, near stop 1
    [51.7701, 19.4505], // 3: return leg, near stop 0
  ];
  const tt = makeTimetable(stops, [0, 1, 2, 3], loop);

  it("keeps an outbound ride on the outbound part of the shape", () => {
    expectPath(ridePath(tt, 0, 0, 1), [
      [51.77, 19.4505],
      [51.77, 19.451],
      [51.77, 19.452],
      [51.77, 19.453],
      [51.77, 19.454],
      [51.77, 19.455],
      [51.77, 19.4555],
    ]);
  });

  it("places return-leg stops on the return part, so a return ride does not jump back out", () => {
    // Stop 2 is on the return leg at lon 19.4555; stop 3 at lon 19.4505. Only return vertices
    // (lat 51.7701) lie between them.
    expectPath(ridePath(tt, 0, 2, 3), [
      [51.7701, 19.4555],
      [51.7701, 19.455],
      [51.7701, 19.454],
      [51.7701, 19.453],
      [51.7701, 19.452],
      [51.7701, 19.451],
      [51.7701, 19.4505],
    ]);
  });

  it("a ride from the outbound pass to the return leg follows the turn at the far end", () => {
    const path = ridePath(tt, 0, 1, 3);
    expect(path[0]?.lat).toBeCloseTo(51.77, 6);
    expect(path.at(-1)?.lat).toBeCloseTo(51.7701, 6);
    // It goes out to the far end (lon 19.456) and back, so the far end appears.
    expect(path.some((p) => Math.abs(p.lon - 19.456) < 1e-6)).toBe(true);
  });
});
