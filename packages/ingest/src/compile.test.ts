import { describe, expect, it } from "@effect/vitest";
import { CatalogEntry } from "@odjazd/cities";
import { instantOn, runsOn, StopTimeFlag, type Timetable } from "@odjazd/timetable";
import { Effect, Schema } from "effect";
import { strToU8, zipSync } from "fflate";
import { compileGtfs, ingestGtfsZip } from "./compile.ts";
import type { GtfsFiles } from "./csv.ts";

const license = {
  spdx: "CC-BY-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Test data",
  sourceUrl: "https://example.com/",
};

const makeEntry = (feedAgencyId = "A") =>
  Schema.decodeSync(CatalogEntry)({
    id: "pl-test",
    name: { en: "Test" },
    country: "PL",
    timezone: "Europe/Warsaw",
    bbox: { south: 51.7, west: 19.4, north: 51.8, east: 19.5 },
    center: { lat: 51.77, lon: 19.45 },
    status: "enabled",
    feeds: {
      static: [
        {
          id: "main",
          url: "https://example.com/gtfs.zip",
          agencies: [{ slug: "test-agency", feedAgencyId, name: "Test Agency" }],
          checkIntervalSeconds: 3600,
          license,
        },
      ],
      realtime: [],
    },
  });
const entry = makeEntry();
const feed = entry.feeds.static[0]!;

const csv = (...lines: ReadonlyArray<string>) => lines.join("\n") + "\n";

// Each trip exercises one case; see the comments in stop_times.txt below.
const base: Record<string, string> = {
  "agency.txt": csv(
    "agency_id,agency_name,agency_url,agency_timezone",
    "A,Test Agency,https://example.com,Europe/Warsaw",
  ),
  "stops.txt": csv(
    "﻿stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
    "S1,One,51.77,19.45,0,",
    `S2,Two "B" 01,51.78,19.46,0,`, // bare quotes mid-field, as Gdańsk writes them
    `S3,"Three, Main",51.79,19.47,,`,
    "ST,Station,51.77,19.45,1,",
  ),
  "routes.txt": csv(
    "route_id,agency_id,route_short_name,route_long_name,route_type",
    "R12,A,12,,0",
    "R12b,A, 12 ,,900", // same line as R12 (extended tram type, padded name)
    "RZ1,A,Z1,,3",
    "RT,A,T,,1500", // taxi: not routable
    "RX,A,,Long Name,3", // no usable short name
  ),
  "trips.txt": csv(
    "route_id,service_id,trip_id,trip_headsign,direction_id",
    "R12,WD,T1,Three,0",
    "R12b,WD,T2,One,1",
    "RZ1,WD,T3,,",
    "RZ1,WD,T4,,",
    "RZ1,WD,T5,,",
    "RZ1,WD,T6,,",
    "RZ1,NOPE,T7,,",
    "RT,WD,T8,,",
    "RZ1,DST,T9,,",
  ),
  "calendar.txt": csv(
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
    "WD,1,1,1,1,1,0,0,20261012,20261025",
  ),
  "calendar_dates.txt": csv(
    "service_id,date,exception_type",
    "WD,20261014,2", // Wednesday removed
    "WD,20261017,1", // Saturday added
    "DST,20261024,1", // the night clocks go back
  ),
  "stop_times.txt": csv(
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type",
    // T1: rows out of order, pickup/drop-off flags
    "T1,08:10:00,08:10:00,S3,30,,",
    "T1,8:00:00,08:00:00,S1,10,,1",
    "T1,08:05:00,08:06:00,S2,20,2,",
    // T2: past midnight
    "T2,25:30:00,25:30:00,S3,1,,",
    "T2,25:40:00,25:40:00,S1,2,,",
    // T3: untimed middle stop
    "T3,08:00:00,08:00:00,S1,1,,",
    "T3,,,S2,2,,",
    "T3,08:10:00,08:10:00,S3,3,,",
    // T4: time goes backwards
    "T4,09:00:00,09:00:00,S1,1,,",
    "T4,08:50:00,08:50:00,S2,2,,",
    // T5: unknown stop
    "T5,10:00:00,10:00:00,S1,1,,",
    "T5,10:05:00,10:05:00,SX,2,,",
    // T6: single stop
    "T6,11:00:00,11:00:00,S1,1,,",
    // T9: crosses the 2026-10-25 fall-back hour
    "T9,26:30:00,26:30:00,S1,1,,",
    "T9,27:30:00,27:30:00,S2,2,,",
  ),
};

const filesOf = (overrides: Record<string, string | undefined> = {}): GtfsFiles => {
  const merged = { ...base, ...overrides };
  return new Map(
    Object.entries(merged).flatMap(([name, text]) =>
      text === undefined ? [] : [[name, strToU8(text)] as const],
    ),
  );
};

const compile = (overrides?: Record<string, string | undefined>) =>
  compileGtfs(filesOf(overrides), entry, feed);

const tripIndex = (timetable: Timetable, feedId: string) => timetable.trips.feedIds.indexOf(feedId);

const stopTimesOf = (timetable: Timetable, feedId: string) => {
  const t = tripIndex(timetable, feedId);
  const { firstStopTime } = timetable.trips;
  const from = firstStopTime[t] ?? 0;
  const to = firstStopTime[t + 1] ?? 0;
  const { stop, arrival, departure, flags } = timetable.stopTimes;
  return Array.from({ length: to - from }, (_, i) => ({
    stop: timetable.stops.feedIds[stop[from + i] ?? 0],
    arrival: arrival[from + i],
    departure: departure[from + i],
    flags: flags[from + i],
  }));
};

const hms = (h: number, m: number) => h * 3600 + m * 60;
const utc = (iso: string) => Date.parse(iso) / 1000;

describe("compileGtfs", () => {
  it.effect("keeps rideable trips and reports the rest", () =>
    Effect.gen(function* () {
      const { timetable, warnings } = yield* compile();
      expect(timetable.trips.feedIds).toEqual(["T1", "T2", "T3", "T9"]);
      expect(warnings.map((w) => [w.code, w.example]).sort()).toEqual(
        [
          ["bad-line-number", "RX"],
          ["interpolated-times", "T3"],
          ["non-monotonic-times", "T4"],
          ["too-few-stops", "T6"],
          ["unknown-route", "T8"],
          ["unknown-service", "T7"],
          ["unknown-stop", "T5"],
          ["unsupported-route-type", "RT"],
        ].sort(),
      );
    }),
  );

  it.effect("maps routes to agency-qualified lines, merging same-numbered routes", () =>
    Effect.gen(function* () {
      const { timetable } = yield* compile();
      expect(timetable.agencies).toEqual([{ slug: "test-agency", name: "Test Agency" }]);
      expect(timetable.lines.map((line) => line.id)).toEqual([
        "tram:12@test-agency",
        "bus:Z1@test-agency",
      ]);
      const lineOf = (feedId: string) =>
        timetable.lines[timetable.trips.line[tripIndex(timetable, feedId)] ?? -1]?.id;
      expect(lineOf("T1")).toBe("tram:12@test-agency");
      expect(lineOf("T2")).toBe("tram:12@test-agency");
    }),
  );

  it.effect("keeps only boarding stops, parsing BOM headers and quoted names", () =>
    Effect.gen(function* () {
      const { timetable } = yield* compile();
      expect(timetable.stops.feedIds).toEqual(["S1", "S2", "S3"]);
      expect(timetable.stops.names[1]).toBe('Two "B" 01');
      expect(timetable.stops.names[2]).toBe("Three, Main");
      expect(timetable.stops.lat[1]).toBe(51.78);
    }),
  );

  it.effect("orders stop times by stop_sequence and keeps pickup/drop-off flags", () =>
    Effect.gen(function* () {
      const { timetable } = yield* compile();
      expect(stopTimesOf(timetable, "T1")).toEqual([
        { stop: "S1", arrival: hms(8, 0), departure: hms(8, 0), flags: StopTimeFlag.noDropOff },
        { stop: "S2", arrival: hms(8, 5), departure: hms(8, 6), flags: StopTimeFlag.onRequest },
        { stop: "S3", arrival: hms(8, 10), departure: hms(8, 10), flags: 0 },
      ]);
      const t = tripIndex(timetable, "T1");
      expect(timetable.trips.headsigns[t]).toBe("Three");
      expect(timetable.trips.direction[t]).toBe(0);
      expect(timetable.trips.direction[tripIndex(timetable, "T3")]).toBe(-1);
    }),
  );

  it.effect("interpolates untimed stops", () =>
    Effect.gen(function* () {
      const { timetable } = yield* compile();
      expect(stopTimesOf(timetable, "T3").map((st) => st.arrival)).toEqual([
        hms(8, 0),
        hms(8, 5),
        hms(8, 10),
      ]);
    }),
  );

  it.effect("applies calendar weekdays and calendar_dates exceptions", () =>
    Effect.gen(function* () {
      const { timetable } = yield* compile();
      // WD runs Mon 10-12 .. Fri 10-23 plus Sat 10-17; DST adds Sat 10-24.
      expect(timetable.days.first).toBe("2026-10-12");
      expect(timetable.days.count).toBe(13);
      const wd = timetable.trips.service[tripIndex(timetable, "T1")] ?? -1;
      const running = Array.from({ length: 13 }, (_, day) => runsOn(timetable, wd, day));
      expect(running).toEqual([
        true, // Mon 12
        true,
        false, // Wed 14 removed
        true,
        true,
        true, // Sat 17 added
        false, // Sun 18
        true,
        true,
        true,
        true,
        true, // Fri 23
        false, // Sat 24
      ]);
      expect(runsOn(timetable, wd, -1)).toBe(false);
      expect(runsOn(timetable, wd, 13)).toBe(false);
    }),
  );

  it.effect("turns offsets into DST-correct instants", () =>
    Effect.gen(function* () {
      const { timetable } = yield* compile();
      // T2 at 25:30 on Mon 10-12 (CEST) is 01:30 local on Tue 10-13.
      expect(instantOn(timetable, 0, hms(25, 30))).toBe(utc("2026-10-12T23:30:00Z"));
      // T9 on Sat 10-24 runs 02:30 CEST → 02:30 CET: one real hour.
      const [depart, arrive] = stopTimesOf(timetable, "T9");
      const day = 12;
      const departAt = instantOn(timetable, day, depart?.departure ?? 0);
      const arriveAt = instantOn(timetable, day, arrive?.arrival ?? 0);
      expect(departAt).toBe(utc("2026-10-25T00:30:00Z"));
      expect(arriveAt - departAt).toBe(3600);
    }),
  );

  it.effect("reads feed_version when present", () =>
    Effect.gen(function* () {
      expect((yield* compile()).timetable.feedVersion).toBeUndefined();
      const withInfo = yield* compile({
        "feed_info.txt": csv("feed_publisher_name,feed_version", "Test,v42"),
      });
      expect(withInfo.timetable.feedVersion).toBe("v42");
    }),
  );
});

describe("compileGtfs failures", () => {
  const failure = (effect: ReturnType<typeof compile>) =>
    Effect.map(Effect.flip(effect), (error) => ({
      tag: error._tag,
      file: error.file,
      message: error.message,
    }));

  it.effect("required file missing", () =>
    Effect.gen(function* () {
      const error = yield* failure(compile({ "stops.txt": undefined }));
      expect(error).toMatchObject({ tag: "GtfsValidationError", file: "stops.txt" });
    }),
  );

  it.effect("required column missing", () =>
    Effect.gen(function* () {
      const error = yield* failure(compile({ "stops.txt": csv("stop_id,stop_name", "S1,One") }));
      expect(error.message).toContain("stop_lat, stop_lon");
    }),
  );

  it.effect("agency not mapped in the catalog", () =>
    Effect.gen(function* () {
      const other = makeEntry("B");
      const error = yield* Effect.flip(compileGtfs(filesOf(), other, other.feeds.static[0]!));
      expect(error.message).toContain("agency_id A has no mapping");
    }),
  );

  it.effect("agency time zone disagrees with the catalog", () =>
    Effect.gen(function* () {
      const agency = csv(
        "agency_id,agency_name,agency_url,agency_timezone",
        "A,Test Agency,https://example.com,America/New_York",
      );
      const error = yield* failure(compile({ "agency.txt": agency }));
      expect(error.message).toContain("America/New_York");
    }),
  );

  it.effect("no calendar at all", () =>
    Effect.gen(function* () {
      const error = yield* failure(
        compile({ "calendar.txt": undefined, "calendar_dates.txt": undefined }),
      );
      expect(error.message).toContain("neither calendar.txt nor calendar_dates.txt");
    }),
  );
});

describe("ingestGtfsZip", () => {
  it.effect("reads files from a zip, also inside a folder", () =>
    Effect.gen(function* () {
      const zip = zipSync(
        Object.fromEntries(
          Object.entries(base).map(([name, text]) => [`gtfs/${name}`, strToU8(text)]),
        ),
      );
      const { timetable } = yield* ingestGtfsZip(zip, entry, feed);
      expect(timetable.trips.count).toBe(4);
    }),
  );

  it.effect("rejects bytes that aren't a zip", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(ingestGtfsZip(strToU8("not a zip"), entry, feed));
      expect(error._tag).toBe("GtfsParseError");
    }),
  );
});
