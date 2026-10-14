import { describe, expect, it } from "vitest";
import type { Table } from "./csv.ts";
import { compileShapes, simplify } from "./shapes.ts";
import { Warnings } from "./errors.ts";

// Microdegrees near Łódź. At this latitude 1 µdeg lat ≈ 0.111 m and 1 µdeg lon ≈ 0.069 m,
// so 1450 µdeg lon ≈ 100 m east and 900 µdeg lat ≈ 100 m north.
const LAT0 = 51_770_000;
const LON0 = 19_450_000;
const EAST_100M = 1450;
const NORTH_100M = 900;

const table = (
  points: ReadonlyArray<readonly [id: string, lat: number, lon: number, seq: number]>,
): Table => {
  const header = ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"];
  return {
    file: "shapes.txt",
    rows: points.map(([id, lat, lon, seq]) => [id, String(lat), String(lon), String(seq)]),
    column: (name) => header.indexOf(name),
  };
};

/** Shape points in degrees, sequence 1..n, for a shape id. */
const shapeRows = (id: string, degrees: ReadonlyArray<readonly [number, number]>) =>
  degrees.map(([lat, lon], i) => [id, lat, lon, i + 1] as const);

describe("simplify", () => {
  it("returns an empty array for no points", () => {
    expect(simplify([], [])).toEqual([]);
  });

  it("keeps a single point", () => {
    expect(simplify([LAT0], [LON0])).toEqual([0]);
  });

  it("keeps two points", () => {
    expect(simplify([LAT0, LAT0 + NORTH_100M], [LON0, LON0 + EAST_100M])).toEqual([0, 1]);
  });

  it("keeps first and last and drops collinear middle points", () => {
    const lat = [LAT0, LAT0, LAT0, LAT0, LAT0];
    const lon = [LON0, LON0 + 500, LON0 + 1000, LON0 + 1500, LON0 + 2000];
    expect(simplify(lat, lon)).toEqual([0, 4]);
  });

  it("keeps first and last even when they are the same point", () => {
    // A loop that goes out and comes back to the start: the far point must survive.
    expect(simplify([LAT0, LAT0 + NORTH_100M, LAT0], [LON0, LON0, LON0])).toEqual([0, 1, 2]);
    // Identical points have no deviation at all, so only the ends remain.
    expect(simplify([LAT0, LAT0, LAT0], [LON0, LON0, LON0])).toEqual([0, 2]);
  });

  it("keeps the corner of an L shape with ~100 m legs", () => {
    const lat = [LAT0, LAT0, LAT0 + NORTH_100M];
    const lon = [LON0, LON0 + EAST_100M, LON0 + EAST_100M];
    expect(simplify(lat, lon)).toEqual([0, 1, 2]);
  });

  it("drops the middle point of a straight L leg while keeping the corner", () => {
    // Corner at index 1, then a point halfway up the north leg which is collinear with it.
    const lat = [LAT0, LAT0, LAT0 + NORTH_100M / 2, LAT0 + NORTH_100M];
    const lon = [LON0, LON0 + EAST_100M, LON0 + EAST_100M, LON0 + EAST_100M];
    expect(simplify(lat, lon)).toEqual([0, 1, 3]);
  });

  it("keeps a point deviating more than the tolerance and drops one deviating less", () => {
    // Middle point is pushed north of the straight line from first to last.
    // 1 µdeg lat ≈ 0.111 m; with a 0.15 m tolerance, 2 µdeg (0.22 m) is kept, 1 µdeg is dropped.
    const lon = [LON0, LON0 + 500, LON0 + 1000];
    expect(simplify([LAT0, LAT0 + 2, LAT0], lon, 0.15)).toEqual([0, 1, 2]);
    expect(simplify([LAT0, LAT0 + 1, LAT0], lon, 0.15)).toEqual([0, 2]);
  });

  it("uses a default tolerance of 2 m", () => {
    const lon = [LON0, LON0 + 500, LON0 + 1000];
    // 1 µdeg ≈ 0.11 m is well inside 2 m; 30 µdeg ≈ 3.3 m is outside.
    expect(simplify([LAT0, LAT0 + 1, LAT0], lon)).toEqual([0, 2]);
    expect(simplify([LAT0, LAT0 + 30, LAT0], lon)).toEqual([0, 1, 2]);
  });
});

describe("compileShapes", () => {
  it("returns undefined when there is no shapes.txt", () => {
    const warnings = new Warnings();
    expect(compileShapes(undefined, ["s1"], warnings)).toBeUndefined();
    expect(warnings.toArray()).toEqual([]);
  });

  it("sorts points by shape_pt_sequence even when rows are out of order", () => {
    // An L shape: start, corner, end. Rows arrive as 3, 1, 2.
    const corner: readonly [number, number] = [51.77, 19.45 + EAST_100M / 1e6];
    const start: readonly [number, number] = [51.77, 19.45];
    const end: readonly [number, number] = [51.77 + NORTH_100M / 1e6, 19.45 + EAST_100M / 1e6];
    const rows = [
      ["s1", end[0], end[1], 3],
      ["s1", start[0], start[1], 1],
      ["s1", corner[0], corner[1], 2],
    ] as const;
    const shapes = compileShapes(table(rows), ["s1"], new Warnings());
    expect(shapes).toBeDefined();
    expect(shapes?.count).toBe(1);
    expect(Array.from(shapes?.lat ?? [])).toEqual([LAT0, LAT0, LAT0 + NORTH_100M]);
    expect(Array.from(shapes?.lon ?? [])).toEqual([LON0, LON0 + EAST_100M, LON0 + EAST_100M]);
  });

  it("only includes shapes referenced by trips", () => {
    const rows = [
      ...shapeRows("used", [
        [51.77, 19.45],
        [51.78, 19.46],
      ]),
      ...shapeRows("unused", [
        [51.7, 19.4],
        [51.71, 19.41],
      ]),
    ];
    const shapes = compileShapes(table(rows), ["used"], new Warnings());
    expect(shapes?.count).toBe(1);
    expect(Array.from(shapes?.firstPoint ?? [])).toEqual([0, 2]);
    expect(Array.from(shapes?.lat ?? [])).toEqual([LAT0, 51_780_000]);
  });

  it("stores shapes with identical geometry once", () => {
    const geometry = [
      [51.77, 19.45],
      [51.77, 19.46],
      [51.78, 19.46],
    ] as const;
    const rows = [...shapeRows("a", geometry), ...shapeRows("b", geometry)];
    const shapes = compileShapes(table(rows), ["a", "b"], new Warnings());
    expect(shapes?.count).toBe(1);
    expect(Array.from(shapes?.ofTrip ?? [])).toEqual([0, 0]);
    expect(Array.from(shapes?.firstPoint ?? [])).toEqual([0, 3]);
  });

  it("maps trips without a shape id or with an unknown one to -1 and warns about the unknown", () => {
    const warnings = new Warnings();
    const rows = shapeRows("s1", [
      [51.77, 19.45],
      [51.78, 19.46],
    ]);
    const shapes = compileShapes(table(rows), ["s1", "", "nope"], warnings);
    expect(Array.from(shapes?.ofTrip ?? [])).toEqual([0, -1, -1]);
    expect(warnings.toArray()).toEqual([
      expect.objectContaining({
        file: "shapes.txt",
        code: "unknown-shape",
        example: "nope",
        count: 1,
      }),
    ]);
  });

  it("stores coordinates as Int32 microdegrees rounded from degrees", () => {
    // 51.7712344 * 1e6 = 51771234.4 rounds down; 19.4500006 * 1e6 rounds up.
    const rows = shapeRows("s1", [
      [51.7712344, 19.4500006],
      [51.7712346, 19.4612346],
    ]);
    const shapes = compileShapes(table(rows), ["s1"], new Warnings());
    expect(shapes?.lat).toBeInstanceOf(Int32Array);
    expect(shapes?.lon).toBeInstanceOf(Int32Array);
    expect(Array.from(shapes?.lat ?? [])).toEqual([
      Math.round(51.7712344 * 1e6),
      Math.round(51.7712346 * 1e6),
    ]);
    expect(Array.from(shapes?.lon ?? [])).toEqual([
      Math.round(19.4500006 * 1e6),
      Math.round(19.4612346 * 1e6),
    ]);
    expect(Array.from(shapes?.lat ?? [])).toEqual([51_771_234, 51_771_235]);
    expect(Array.from(shapes?.lon ?? [])).toEqual([19_450_001, 19_461_235]);
  });

  it("makes firstPoint one longer than count", () => {
    const rows = [
      ...shapeRows("a", [
        [51.77, 19.45],
        [51.78, 19.46],
      ]),
      ...shapeRows("b", [
        [51.7, 19.4],
        [51.7, 19.42],
        [51.71, 19.42],
      ]),
    ];
    const shapes = compileShapes(table(rows), ["a", "b"], new Warnings());
    expect(shapes?.count).toBe(2);
    expect(shapes?.firstPoint).toBeInstanceOf(Uint32Array);
    expect(shapes?.firstPoint.length).toBe((shapes?.count ?? 0) + 1);
    expect(Array.from(shapes?.firstPoint ?? [])).toEqual([0, 2, 5]);
  });
});
