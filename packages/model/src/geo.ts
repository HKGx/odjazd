import { Schema } from "effect";

export const Latitude = Schema.Finite.check(Schema.isBetween({ minimum: -90, maximum: 90 }));
export const Longitude = Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 }));

/** WGS 84 point in degrees. */
export const LatLon = Schema.Struct({ lat: Latitude, lon: Longitude });
export type LatLon = typeof LatLon.Type;

/** WGS 84 rectangle in degrees. Does not cross the antimeridian. */
export const BoundingBox = Schema.Struct({
  south: Latitude,
  west: Longitude,
  north: Latitude,
  east: Longitude,
}).check(
  Schema.makeFilter((box) =>
    box.south < box.north && box.west < box.east ? undefined : "south < north and west < east",
  ),
);
export type BoundingBox = typeof BoundingBox.Type;

export const bboxContains = (box: BoundingBox, point: LatLon): boolean =>
  point.lat >= box.south &&
  point.lat <= box.north &&
  point.lon >= box.west &&
  point.lon <= box.east;
