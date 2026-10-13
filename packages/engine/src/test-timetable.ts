// Test helper: hand-built single-day timetables. Not exported from the package.
import {
  InterchangeArea,
  parseGtfsTime,
  serviceDayAnchor,
  type AgencySlug,
  type CityId,
  type LineId,
  type Mode,
  type ServiceDate,
  type TimeZone,
} from "@odjazd/model";
import type { Timetable } from "@odjazd/timetable";

export const testDate = "2026-10-14" as ServiceDate;
const timeZone = "Europe/Warsaw" as TimeZone;
export const anchor = serviceDayAnchor(testDate, timeZone);

export interface TripSpec {
  readonly line: string;
  readonly id: string;
  /** [stop id, "HH:MM[:SS]"] or [stop id, time, flags]. */
  readonly stops: ReadonlyArray<readonly [string, string] | readonly [string, string, number]>;
}

const time = (text: string) => {
  const parsed = parseGtfsTime(text.length <= 5 ? `${text}:00` : text);
  if (parsed === undefined) throw new Error(`bad time ${text}`);
  return parsed;
};

/** Instant of `HH:MM[:SS]` on the test day. */
export const at = (text: string) => anchor + time(text);

export const buildTimetable = (
  stops: ReadonlyArray<readonly [string, number, number]>,
  trips: ReadonlyArray<TripSpec>,
): Timetable => {
  const lineIds = [...new Set(trips.map((trip) => trip.line))];
  const stopIndex = new Map(stops.map(([id], i) => [id, i]));
  const stopTimes = trips.flatMap((trip) => trip.stops);
  const firstStopTime = [0];
  for (const trip of trips) firstStopTime.push((firstStopTime.at(-1) ?? 0) + trip.stops.length);
  const stopOf = (id: string) => {
    const index = stopIndex.get(id);
    if (index === undefined) throw new Error(`unknown stop ${id}`);
    return index;
  };
  return {
    cityId: "pl-test" as CityId,
    timeZone,
    feedVersion: undefined,
    days: { first: testDate, count: 1, anchors: Float64Array.of(anchor) },
    agencies: [{ slug: "test" as AgencySlug, name: "Test" }],
    lines: lineIds.map((id) => ({
      id: `${id}@test` as LineId,
      mode: id.split(":")[0] as Mode,
      agency: 0,
    })),
    stops: {
      count: stops.length,
      feedIds: stops.map(([id]) => id),
      names: stops.map(([id]) => id),
      lat: Float64Array.from(stops, ([, lat]) => lat),
      lon: Float64Array.from(stops, ([, , lon]) => lon),
    },
    services: { count: 1, activeDays: Uint8Array.of(1), bytesPerService: 1 },
    trips: {
      count: trips.length,
      line: Uint32Array.from(trips, (trip) => lineIds.indexOf(trip.line)),
      service: new Uint32Array(trips.length),
      firstStopTime: Uint32Array.from(firstStopTime),
      direction: new Int8Array(trips.length).fill(-1),
      headsigns: trips.map(() => ""),
      feedIds: trips.map((trip) => trip.id),
    },
    stopTimes: {
      count: stopTimes.length,
      stop: Uint32Array.from(stopTimes, ([stop]) => stopOf(stop)),
      arrival: Int32Array.from(stopTimes, ([, t]) => time(t)),
      departure: Int32Array.from(stopTimes, ([, t]) => time(t)),
      flags: Uint8Array.from(stopTimes, (st) => st[2] ?? 0),
    },
  };
};

export const area = (slug: string, lat: number, lon: number, radiusMeters = 150) =>
  InterchangeArea.make({
    slug,
    cityId: "pl-test",
    name: slug,
    center: { lat, lon },
    radiusMeters,
  } as InterchangeArea);
