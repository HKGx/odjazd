import { InterchangeArea, type CityId, type ServiceDate, type TimeZone } from "@odjazd/model";
import type { Timetable } from "@odjazd/timetable";
import { describe, expect, it } from "vitest";
import { resolveArea } from "./areas.ts";

/** A timetable with only stops, enough for area resolution. */
const withStops = (stops: ReadonlyArray<readonly [string, number, number]>): Timetable => ({
  cityId: "pl-test" as CityId,
  timeZone: "Europe/Warsaw" as TimeZone,
  feedVersion: undefined,
  days: { first: "2026-10-13" as ServiceDate, count: 0, anchors: new Float64Array() },
  agencies: [],
  lines: [],
  stops: {
    count: stops.length,
    feedIds: stops.map(([id]) => id),
    names: stops.map(([id]) => id),
    lat: Float64Array.from(stops, ([, lat]) => lat),
    lon: Float64Array.from(stops, ([, , lon]) => lon),
  },
  services: { count: 0, activeDays: new Uint8Array(), bytesPerService: 0 },
  trips: {
    count: 0,
    line: new Uint32Array(),
    service: new Uint32Array(),
    firstStopTime: new Uint32Array([0]),
    direction: new Int8Array(),
    headsigns: [],
    feedIds: [],
  },
  stopTimes: {
    count: 0,
    stop: new Uint32Array(),
    arrival: new Int32Array(),
    departure: new Int32Array(),
    flags: new Uint8Array(),
  },
});

// ~111 m per 0.001° latitude.
const timetable = withStops([
  ["far", 51.745, 19.46],
  ["near", 51.7401, 19.46],
  ["edge", 51.7418, 19.46],
  ["center", 51.74, 19.46],
]);

const area = (radiusMeters: number) =>
  InterchangeArea.make({
    slug: "test",
    cityId: "pl-test",
    name: "Test",
    center: { lat: 51.74, lon: 19.46 },
    radiusMeters,
  } as InterchangeArea);

describe("resolveArea", () => {
  it("returns stops within the radius, nearest first", () => {
    const resolved = resolveArea(timetable, area(250));
    const ids = Array.from(resolved.stops, (s) => timetable.stops.feedIds[s]);
    expect(ids).toEqual(["center", "near", "edge"]);
    expect(resolved.distances[0]).toBe(0);
    expect(resolved.distances[2]).toBeCloseTo(200, -1);
  });

  it("is empty when no stop is in range", () => {
    expect(resolveArea(withStops([["far", 51.745, 19.46]]), area(100)).stops.length).toBe(0);
  });
});
