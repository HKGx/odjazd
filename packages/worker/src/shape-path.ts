import type { Timetable } from "@odjazd/timetable";

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** A stop farther than this from its trip's shape means the shape doesn't fit: use stops. */
const maxOffsetMeters = 150;
/** Once a close match is found, moving this far away again means we've passed it. */
const passedMeters = 300;
const closeMeters = 50;

const metersPerDegree = 111_320;

/**
 * The path of `trip` from stop time `board` to `alight` (indexes into
 * `stopTimes`): along the trip's shape when it has one that fits, otherwise
 * straight between stops.
 *
 * Stops are placed on the shape in travel order, each at or after the one
 * before, so loops and out-and-back routes don't snap to the wrong pass. Feeds
 * rarely give `shape_dist_traveled`, so this works from geometry alone.
 */
export const ridePath = (
  timetable: Timetable,
  trip: number,
  board: number,
  alight: number,
): ReadonlyArray<LatLon> => {
  const { stops, stopTimes } = timetable;
  const stopPoint = (st: number): LatLon => {
    const stop = stopTimes.stop[st] ?? 0;
    return { lat: stops.lat[stop] ?? 0, lon: stops.lon[stop] ?? 0 };
  };
  const straight = () => {
    const path: Array<LatLon> = [];
    for (let st = board; st <= alight; st++) path.push(stopPoint(st));
    return path;
  };

  const shapes = timetable.shapes;
  const shape = shapes?.ofTrip[trip] ?? -1;
  if (shapes === undefined || shape < 0) return straight();
  const start = shapes.firstPoint[shape] ?? 0;
  const count = (shapes.firstPoint[shape + 1] ?? 0) - start;
  if (count < 2) return straight();

  const ky = metersPerDegree / 1e6;
  const kx = ky * Math.cos(((shapes.lat[start] ?? 0) / 1e6) * (Math.PI / 180));
  const x = (i: number) => (shapes.lon[start + i] ?? 0) * kx;
  const y = (i: number) => (shapes.lat[start + i] ?? 0) * ky;

  /** Closest point on segments `from..`; stops searching once clearly past a close match. */
  const place = (p: LatLon, from: number) => {
    const px = p.lon * 1e6 * kx;
    const py = p.lat * 1e6 * ky;
    let best = { segment: from, t: 0, distance: Number.POSITIVE_INFINITY };
    for (let i = from; i < count - 1; i++) {
      const ax = x(i);
      const ay = y(i);
      const dx = x(i + 1) - ax;
      const dy = y(i + 1) - ay;
      const length2 = dx * dx + dy * dy;
      const t =
        length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
      const distance = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (distance < best.distance) best = { segment: i, t, distance };
      else if (best.distance < closeMeters && distance > best.distance + passedMeters) break;
    }
    return best;
  };
  const at = (segment: number, t: number): LatLon => {
    const lat0 = shapes.lat[start + segment] ?? 0;
    const lon0 = shapes.lon[start + segment] ?? 0;
    const lat1 = shapes.lat[start + segment + 1] ?? lat0;
    const lon1 = shapes.lon[start + segment + 1] ?? lon0;
    return { lat: (lat0 + (lat1 - lat0) * t) / 1e6, lon: (lon0 + (lon1 - lon0) * t) / 1e6 };
  };

  // Walk the trip from its first stop so the boarding stop lands on the right pass.
  const tripStart = timetable.trips.firstStopTime[trip] ?? board;
  let segment = 0;
  let from: { segment: number; t: number } | undefined;
  let to: { segment: number; t: number } | undefined;
  for (let st = tripStart; st <= alight; st++) {
    const placed = place(stopPoint(st), segment);
    if (placed.distance > maxOffsetMeters) return straight();
    segment = placed.segment;
    if (st === board) from = placed;
    if (st === alight) to = placed;
  }
  if (from === undefined || to === undefined) return straight();

  const path: Array<LatLon> = [];
  // A stop placed exactly on a shape point would otherwise repeat it.
  const push = (p: LatLon) => {
    const last = path[path.length - 1];
    if (last === undefined || last.lat !== p.lat || last.lon !== p.lon) path.push(p);
  };
  push(at(from.segment, from.t));
  for (let i = from.segment + 1; i <= to.segment; i++) {
    push({ lat: (shapes.lat[start + i] ?? 0) / 1e6, lon: (shapes.lon[start + i] ?? 0) / 1e6 });
  }
  push(at(to.segment, to.t));
  return path;
};
