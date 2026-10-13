import { distanceMeters, type AreaSlug, type InterchangeArea } from "@odjazd/model";
import type { Timetable } from "@odjazd/timetable";

/** An interchange area resolved against one timetable version. */
export interface ResolvedArea {
  readonly slug: AreaSlug;
  /** Member stop indexes, nearest first. */
  readonly stops: Uint32Array;
  /** Distance of each member stop from the area center, meters. */
  readonly distances: Float64Array;
}

/** Stops of `timetable` within the area's radius. Empty if the feed has none there. */
export const resolveArea = (timetable: Timetable, area: InterchangeArea): ResolvedArea => {
  const { lat, lon, count } = timetable.stops;
  const { center, radiusMeters } = area;
  const members: Array<{ stop: number; distance: number }> = [];
  for (let stop = 0; stop < count; stop++) {
    const distance = distanceMeters(center.lat, center.lon, lat[stop] ?? 0, lon[stop] ?? 0);
    if (distance <= radiusMeters) members.push({ stop, distance });
  }
  members.sort((a, b) => a.distance - b.distance || a.stop - b.stop);
  return {
    slug: area.slug,
    stops: Uint32Array.from(members, (m) => m.stop),
    distances: Float64Array.from(members, (m) => m.distance),
  };
};
