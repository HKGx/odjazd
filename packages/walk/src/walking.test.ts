import { type CityId, distanceMeters } from "@odjazd/model";
import { describe, expect, it } from "vitest";
import type { WalkGraph } from "./graph.ts";
import { makeWalkNetwork } from "./network.ts";
import { networkWalking } from "./walking.ts";

/** Degrees, as the walking API takes them. */
type Coord = readonly [lat: number, lon: number];

const originLat = 51.77;
const originLon = 19.45;
const metersPerDegLat = 111_320;
const metersPerDegLon = metersPerDegLat * Math.cos((originLat * Math.PI) / 180);

/** A point `north` and `east` meters from the test origin. */
const at = (north: number, east: number): Coord => [
  originLat + north / metersPerDegLat,
  originLon + east / metersPerDegLon,
];

/** One street, 200 m long, running east along north 0. Length from the geometry, in decimeters. */
const straightGraph = (): WalkGraph => {
  const [a, b] = [at(0, 0), at(0, 200)];
  const aLat = Math.round(a[0] * 1e6);
  const aLon = Math.round(a[1] * 1e6);
  const bLat = Math.round(b[0] * 1e6);
  const bLon = Math.round(b[1] * 1e6);
  const meters = distanceMeters(aLat / 1e6, aLon / 1e6, bLat / 1e6, bLon / 1e6);
  return {
    cityId: "pl-test" as CityId,
    osmTimestamp: undefined,
    nodes: { count: 2, lat: Int32Array.of(aLat, bLat), lon: Int32Array.of(aLon, bLon) },
    edges: {
      count: 1,
      a: Uint32Array.of(0),
      b: Uint32Array.of(1),
      length: Uint32Array.of(Math.round(meters * 10)),
      firstPoint: Uint32Array.of(0, 0),
    },
    points: { lat: Int32Array.of(), lon: Int32Array.of() },
  };
};

const network = () => makeWalkNetwork(straightGraph());
const kmhToMps = (kmh: number) => (kmh * 1000) / 3600;
const straight = (from: Coord, to: Coord) => distanceMeters(from[0], from[1], to[0], to[1]);

describe("networkWalking seconds", () => {
  it("is the walked meters over the walking speed, 4.5 km/h by default", () => {
    const walking = networkWalking(network());
    // 10 m out, 100 m along, 10 m back: 120 m at 1.25 m/s.
    expect(walking.seconds(...at(10, 50), ...at(10, 150))).toBeCloseTo(120 / 1.25, 0);
  });

  it("uses the speed given", () => {
    const walking = networkWalking(network(), { speedKmh: 3.6 });
    expect(walking.seconds(...at(10, 50), ...at(10, 150))).toBeCloseTo(120, 0);
  });

  it("never reports less than the straight line", () => {
    const walking = networkWalking(network());
    const from = at(10, 50);
    const to = at(10, 150);
    expect(walking.seconds(...from, ...to) * kmhToMps(4.5)).toBeGreaterThanOrEqual(
      straight(from, to),
    );
  });

  it("falls back to straight line × 1.3 when the start is off the network", () => {
    const walking = networkWalking(network());
    const from = at(300, 50);
    const to = at(10, 50);
    expect(walking.seconds(...from, ...to)).toBeCloseTo(
      (straight(from, to) * 1.3) / kmhToMps(4.5),
      3,
    );
  });

  it("falls back to straight line × 1.3 when the end is off the network", () => {
    const walking = networkWalking(network());
    const from = at(10, 50);
    const to = at(400, 50);
    expect(walking.seconds(...from, ...to)).toBeCloseTo(
      (straight(from, to) * 1.3) / kmhToMps(4.5),
      3,
    );
  });

  it("falls back to straight line × 1.3 beyond 2500 m", () => {
    const walking = networkWalking(network());
    const from = at(10, 50);
    const to = at(10, 2650);
    expect(straight(from, to)).toBeGreaterThan(2500);
    expect(walking.seconds(...from, ...to)).toBeCloseTo(
      (straight(from, to) * 1.3) / kmhToMps(4.5),
      3,
    );
  });
});

describe("networkWalking secondsAlong", () => {
  it("converts a distance already measured along the ground", () => {
    const walking = networkWalking(network());
    expect(walking.secondsAlong(125)).toBeCloseTo(100, 6);
    expect(networkWalking(network(), { speedKmh: 3.6 }).secondsAlong(125)).toBeCloseTo(125, 6);
  });
});

describe("networkWalking route", () => {
  it("returns the street path from start to end", () => {
    const walking = networkWalking(network());
    const from = { lat: at(10, 50)[0], lon: at(10, 50)[1] };
    const to = { lat: at(10, 150)[0], lon: at(10, 150)[1] };
    const route = walking.route(from, to);
    expect(route.meters).toBeCloseTo(120, 0);
    expect(route.path[0]).toEqual(from);
    expect(route.path[route.path.length - 1]).toEqual(to);
  });

  it("falls back to a straight two-point path × 1.3 when off the network", () => {
    const walking = networkWalking(network());
    const from = { lat: at(300, 50)[0], lon: at(300, 50)[1] };
    const to = { lat: at(10, 50)[0], lon: at(10, 50)[1] };
    const route = walking.route(from, to);
    expect(route.meters).toBeCloseTo(distanceMeters(from.lat, from.lon, to.lat, to.lon) * 1.3, 6);
    expect(route.path).toEqual([from, to]);
  });
});
