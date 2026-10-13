import { Schema } from "effect";
import { LatLon } from "./geo.ts";
import { CityId } from "./ids.ts";

/** Stable name of an interchange area within a city, e.g. `gorniak`. Referenced by leg rules. */
export const AreaSlug = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).pipe(
  Schema.brand("AreaSlug"),
);
export type AreaSlug = typeof AreaSlug.Type;

/**
 * A named place where transfers happen: a point and a radius. Member stops are
 * not stored; they are re-derived from each feed version, so the area survives
 * stops being renumbered, moved or temporarily replaced.
 */
export const InterchangeArea = Schema.Struct({
  slug: AreaSlug,
  cityId: CityId,
  name: Schema.String.check(Schema.isMinLength(1)),
  center: LatLon,
  radiusMeters: Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 1000 })),
});
export type InterchangeArea = typeof InterchangeArea.Type;
