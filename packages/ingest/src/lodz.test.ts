import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { loadCatalog } from "@odjazd/cities";
import { Effect } from "effect";
import { gzipSync } from "node:zlib";
import { decodeTimetable, encodeTimetable } from "@odjazd/timetable";
import { ingestGtfsZip } from "./compile.ts";

// Real-feed smoke test: ODJAZD_LODZ_GTFS=/path/to/GTFS.zip pnpm test
const zipPath = process.env["ODJAZD_LODZ_GTFS"];

describe.skipIf(zipPath === undefined)("pl-lodz real feed", () => {
  it.effect(
    "compiles",
    () =>
      Effect.gen(function* () {
        const catalog = yield* loadCatalog;
        const entry = catalog.find((city) => city.id === "pl-lodz");
        const feed = entry?.feeds.static[0];
        if (entry === undefined || feed === undefined) throw new Error("pl-lodz missing");
        const zip = readFileSync(zipPath ?? "");

        const started = performance.now();
        const { timetable, warnings } = yield* ingestGtfsZip(zip, entry, feed);
        const elapsed = performance.now() - started;

        console.log({
          elapsedMs: Math.round(elapsed),
          version: timetable.feedVersion,
          days: `${timetable.days.first} +${timetable.days.count}`,
          lines: timetable.lines.length,
          stops: timetable.stops.count,
          trips: timetable.trips.count,
          stopTimes: timetable.stopTimes.count,
          warnings: warnings.map((w) => `${w.code} ×${w.count} (${w.example})`),
        });
        expect(timetable.lines.some((line) => line.id === "tram:12@zdit-lodz")).toBe(true);
        expect(timetable.trips.count).toBeGreaterThan(40_000);
      }),
    60_000,
  );
});

describe.skipIf(zipPath === undefined)("pl-lodz binary timetable", () => {
  it.effect(
    "round-trips the real feed",
    () =>
      Effect.gen(function* () {
        const catalog = yield* loadCatalog;
        const entry = catalog.find((city) => city.id === "pl-lodz");
        const feed = entry?.feeds.static[0];
        if (entry === undefined || feed === undefined) throw new Error("pl-lodz missing");
        const { timetable } = yield* ingestGtfsZip(readFileSync(zipPath ?? ""), entry, feed);
        const bytes = encodeTimetable(timetable);
        const started = performance.now();
        const decoded = decodeTimetable(bytes);
        const decodeMs = performance.now() - started;
        console.log({
          sizeMb: (bytes.length / 1e6).toFixed(1),
          gzipMb: (gzipSync(bytes).length / 1e6).toFixed(1),
          decodeMs: Math.round(decodeMs),
        });
        expect(decoded).toEqual(timetable);
      }),
    60_000,
  );
});
