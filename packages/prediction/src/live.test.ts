import {
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
import { describe, expect, it } from "vitest";
import { liveRealization, tripOfStopTime, type LiveDelay } from "./live.ts";
import { scheduleRealization } from "./realization.ts";

// Hand-built two-day timetable (prediction cannot depend on @odjazd/engine, which depends on it).
// Trip 0 and 1 are tram:1 (stop times 0-2 and 3-5); trip 2 is bus:2 (stop times 6-7).
const date = "2026-10-14" as ServiceDate;
const timeZone = "Europe/Warsaw" as TimeZone;
const anchor = serviceDayAnchor(date, timeZone);

const seconds = (hhmm: string) => parseGtfsTime(`${hhmm}:00`) ?? 0;

const tripSpecs: ReadonlyArray<{
  readonly line: string;
  readonly stops: ReadonlyArray<readonly [number, string]>;
}> = [
  {
    line: "tram:1",
    stops: [
      [0, "08:00"],
      [1, "08:10"],
      [2, "08:20"],
    ],
  },
  {
    line: "tram:1",
    stops: [
      [0, "08:30"],
      [1, "08:40"],
      [2, "08:50"],
    ],
  },
  {
    line: "bus:2",
    stops: [
      [1, "09:00"],
      [3, "09:15"],
    ],
  },
];

const lineIds = ["tram:1", "bus:2"];

const timetable: Timetable = (() => {
  const stopTimes = tripSpecs.flatMap((trip) => trip.stops);
  const firstStopTime = [0];
  for (const trip of tripSpecs) firstStopTime.push((firstStopTime.at(-1) ?? 0) + trip.stops.length);
  const times = stopTimes.map(([, t]) => seconds(t));
  return {
    cityId: "pl-test" as CityId,
    timeZone,
    feedVersion: undefined,
    days: { first: date, count: 2, anchors: Float64Array.of(anchor, anchor + 86_400) },
    agencies: [{ slug: "test" as AgencySlug, name: "Test" }],
    lines: lineIds.map((id) => ({
      id: `${id}@test` as LineId,
      mode: id.split(":")[0] as Mode,
      agency: 0,
    })),
    stops: {
      count: 4,
      names: ["s0", "s1", "s2", "s3"],
      feedIds: ["s0", "s1", "s2", "s3"],
      lat: Float64Array.of(51.7, 51.71, 51.72, 51.73),
      lon: Float64Array.of(19.46, 19.46, 19.46, 19.46),
    },
    services: { count: 1, activeDays: Uint8Array.of(0b11), bytesPerService: 1 },
    trips: {
      count: tripSpecs.length,
      line: Uint32Array.from(tripSpecs, (trip) => lineIds.indexOf(trip.line)),
      service: new Uint32Array(tripSpecs.length),
      firstStopTime: Uint32Array.from(firstStopTime),
      direction: new Int8Array(tripSpecs.length).fill(-1),
      headsigns: tripSpecs.map(() => ""),
      feedIds: tripSpecs.map((_, i) => `t${i}`),
    },
    stopTimes: {
      count: stopTimes.length,
      stop: Uint32Array.from(stopTimes, ([stop]) => stop),
      arrival: Int32Array.from(times),
      departure: Int32Array.from(times),
      flags: new Uint8Array(stopTimes.length),
    },
  };
})();

const base = scheduleRealization(timetable);
const STOP_TIMES = timetable.stopTimes.count;
const DAYS = timetable.days.count;
const allStopTimes = Array.from({ length: STOP_TIMES }, (_, st) => st);
const allDays = Array.from({ length: DAYS }, (_, day) => day);

const delayMap = (...list: ReadonlyArray<LiveDelay>) =>
  new Map(list.map((delay) => [delay.trip, delay] as const));

describe("tripOfStopTime", () => {
  it("maps every stop time to its trip, including first and last stop times", () => {
    const owners = allStopTimes.map((st) => tripOfStopTime(timetable, st));
    expect(owners).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
  });

  it("finds the owner of each trip's first and last stop time", () => {
    expect(tripOfStopTime(timetable, 0)).toBe(0);
    expect(tripOfStopTime(timetable, 2)).toBe(0);
    expect(tripOfStopTime(timetable, 3)).toBe(1);
    expect(tripOfStopTime(timetable, 5)).toBe(1);
    expect(tripOfStopTime(timetable, 6)).toBe(2);
    expect(tripOfStopTime(timetable, 7)).toBe(2);
  });
});

describe("liveRealization", () => {
  it("returns base values for every stop time and day when there are no delays", () => {
    const live = liveRealization(timetable, base, new Map());
    for (const day of allDays) {
      for (const st of allStopTimes) {
        expect(live.arrival(day, st)).toBe(base.arrival(day, st));
        expect(live.departure(day, st)).toBe(base.departure(day, st));
      }
    }
  });

  it("shifts only the matching trip, only on the matching day, from fromStopTime onward", () => {
    const live = liveRealization(
      timetable,
      base,
      delayMap({ trip: 0, day: 0, fromStopTime: 1, delay: 120 }),
    );

    // Before fromStopTime on the matching trip: unchanged.
    expect(live.arrival(0, 0)).toBe(base.arrival(0, 0));
    expect(live.departure(0, 0)).toBe(base.departure(0, 0));

    // From fromStopTime to the end of the trip: shifted by the delay.
    expect(live.arrival(0, 1)).toBe(base.arrival(0, 1) + 120);
    expect(live.departure(0, 1)).toBe(base.departure(0, 1) + 120);
    expect(live.arrival(0, 2)).toBe(base.arrival(0, 2) + 120);
    expect(live.departure(0, 2)).toBe(base.departure(0, 2) + 120);

    // Other trips on the same day: unchanged.
    for (const st of [3, 4, 5, 6, 7]) {
      expect(live.arrival(0, st)).toBe(base.arrival(0, st));
      expect(live.departure(0, st)).toBe(base.departure(0, st));
    }

    // The same trip on the other service day: unchanged.
    for (const st of [0, 1, 2]) {
      expect(live.arrival(1, st)).toBe(base.arrival(1, st));
      expect(live.departure(1, st)).toBe(base.departure(1, st));
    }
  });

  it("applies a delay to a later trip without touching the earlier ones", () => {
    const live = liveRealization(
      timetable,
      base,
      delayMap({ trip: 2, day: 0, fromStopTime: 7, delay: 45 }),
    );
    expect(live.departure(0, 6)).toBe(base.departure(0, 6));
    expect(live.arrival(0, 6)).toBe(base.arrival(0, 6));
    expect(live.departure(0, 7)).toBe(base.departure(0, 7) + 45);
    expect(live.arrival(0, 7)).toBe(base.arrival(0, 7) + 45);
  });

  it("never makes a departure earlier than schedule when the delay is negative", () => {
    const live = liveRealization(
      timetable,
      base,
      delayMap({ trip: 1, day: 0, fromStopTime: 3, delay: -90 }),
    );
    for (const st of [3, 4, 5]) {
      // Arrivals follow the negative delay...
      expect(live.arrival(0, st)).toBe(base.arrival(0, st) - 90);
      // ...departures wait out the scheduled time.
      expect(live.departure(0, st)).toBe(base.departure(0, st));
      expect(live.departure(0, st)).toBeGreaterThanOrEqual(base.departure(0, st));
    }
  });

  it("keeps stop times before fromStopTime unshifted for a negative delay", () => {
    const live = liveRealization(
      timetable,
      base,
      delayMap({ trip: 0, day: 0, fromStopTime: 2, delay: -30 }),
    );
    expect(live.arrival(0, 1)).toBe(base.arrival(0, 1));
    expect(live.departure(0, 1)).toBe(base.departure(0, 1));
    expect(live.arrival(0, 2)).toBe(base.arrival(0, 2) - 30);
    expect(live.departure(0, 2)).toBe(base.departure(0, 2));
  });
});
