import type { Shapes } from "@odjazd/timetable";
import { cell, type Table } from "./csv.ts";
import type { Warnings } from "./errors.ts";

/** Points closer than this to the simplified line are dropped: invisible at street zoom. */
const toleranceMeters = 2;

const metersPerDegree = 111_320;

/**
 * Douglas–Peucker on microdegree points, in a local flat projection (fine at
 * city scale). Returns the indexes kept, first and last always included.
 */
export const simplify = (
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  tolerance = toleranceMeters,
): ReadonlyArray<number> => {
  const n = lat.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const ky = metersPerDegree / 1e6;
  const kx = ky * Math.cos(((lat[0] ?? 0) / 1e6) * (Math.PI / 180));
  const x = (i: number) => (lon[i] ?? 0) * kx;
  const y = (i: number) => (lat[i] ?? 0) * ky;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<number> = [0, n - 1];
  while (stack.length > 0) {
    const last = stack.pop() ?? 0;
    const first = stack.pop() ?? 0;
    const ax = x(first);
    const ay = y(first);
    const dx = x(last) - ax;
    const dy = y(last) - ay;
    const length2 = dx * dx + dy * dy;
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const px = x(i) - ax;
      const py = y(i) - ay;
      // Distance to the segment (not the infinite line), so spikes and returns survive.
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / length2));
      const distance = Math.hypot(px - t * dx, py - t * dy);
      if (distance > worstDistance) {
        worst = i;
        worstDistance = distance;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(first, worst, worst, last);
    }
  }
  const kept: Array<number> = [];
  for (let i = 0; i < n; i++) if (keep[i] === 1) kept.push(i);
  return kept;
};

/**
 * The shapes the kept trips use, simplified and with identical geometry stored
 * once. `tripShapeIds[t]` is trip t's `shape_id` ("" for none). `undefined`
 * when no trip has a usable shape.
 */
export const compileShapes = (
  table: Table | undefined,
  tripShapeIds: ReadonlyArray<string>,
  warnings: Warnings,
): Shapes | undefined => {
  if (table === undefined) return undefined;
  const idColumn = table.column("shape_id");
  const latColumn = table.column("shape_pt_lat");
  const lonColumn = table.column("shape_pt_lon");
  const seqColumn = table.column("shape_pt_sequence");
  if (idColumn < 0 || latColumn < 0 || lonColumn < 0 || seqColumn < 0) {
    warnings.add(table.file, "missing-columns", "shapes.txt lacks required columns; ignored", "");
    return undefined;
  }

  const wanted = new Set(tripShapeIds.filter((id) => id !== ""));
  const raw = new Map<string, Array<readonly [seq: number, lat: number, lon: number]>>();
  for (const row of table.rows) {
    const id = cell(row, idColumn);
    if (!wanted.has(id)) continue;
    const lat = Number(cell(row, latColumn));
    const lon = Number(cell(row, lonColumn));
    const seq = Number(cell(row, seqColumn));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(seq)) {
      warnings.add(table.file, "bad-shape-point", "invalid shape point; skipped", id);
      continue;
    }
    let points = raw.get(id);
    if (points === undefined) raw.set(id, (points = []));
    points.push([seq, Math.round(lat * 1e6), Math.round(lon * 1e6)]);
  }

  const index = new Map<string, number>();
  const byGeometry = new Map<string, number>();
  const firstPoint: Array<number> = [0];
  const lat: Array<number> = [];
  const lon: Array<number> = [];
  for (const [id, points] of raw) {
    if (points.length < 2) {
      warnings.add(table.file, "short-shape", "shape has fewer than two points; ignored", id);
      continue;
    }
    points.sort((a, b) => a[0] - b[0]);
    const pLat = points.map((p) => p[1]);
    const pLon = points.map((p) => p[2]);
    const kept = simplify(pLat, pLon);
    const sLat = kept.map((i) => pLat[i] ?? 0);
    const sLon = kept.map((i) => pLon[i] ?? 0);
    const key = `${sLat.join(",")}|${sLon.join(",")}`;
    const existing = byGeometry.get(key);
    if (existing !== undefined) {
      index.set(id, existing);
      continue;
    }
    const shape = firstPoint.length - 1;
    byGeometry.set(key, shape);
    index.set(id, shape);
    lat.push(...sLat);
    lon.push(...sLon);
    firstPoint.push(lat.length);
  }
  if (index.size === 0) return undefined;

  const ofTrip = Int32Array.from(tripShapeIds, (id) => index.get(id) ?? -1);
  const missing = tripShapeIds.find((id) => id !== "" && !index.has(id));
  if (missing !== undefined) {
    warnings.add(table.file, "unknown-shape", "trip's shape_id not in shapes.txt", missing);
  }
  return {
    count: firstPoint.length - 1,
    firstPoint: Uint32Array.from(firstPoint),
    lat: Int32Array.from(lat),
    lon: Int32Array.from(lon),
    ofTrip,
  };
};
