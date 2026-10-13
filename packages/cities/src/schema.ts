import { AgencySlug, BoundingBox, CityId, LatLon, TimeZone, bboxContains } from "@odjazd/model";
import { Effect, Schema } from "effect";

const isHttpUrl = (text: string): boolean => {
  if (!URL.canParse(text)) return false;
  const { protocol } = new URL(text);
  return protocol === "https:" || protocol === "http:";
};

export const HttpUrl = Schema.String.check(
  Schema.makeFilter(isHttpUrl, { expected: "an http(s) URL" }),
);

const Slug = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

/** City-specific ingestion code. Add an id here only for real feed quirks. */
export const AdapterId = Schema.Literals(["generic-gtfs"]);
export type AdapterId = typeof AdapterId.Type;

/**
 * `enabled` cities are ingested and selectable; `experimental` are ingested and
 * selectable on opt-in; `planned` are listed only (e.g. seeded from Transitland).
 */
export const CityStatus = Schema.Literals(["enabled", "experimental", "planned"]);
export type CityStatus = typeof CityStatus.Type;

/** Display strings keyed by BCP 47 language tag; must include `en`. */
export const LocalizedText = Schema.Record(Schema.String, Schema.String).check(
  Schema.makeFilter((text) => (text["en"] === undefined ? "an `en` entry" : undefined)),
);

/** Open-data licences mostly require this to be shown wherever the data is used. */
export const License = Schema.Struct({
  /** SPDX identifier, e.g. `CC-BY-4.0`. */
  spdx: Schema.String,
  url: HttpUrl,
  /** Text the app displays, verbatim. */
  attribution: Schema.String.check(Schema.isMinLength(1)),
  /** Page where the publisher states the licence. */
  sourceUrl: HttpUrl,
});
export type License = typeof License.Type;

/** Maps a feed's `agency_id` onto our own agency identity. */
export const AgencyMapping = Schema.Struct({
  slug: AgencySlug,
  feedAgencyId: Schema.String,
  name: Schema.String,
});

export const StaticFeed = Schema.Struct({
  /** Our stable id for this source within the city. */
  id: Slug,
  url: HttpUrl,
  agencies: Schema.NonEmptyArray(AgencyMapping),
  /**
   * How often to check for a new version (cheap HEAD; download and content-hash
   * only on change). Publishers rarely follow a fixed schedule.
   */
  checkIntervalSeconds: PositiveInt,
  license: License,
});
export type StaticFeed = typeof StaticFeed.Type;

export const RealtimeFeedType = Schema.Literals(["trip_updates", "vehicle_positions", "alerts"]);
export type RealtimeFeedType = typeof RealtimeFeedType.Type;

export const RealtimeFeed = Schema.Struct({
  id: Slug,
  type: RealtimeFeedType,
  url: HttpUrl,
  /** Static feed whose trip and stop ids this feed references. */
  staticFeed: Slug,
  pollIntervalSeconds: PositiveInt,
  license: License,
});
export type RealtimeFeed = typeof RealtimeFeed.Type;

const duplicates = (ids: ReadonlyArray<string>): ReadonlyArray<string> =>
  ids.filter((id, i) => ids.indexOf(id) !== i);

export const CatalogEntry = Schema.Struct({
  id: CityId,
  name: LocalizedText,
  /** ISO 3166-1 alpha-2. */
  country: Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)),
  timezone: TimeZone,
  bbox: BoundingBox,
  center: LatLon,
  status: CityStatus,
  adapter: AdapterId.pipe(Schema.withDecodingDefaultKey(Effect.succeed("generic-gtfs" as const))),
  feeds: Schema.Struct({
    static: Schema.Array(StaticFeed),
    realtime: Schema.Array(RealtimeFeed),
  }),
  /** PMTiles extract; absent until the city has a map. */
  tiles: Schema.optionalKey(Schema.Struct({ url: HttpUrl })),
  /** References only: never fetch from these unless also listed in `feeds`. */
  external: Schema.optionalKey(
    Schema.Struct({
      transitlandOnestopId: Schema.optionalKey(Schema.String),
      mobilityDatabaseId: Schema.optionalKey(Schema.String),
    }),
  ),
}).check(
  Schema.makeFilter((entry) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (!bboxContains(entry.bbox, entry.center)) {
      issues.push({ path: ["center"], issue: "must lie inside bbox" });
    }
    if (entry.status !== "planned" && entry.feeds.static.length === 0) {
      issues.push({
        path: ["feeds", "static"],
        issue: "ingested cities need at least one static feed",
      });
    }
    const staticIds = entry.feeds.static.map((feed) => feed.id);
    const allIds = [...staticIds, ...entry.feeds.realtime.map((feed) => feed.id)];
    for (const id of new Set(duplicates(allIds))) {
      issues.push({ path: ["feeds"], issue: `duplicate feed id ${id}` });
    }
    entry.feeds.realtime.forEach((feed, i) => {
      if (!staticIds.includes(feed.staticFeed)) {
        issues.push({
          path: ["feeds", "realtime", i, "staticFeed"],
          issue: `unknown static feed ${feed.staticFeed}`,
        });
      }
    });
    const slugs = entry.feeds.static.flatMap((feed) => feed.agencies.map((agency) => agency.slug));
    for (const slug of new Set(duplicates(slugs))) {
      issues.push({ path: ["feeds", "static"], issue: `agency ${slug} mapped twice` });
    }
    return issues;
  }),
);
export type CatalogEntry = typeof CatalogEntry.Type;

export const Catalog = Schema.Array(CatalogEntry).check(
  Schema.makeFilter((entries) =>
    duplicates(entries.map((entry) => entry.id)).map((id) => `duplicate city id ${id}`),
  ),
);
export type Catalog = typeof Catalog.Type;

/** Cities the user may pick. */
export const selectable = (
  catalog: Catalog,
  options: { readonly includeExperimental: boolean },
): ReadonlyArray<CatalogEntry> =>
  catalog.filter(
    (entry) =>
      entry.status === "enabled" ||
      (options.includeExperimental && entry.status === "experimental"),
  );

/** Cities whose pipelines run on the server. */
export const ingested = (catalog: Catalog): ReadonlyArray<CatalogEntry> =>
  catalog.filter((entry) => entry.status !== "planned");
