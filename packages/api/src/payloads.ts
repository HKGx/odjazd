import { CityStatus, License, LocalizedText, RealtimeFeedType } from "@odjazd/cities";
import { BoundingBox, CityId, LatLon, ServiceDate, TimeZone } from "@odjazd/model";
import { Schema } from "effect";

/** Hex SHA-256 of a published file; names it forever. */
export const ContentHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(
  Schema.brand("ContentHash"),
);
export type ContentHash = typeof ContentHash.Type;

/** One selectable city in `GET /cities`. */
export const CitySummary = Schema.Struct({
  id: CityId,
  name: LocalizedText,
  country: Schema.String,
  status: CityStatus,
  timezone: TimeZone,
  bbox: BoundingBox,
  center: LatLon,
  /** Bytes of the current timetable download, if one is published. */
  downloadBytes: Schema.optionalKey(Schema.Int),
  realtime: Schema.Array(RealtimeFeedType),
  attribution: Schema.Array(License),
});
export type CitySummary = typeof CitySummary.Type;

export const CityList = Schema.Struct({ cities: Schema.Array(CitySummary) });
export type CityList = typeof CityList.Type;

/** `GET /cities/:city/manifest`: what a client downloads for a city right now. */
export const CityManifest = Schema.Struct({
  cityId: CityId,
  timetable: Schema.Struct({
    hash: ContentHash,
    /** Relative to the API root, e.g. `/feeds/<hash>.bin`. Immutable. */
    path: Schema.String,
    bytes: Schema.Int,
    /** Of the gzip-compressed response, if served compressed. */
    compressedBytes: Schema.optionalKey(Schema.Int),
    formatVersion: Schema.Int,
    feedVersion: Schema.optionalKey(Schema.String),
    firstDate: ServiceDate,
    dayCount: Schema.Int,
  }),
  /** Epoch seconds when the server compiled this timetable. */
  compiledAt: Schema.Int,
  /** Hash of the raw GTFS archive it was compiled from. */
  sourceHash: ContentHash,
  attribution: Schema.Array(License),
});
export type CityManifest = typeof CityManifest.Type;
