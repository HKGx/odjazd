import { type CityId, distanceMeters } from "@odjazd/model";
import { describe, expect, it } from "vitest";
import { computeFootpaths } from "./footpaths.ts";
import type { WalkGraph } from "./graph.ts";
import { makeWalkNetwork } from "./network.ts";

/** Degrees, as the network and footpath APIs take them. */
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

/** One street from (0,0) to (0,800), running east along north 0. */
const streetGraph = (): WalkGraph => {
  const [a, b] = [at(0, 0), at(0, 800)];
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

const stopsOf = (coords: ReadonlyArray<Coord>) => ({
  count: coords.length,
  lat: Float64Array.from(coords, (c) => c[0]),
  lon: Float64Array.from(coords, (c) => c[1]),
});

/** The stop indexes listed as reachable from stop `s`. */
const targetsOf = (fp: ReturnType<typeof computeFootpaths>, s: number) =>
  Array.from(fp.to.subarray(fp.first[s] ?? 0, fp.first[s + 1] ?? 0));

// On the street: 0 at 0 m, 1 at 100 m, 2 at 400 m, 3 at 750 m.
const onStreet = [at(0, 0), at(0, 100), at(0, 400), at(0, 750)] as const;

describe("computeFootpaths shape", () => {
  it("is CSR: one offset per stop plus one, non-decreasing, ending at the pair count", () => {
    const network = makeWalkNetwork(streetGraph());
    const fp = computeFootpaths(network, stopsOf(onStreet));
    expect(fp.first.length).toBe(onStreet.length + 1);
    expect(fp.first[0]).toBe(0);
    for (let s = 0; s < onStreet.length; s++) {
      expect(fp.first[s + 1] ?? 0).toBeGreaterThanOrEqual(fp.first[s] ?? 0);
    }
    const pairs = fp.first[onStreet.length] ?? 0;
    expect(pairs).toBe(fp.to.length);
    expect(fp.meters.length).toBe(fp.to.length);
  });

  it("never lists a stop as its own transfer and only names real stops", () => {
    const fp = computeFootpaths(makeWalkNetwork(streetGraph()), stopsOf(onStreet));
    for (let s = 0; s < onStreet.length; s++) {
      for (const t of targetsOf(fp, s)) {
        expect(t).not.toBe(s);
        expect(t).toBeLessThan(onStreet.length);
      }
    }
  });
});

describe("computeFootpaths distances", () => {
  it("lists neighbours within 600 m, excluding those beyond", () => {
    const fp = computeFootpaths(makeWalkNetwork(streetGraph()), stopsOf(onStreet));
    // 0–1 100 m, 0–2 400 m, 0–3 750 m (out); 1–2 300 m, 1–3 650 m (out); 2–3 350 m.
    expect(targetsOf(fp, 0)).toEqual([1, 2]);
    expect(targetsOf(fp, 1)).toEqual([0, 2]);
    expect(targetsOf(fp, 2)).toEqual([0, 1, 3]);
    expect(targetsOf(fp, 3)).toEqual([2]);
  });

  it("measures each walk at least as long as the straight line, and about equal on a straight street", () => {
    const fp = computeFootpaths(makeWalkNetwork(streetGraph()), stopsOf(onStreet));
    for (let s = 0; s < onStreet.length; s++) {
      const targets = targetsOf(fp, s);
      targets.forEach((t, i) => {
        const from = onStreet[s] ?? at(0, 0);
        const to = onStreet[t] ?? at(0, 0);
        const straight = distanceMeters(from[0], from[1], to[0], to[1]);
        const walked = fp.meters[(fp.first[s] ?? 0) + i] ?? 0;
        expect(walked).toBeGreaterThanOrEqual(Math.floor(straight));
        expect(walked).toBeCloseTo(straight, 0);
      });
    }
  });

  it("drops pairs beyond the maxMeters given", () => {
    const network = makeWalkNetwork(streetGraph());
    const narrow = computeFootpaths(network, stopsOf(onStreet), 200);
    // Only the 100 m pair survives at 200 m.
    expect(targetsOf(narrow, 0)).toEqual([1]);
    expect(targetsOf(narrow, 1)).toEqual([0]);
    expect(targetsOf(narrow, 2)).toEqual([]);
    const wide = computeFootpaths(network, stopsOf(onStreet), 1000);
    expect(targetsOf(wide, 0)).toEqual([1, 2, 3]);
  });
});

describe("computeFootpaths off the network", () => {
  it("falls back to straight line × 1.3 within 400 m and to nothing beyond", () => {
    // Three stops 100 m or more north of the street, so none snaps to it.
    const off = [at(400, 0), at(400, 300), at(400, 500)] as const;
    const fp = computeFootpaths(makeWalkNetwork(streetGraph()), stopsOf(off));
    // 0–1 is 300 m: estimated. 0–2 is 500 m: beyond the 400 m fallback, so dropped.
    expect(targetsOf(fp, 0)).toEqual([1]);
    expect(fp.meters[0]).toBeCloseTo(distanceMeters(...off[0], ...off[1]) * 1.3, 0);
    // 1–2 is 200 m: estimated both ways; 2–0 is 500 m: dropped.
    expect(targetsOf(fp, 1)).toEqual([0, 2]);
    expect(targetsOf(fp, 2)).toEqual([1]);
    expect(fp.meters[fp.first[2] ?? 0]).toBeCloseTo(distanceMeters(...off[2], ...off[1]) * 1.3, 0);
  });

  // Documents a suspected bug: a stop that reaches the street network skips every
  // off-network neighbour, even one within 400 m, while that neighbour still lists the
  // stop as a transfer, so the transfer exists in one direction only.
  it("lists an off-network neighbour the stop can reach on foot", () => {
    // Stops 0 and 1 are on the street; stop 2 is 300 m north of it, off the network.
    const mixed = [at(0, 0), at(0, 100), at(300, 100)] as const;
    const fp = computeFootpaths(makeWalkNetwork(streetGraph()), stopsOf(mixed));
    expect(targetsOf(fp, 2)).toContain(0);
    expect(targetsOf(fp, 0)).toContain(2);
  });
});
