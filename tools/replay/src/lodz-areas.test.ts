import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { loadCatalog } from "@odjazd/cities";
import { resolveArea } from "@odjazd/engine";
import { ingestGtfsZip } from "@odjazd/ingest";
import { InterchangeArea } from "@odjazd/model";
import { Effect, Schema } from "effect";
import { lodzAreas } from "./fixtures/pl-lodz.ts";

// Real-feed check: ODJAZD_LODZ_GTFS=/path/to/GTFS.zip pnpm test
const zipPath = process.env["ODJAZD_LODZ_GTFS"];

describe.skipIf(zipPath === undefined)("pl-lodz interchange areas", () => {
  it.effect(
    "each fixture area resolves to its stop cluster",
    () =>
      Effect.gen(function* () {
        const catalog = yield* loadCatalog;
        const entry = catalog.find((city) => city.id === "pl-lodz");
        const feed = entry?.feeds.static[0];
        if (entry === undefined || feed === undefined) throw new Error("pl-lodz missing");
        const { timetable } = yield* ingestGtfsZip(readFileSync(zipPath ?? ""), entry, feed);
        const areas = yield* Schema.decodeEffect(Schema.Array(InterchangeArea))(lodzAreas);

        const summary = areas.map((area) => {
          const { stops } = resolveArea(timetable, area);
          return {
            slug: area.slug,
            count: stops.length,
            nearest: timetable.stops.names[stops[0] ?? -1],
          };
        });
        expect(summary).toEqual([
          { slug: "gorniak", count: 9, nearest: "pl. Niepodległości" },
          { slug: "piotrkowska-centrum", count: 8, nearest: "Piotrkowska Centrum" },
          { slug: "mickiewicza-zeromskiego", count: 7, nearest: "Mickiewicza-Żeromskiego" },
          {
            slug: "rondo-lotnikow-lwowskich",
            count: 9,
            nearest: "Pabianicka-Rondo Lotników Lwowskich",
          },
          {
            slug: "dworzec-fabryczna",
            count: 9,
            nearest: "Rodziny Poznańskich-Dw. Łódź Fabryczna",
          },
        ]);
      }),
    60_000,
  );
});
