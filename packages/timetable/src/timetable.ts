import type {
  AgencySlug,
  CityId,
  EpochSeconds,
  LineId,
  Mode,
  ServiceDate,
  TimeZone,
} from "@odjazd/model";

/**
 * A compiled static timetable for one feed version: struct-of-arrays over
 * typed arrays, so the engine can scan it without allocation and the binary
 * format is a straight dump of these columns.
 *
 * Times are stored once per trip as offsets from a service day's anchor and
 * become absolute instants through `days.anchors`, which already accounts for
 * DST. Feed ids are kept only for matching realtime data against this version.
 */
export interface Timetable {
  readonly cityId: CityId;
  readonly timeZone: TimeZone;
  /** `feed_info.feed_version`, if the feed has one. */
  readonly feedVersion: string | undefined;
  readonly days: ServiceDays;
  readonly agencies: ReadonlyArray<Agency>;
  readonly lines: ReadonlyArray<Line>;
  readonly stops: Stops;
  readonly services: Services;
  readonly trips: Trips;
  readonly stopTimes: StopTimes;
  /** Road and track geometry of trips (`shapes.txt`); absent when the feed has none. */
  readonly shapes?: Shapes | undefined;
}

export interface ServiceDays {
  readonly first: ServiceDate;
  readonly count: number;
  /** Anchor (GTFS "noon minus 12 h") of each day, epoch seconds. Index = day. */
  readonly anchors: Float64Array;
}

export interface Agency {
  readonly slug: AgencySlug;
  readonly name: string;
}

export interface Line {
  readonly id: LineId;
  readonly mode: Mode;
  /** Index into `agencies`. */
  readonly agency: number;
}

export interface Stops {
  readonly count: number;
  readonly names: ReadonlyArray<string>;
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  readonly feedIds: ReadonlyArray<string>;
}

export interface Services {
  readonly count: number;
  /** Bitset, `bytesPerService` bytes per service; bit d set = runs on day d. */
  readonly activeDays: Uint8Array;
  readonly bytesPerService: number;
}

export interface Trips {
  readonly count: number;
  /** Index into `lines`. */
  readonly line: Uint32Array;
  /** Index into services. */
  readonly service: Uint32Array;
  /**
   * Trip t's stop times are `stopTimes[firstStopTime[t] .. firstStopTime[t + 1])`,
   * in travel order. Length `count + 1`.
   */
  readonly firstStopTime: Uint32Array;
  /** GTFS direction_id, or -1 if absent. */
  readonly direction: Int8Array;
  readonly headsigns: ReadonlyArray<string>;
  readonly feedIds: ReadonlyArray<string>;
}

/** Bits of {@link StopTimes.flags}. */
export const StopTimeFlag = {
  noPickup: 1,
  noDropOff: 2,
  /** Pickup or drop-off only on request (GTFS 2 / 3). */
  onRequest: 4,
} as const;

export interface StopTimes {
  readonly count: number;
  /** Index into stops. */
  readonly stop: Uint32Array;
  /** Seconds after the service day anchor. */
  readonly arrival: Int32Array;
  readonly departure: Int32Array;
  readonly flags: Uint8Array;
}

export interface Shapes {
  readonly count: number;
  /** Shape s's points are `[firstPoint[s], firstPoint[s + 1])`. Length `count + 1`. */
  readonly firstPoint: Uint32Array;
  /** Microdegrees (about 0.1 m). */
  readonly lat: Int32Array;
  readonly lon: Int32Array;
  /** Shape of each trip, or -1. Length `trips.count`. */
  readonly ofTrip: Int32Array;
}

/** Whether `service` runs on service day `day` (index into `days`). */
export const runsOn = (timetable: Timetable, service: number, day: number): boolean => {
  if (day < 0 || day >= timetable.days.count) return false;
  const { activeDays, bytesPerService } = timetable.services;
  const byte = activeDays[service * bytesPerService + (day >> 3)] ?? 0;
  return (byte & (1 << (day & 7))) !== 0;
};

/** Absolute instant of a stop time offset on service day `day`. */
export const instantOn = (timetable: Timetable, day: number, offset: number): EpochSeconds =>
  ((timetable.days.anchors[day] ?? Number.NaN) + offset) as EpochSeconds;
