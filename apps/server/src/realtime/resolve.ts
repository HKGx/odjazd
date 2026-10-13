import type { Vehicle } from "@odjazd/api";
import type { RawFeed, RawTripUpdate, RawVehicle } from "@odjazd/ingest";
import { distanceMeters } from "@odjazd/model";
import type { Timetable } from "@odjazd/timetable";

/** Feed-id lookups into one timetable; built once per published timetable. */
export interface Resolver {
  readonly trip: (feedId: string) => number | undefined;
  readonly stop: (feedId: string) => number | undefined;
  readonly lineByLabel: (label: string) => number | undefined;
  readonly timetable: Timetable;
}

const labelOf = (id: string) => {
  const short = id.split("@")[0] ?? id;
  return short.slice(short.indexOf(":") + 1);
};

export const makeResolver = (timetable: Timetable): Resolver => {
  const trips = new Map(timetable.trips.feedIds.map((id, i) => [id, i]));
  const stops = new Map(timetable.stops.feedIds.map((id, i) => [id, i]));
  const labels = new Map<string, number>();
  timetable.lines.forEach((line, i) => {
    const label = labelOf(line.id);
    if (!labels.has(label)) labels.set(label, i);
  });
  return {
    trip: (id) => trips.get(id),
    stop: (id) => stops.get(id),
    lineByLabel: (label) => labels.get(label),
    timetable,
  };
};

/** Fixes older than this are dropped: the vehicle has stopped reporting. */
export const staleAfterSeconds = 300;

const bearingBetween = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const rad = Math.PI / 180;
  const y = Math.sin((bLon - aLon) * rad) * Math.cos(bLat * rad);
  const x =
    Math.cos(aLat * rad) * Math.sin(bLat * rad) -
    Math.sin(aLat * rad) * Math.cos(bLat * rad) * Math.cos((bLon - aLon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
};

const latestDelay = (update: RawTripUpdate | undefined, stopSequence: number | undefined) => {
  if (update === undefined) return undefined;
  // The update for the stop the vehicle is heading to, else the last one given.
  const stops = update.stops;
  const current =
    stopSequence === undefined
      ? undefined
      : stops.find((stop) => stop.stopSequence !== undefined && stop.stopSequence >= stopSequence);
  const pick = current ?? stops.at(-1);
  return pick?.departureDelay ?? pick?.arrivalDelay ?? update.delay;
};

/**
 * Feed records to API vehicles. Bearing comes from the feed or, failing that,
 * from movement since `previous` (kept when the vehicle stands still).
 */
export const resolveVehicles = (
  resolver: Resolver | undefined,
  positions: RawFeed<RawVehicle>,
  updates: RawFeed<RawTripUpdate> | undefined,
  previous: ReadonlyMap<string, Vehicle>,
  now: number,
): ReadonlyArray<Vehicle> => {
  const byTrip = new Map(updates?.entities.map((update) => [update.tripId, update]) ?? []);
  const vehicles: Array<Vehicle> = [];
  for (const raw of positions.entities) {
    const at = raw.timestamp ?? positions.timestamp ?? now;
    if (now - at > staleAfterSeconds) continue;
    const timetable = resolver?.timetable;
    const trip = raw.tripId === undefined ? undefined : resolver?.trip(raw.tripId);
    const lineIndex =
      trip !== undefined
        ? timetable?.trips.line[trip]
        : raw.routeId === undefined
          ? undefined
          : resolver?.lineByLabel(raw.routeId);
    const line = lineIndex === undefined ? undefined : timetable?.lines[lineIndex];
    const stop = raw.stopId === undefined ? undefined : resolver?.stop(raw.stopId);
    const headsign = trip === undefined ? undefined : timetable?.trips.headsigns[trip];
    const stopName = stop === undefined ? undefined : timetable?.stops.names[stop];

    const before = previous.get(raw.id);
    let bearing = raw.bearing ?? before?.bearing;
    if (
      raw.bearing === undefined &&
      before !== undefined &&
      before.trip === raw.tripId &&
      distanceMeters(before.lat, before.lon, raw.lat, raw.lon) > 8
    ) {
      bearing = bearingBetween(before.lat, before.lon, raw.lat, raw.lon);
    }
    const delay = latestDelay(
      raw.tripId === undefined ? undefined : byTrip.get(raw.tripId),
      raw.stopSequence,
    );

    vehicles.push({
      id: raw.id,
      ...(raw.label === undefined ? {} : { label: raw.label }),
      ...(line === undefined ? {} : { line: line.id }),
      lineLabel: line === undefined ? (raw.routeId ?? "?") : labelOf(line.id),
      mode: line?.mode ?? "bus",
      ...(raw.tripId === undefined ? {} : { trip: raw.tripId }),
      ...(headsign === undefined || headsign === "" ? {} : { headsign }),
      lat: raw.lat,
      lon: raw.lon,
      ...(bearing === undefined ? {} : { bearing: Math.round(bearing) }),
      ...(raw.speed === undefined ? {} : { speed: Math.round(raw.speed * 10) / 10 }),
      ...(raw.status === undefined ? {} : { status: raw.status }),
      ...(raw.stopId === undefined ? {} : { stop: raw.stopId }),
      ...(stopName === undefined ? {} : { stopName }),
      ...(raw.stopSequence === undefined ? {} : { stopSequence: raw.stopSequence }),
      ...(delay === undefined ? {} : { delay }),
      at,
    });
  }
  return vehicles;
};

const sameVehicle = (a: Vehicle, b: Vehicle) =>
  a.at === b.at &&
  a.lat === b.lat &&
  a.lon === b.lon &&
  a.trip === b.trip &&
  a.delay === b.delay &&
  a.status === b.status &&
  a.stopSequence === b.stopSequence;

/** What changed between two polls. */
export const diffVehicles = (
  previous: ReadonlyMap<string, Vehicle>,
  next: ReadonlyArray<Vehicle>,
): { readonly upserts: ReadonlyArray<Vehicle>; readonly removed: ReadonlyArray<string> } => {
  const seen = new Set<string>();
  const upserts: Array<Vehicle> = [];
  for (const vehicle of next) {
    seen.add(vehicle.id);
    const before = previous.get(vehicle.id);
    if (before === undefined || !sameVehicle(before, vehicle)) upserts.push(vehicle);
  }
  const removed = [...previous.keys()].filter((id) => !seen.has(id));
  return { upserts, removed };
};
