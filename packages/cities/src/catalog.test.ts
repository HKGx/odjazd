import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { plLodz } from "./entries/pl-lodz.ts";
import { entries, loadCatalog } from "./index.ts";
import { Catalog, CatalogEntry, ingested, selectable } from "./schema.ts";

type Encoded = typeof CatalogEntry.Encoded;

/** The decode failure message, or undefined if `input` is valid. */
const failure = (schema: Schema.Codec<unknown, unknown>, input: unknown): string | undefined => {
  const result = Schema.decodeUnknownResult(schema)(input);
  return Result.isFailure(result) ? result.failure.message : undefined;
};
const entryFailure = (input: Encoded) => failure(CatalogEntry, input);

const lodzWith = (patch: Partial<Encoded>): Encoded => ({ ...plLodz, ...patch });
const [lodzStatic] = plLodz.feeds.static;
const [lodzTripUpdates] = plLodz.feeds.realtime;

describe("catalog", () => {
  it.effect("all entries decode", () =>
    Effect.gen(function* () {
      const catalog = yield* loadCatalog;
      expect(catalog.map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
    }),
  );

  it.effect("adapter defaults to generic-gtfs", () =>
    Effect.gen(function* () {
      const [lodz] = yield* loadCatalog;
      expect(lodz?.adapter).toBe("generic-gtfs");
    }),
  );

  it("rejects duplicate city ids", () => {
    expect(failure(Catalog, [plLodz, plLodz])).toContain("duplicate city id pl-lodz");
  });
});

describe("CatalogEntry", () => {
  it("requires an English name", () => {
    expect(entryFailure(lodzWith({ name: { pl: "Łódź" } }))).toContain("`en`");
  });

  it("requires the center inside the bbox", () => {
    expect(entryFailure(lodzWith({ center: { lat: 52.23, lon: 21.01 } }))).toContain("inside bbox");
  });

  it("rejects an inverted bbox", () => {
    expect(
      entryFailure(lodzWith({ bbox: { south: 51.93, west: 19.18, north: 51.63, east: 19.79 } })),
    ).toContain("south < north");
  });

  it("rejects invalid time zones and URLs", () => {
    expect(entryFailure(lodzWith({ timezone: "Europe/Lodz" }))).toBeDefined();
    expect(entryFailure(lodzWith({ tiles: { url: "ftp://example.com/lodz.pmtiles" } }))).toContain(
      "http(s) URL",
    );
  });

  it("requires a static feed unless planned", () => {
    const noStatic = { static: [], realtime: [] };
    expect(entryFailure(lodzWith({ feeds: noStatic }))).toContain("at least one static feed");
    expect(entryFailure(lodzWith({ status: "planned", feeds: noStatic }))).toBeUndefined();
  });

  it("requires realtime feeds to reference a known static feed", () => {
    if (lodzStatic === undefined || lodzTripUpdates === undefined) throw new Error("fixture");
    const feeds = { static: [lodzStatic], realtime: [{ ...lodzTripUpdates, staticFeed: "nope" }] };
    expect(entryFailure(lodzWith({ feeds }))).toContain("unknown static feed nope");
  });

  it("rejects duplicate feed ids and agency slugs", () => {
    if (lodzStatic === undefined) throw new Error("fixture");
    const feeds = { static: [lodzStatic, lodzStatic], realtime: [] };
    const message = entryFailure(lodzWith({ feeds }));
    expect(message).toContain("duplicate feed id zdit");
    expect(message).toContain("agency zdit-lodz mapped twice");
  });
});

describe("status filters", () => {
  const decode = Schema.decodeUnknownSync(Catalog);
  const catalog = decode([
    plLodz,
    { ...plLodz, id: "pl-test", status: "experimental" },
    { ...plLodz, id: "pl-later", status: "planned", feeds: { static: [], realtime: [] } },
  ]);
  const ids = (list: ReadonlyArray<CatalogEntry>) => list.map((entry) => entry.id);

  it("selectable hides planned and, by default, experimental", () => {
    expect(ids(selectable(catalog, { includeExperimental: false }))).toEqual(["pl-lodz"]);
    expect(ids(selectable(catalog, { includeExperimental: true }))).toEqual(["pl-lodz", "pl-test"]);
  });

  it("ingested includes everything but planned", () => {
    expect(ids(ingested(catalog))).toEqual(["pl-lodz", "pl-test"]);
  });
});
