import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { loadCatalog } from "@odjazd/cities";
import { Effect } from "effect";
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
