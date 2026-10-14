import { type CityId, distanceMeters } from "@odjazd/model";
import { describe, expect, it } from "vitest";
import type { WalkGraph } from "./graph.ts";
import { type LatLon, makeWalkNetwork } from "./network.ts";

/** Degrees, as the network API takes them. */
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

const need = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("missing fixture entry");
  return value;
};

interface EdgeSpec {
  readonly a: number;
  readonly b: number;
  /** Inner shape points, a to b. */
  readonly via?: ReadonlyArray<Coord>;
}

/** Builds a graph in microdegrees; each edge's length is its polyline's, in decimeters. */
const makeGraph = (nodes: ReadonlyArray<Coord>, edges: ReadonlyArray<EdgeSpec>): WalkGraph => {
  const micro = (c: Coord) => [Math.round(c[0] * 1e6), Math.round(c[1] * 1e6)] as const;
  const firstPoint = new Uint32Array(edges.length + 1);
  const pointLat: Array<number> = [];
  const pointLon: Array<number> = [];
  const length = new Uint32Array(edges.length);
  edges.forEach((edge, e) => {
    const via = edge.via ?? [];
    firstPoint[e + 1] = (firstPoint[e] ?? 0) + via.length;
    for (const c of via) {
      const [lat, lon] = micro(c);
      pointLat.push(lat);
      pointLon.push(lon);
    }
    const line = [need(nodes[edge.a]), ...via, need(nodes[edge.b])].map(micro);
    let meters = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const [aLat = 0, aLon = 0] = line[i] ?? [];
      const [bLat = 0, bLon = 0] = line[i + 1] ?? [];
      meters += distanceMeters(aLat / 1e6, aLon / 1e6, bLat / 1e6, bLon / 1e6);
    }
    length[e] = Math.round(meters * 10);
  });
  return {
    cityId: "pl-test" as CityId,
    osmTimestamp: undefined,
    nodes: {
      count: nodes.length,
      lat: Int32Array.from(nodes, (c) => micro(c)[0] ?? 0),
      lon: Int32Array.from(nodes, (c) => micro(c)[1] ?? 0),
    },
    edges: {
      count: edges.length,
      a: Uint32Array.from(edges, (e) => e.a),
      b: Uint32Array.from(edges, (e) => e.b),
      length,
      firstPoint,
    },
    points: { lat: Int32Array.from(pointLat), lon: Int32Array.from(pointLon) },
  };
};

/** One straight street, 200 m east along north 0. */
const straightGraph = () => makeGraph([at(0, 0), at(0, 200)], [{ a: 0, b: 1 }]);

/** A T junction at the origin: west and east arms on one line, north arm 100 m. */
const tGraph = () =>
  makeGraph(
    [at(0, 0), at(0, -100), at(0, 100), at(100, 0)],
    [
      { a: 0, b: 1 },
      { a: 0, b: 2 },
      { a: 0, b: 3 },
    ],
  );

/** A 100 m square: A (0,0), B (0,100), C (100,100), D (100,0). */
const squareGraph = () =>
  makeGraph(
    [at(0, 0), at(0, 100), at(100, 100), at(100, 0)],
    [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
      { a: 3, b: 0 },
    ],
  );

/** One street from (0,0) to (0,200) bending through (100,100). */
const bentGraph = () => makeGraph([at(0, 0), at(0, 200)], [{ a: 0, b: 1, via: [at(100, 100)] }]);

/** The straight street plus a second, unconnected one 300 m north. */
const twoComponentGraph = () =>
  makeGraph(
    [at(0, 0), at(0, 200), at(300, 0), at(300, 200)],
    [
      { a: 0, b: 1 },
      { a: 2, b: 3 },
    ],
  );

const near = (p: LatLon, c: Coord, tolerance = 1) =>
  distanceMeters(p.lat, p.lon, c[0], c[1]) < tolerance;

const pathLength = (path: ReadonlyArray<LatLon>) => {
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = need(path[i]);
    const b = need(path[i + 1]);
    total += distanceMeters(a.lat, a.lon, b.lat, b.lon);
  }
  return total;
};

describe("snap", () => {
  it("finds the point's edge and the spot along it", () => {
    const snap = makeWalkNetwork(straightGraph()).snap(...at(10, 50));
    expect(snap?.edge).toBe(0);
    expect(snap?.along).toBeCloseTo(50, 0);
    expect(snap?.offset).toBeCloseTo(10, 0);
  });

  it("picks the nearest of several edges", () => {
    const snap = makeWalkNetwork(tGraph()).snap(...at(10, -40));
    // Edge 0 is the west arm: 40 m from its a end (the junction), 10 m off it.
    expect(snap?.edge).toBe(0);
    expect(snap?.along).toBeCloseTo(40, 0);
    expect(snap?.offset).toBeCloseTo(10, 0);
  });

  it("picks the nearer of two parallel streets in a square", () => {
    const snap = makeWalkNetwork(squareGraph()).snap(...at(5, 50));
    expect(snap?.edge).toBe(0);
    expect(snap?.along).toBeCloseTo(50, 0);
    expect(snap?.offset).toBeCloseTo(5, 0);
  });

  it("is undefined beyond 250 m from any street", () => {
    const network = makeWalkNetwork(straightGraph());
    expect(network.snap(...at(240, 50))?.offset).toBeCloseTo(240, 0);
    expect(network.snap(...at(260, 50))).toBeUndefined();
  });
});

describe("from().meters", () => {
  it("walks straight to the street and back on the same edge", () => {
    const reach = makeWalkNetwork(straightGraph()).from(...at(10, 50), 1000);
    // 10 m out, 100 m along, 10 m back in.
    expect(reach?.meters(...at(10, 150))).toBeCloseTo(120, 0);
  });

  it("walks through a junction in a T", () => {
    const reach = makeWalkNetwork(tGraph()).from(...at(10, -40), 1000);
    // 10 m to the west arm, 40 m to the junction, 60 m up the north arm.
    expect(reach?.meters(...at(60, 0))).toBeCloseTo(110, 0);
  });

  it("takes the shorter of the two ways round a square", () => {
    const reach = makeWalkNetwork(squareGraph()).from(...at(0, 10), 1000);
    // Via A and D: 10 + 100 + 70 = 180. Via B and C: 90 + 100 + 30 = 220.
    expect(reach?.meters(...at(100, 70))).toBeCloseTo(180, 0);
  });

  it("is undefined beyond maxMeters", () => {
    const network = makeWalkNetwork(straightGraph());
    expect(network.from(...at(10, 50), 100)?.meters(...at(10, 190))).toBeUndefined();
    expect(network.from(...at(10, 50), 100)?.meters(...at(10, 80))).toBeCloseTo(50, 0);
  });

  it("is undefined for a component no street connects to", () => {
    const network = makeWalkNetwork(twoComponentGraph());
    const reach = network.from(...at(10, 50), 1000);
    // The other street is on the grid (snaps) but no walk reaches it.
    expect(network.snap(...at(300, 50))).toBeDefined();
    expect(reach?.meters(...at(300, 50))).toBeUndefined();
    expect(reach?.route(...at(300, 50))).toBeUndefined();
  });
});

describe("from().route", () => {
  it("follows the inner shape points of a bent edge", () => {
    const reach = makeWalkNetwork(bentGraph()).from(...at(50, 50), 1000);
    const to = at(50, 150);
    const route = reach?.route(...to);
    expect(route).toBeDefined();
    const path = route?.path ?? [];
    expect(path[0]).toEqual({ lat: at(50, 50)[0], lon: at(50, 50)[1] });
    expect(path[path.length - 1]).toEqual({ lat: to[0], lon: to[1] });
    // The bend at (100, 100) is on the way, so the path can't be a straight chord.
    expect(path.some((p) => near(p, at(100, 100)))).toBe(true);
    // 70.7 m to the bend, 70.7 m on: 141.4 m, and the drawn path measures the same.
    expect(route?.meters).toBeCloseTo(141.4, 0);
    expect(pathLength(path)).toBeCloseTo(141.4, 0);
    expect(route?.meters).toBe(reach?.meters(...to));
  });

  it("routes through the junction, and its meters equal meters()", () => {
    const reach = makeWalkNetwork(tGraph()).from(...at(10, -40), 1000);
    const to = at(60, 0);
    const route = reach?.route(...to);
    expect(route?.meters).toBe(reach?.meters(...to));
    const path = route?.path ?? [];
    expect(path[0]).toEqual({ lat: at(10, -40)[0], lon: at(10, -40)[1] });
    expect(path[path.length - 1]).toEqual({ lat: to[0], lon: to[1] });
    expect(path.some((p) => near(p, at(0, 0)))).toBe(true);
    expect(pathLength(path)).toBeCloseTo(110, 0);
  });

  it("goes the shorter way round a square, through D", () => {
    const reach = makeWalkNetwork(squareGraph()).from(...at(0, 10), 1000);
    const to = at(100, 70);
    const route = reach?.route(...to);
    expect(route?.meters).toBeCloseTo(180, 0);
    expect(route?.meters).toBe(reach?.meters(...to));
    const path = route?.path ?? [];
    expect(path[0]).toEqual({ lat: at(0, 10)[0], lon: at(0, 10)[1] });
    expect(path[path.length - 1]).toEqual({ lat: to[0], lon: to[1] });
    expect(path.some((p) => near(p, at(100, 0)))).toBe(true);
    expect(path.some((p) => near(p, at(0, 100)))).toBe(false);
  });

  it("is undefined when the walk is out of reach", () => {
    const reach = makeWalkNetwork(straightGraph()).from(...at(10, 50), 100);
    expect(reach?.route(...at(10, 190))).toBeUndefined();
  });
});
