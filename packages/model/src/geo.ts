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

const earthRadiusMeters = 6_371_008.8;
const toRadians = Math.PI / 180;

/** Great-circle distance in meters (haversine). */
export const distanceMeters = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const dLat = (bLat - aLat) * toRadians;
  const dLon = (bLon - aLon) * toRadians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRadians) * Math.cos(bLat * toRadians) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
};
