import { CityId, Corridor, InterchangeArea, LatLon, Ulid } from "@odjazd/model";
import { Schema } from "effect";

/*
 * User intent: small, precious, survives feed updates. Every record has a
 * ULID, `updatedAt` and an optional tombstone so merges (import now, sync
 * later) are last-write-wins per record. Nothing here references feed ids.
 */

const Meta = {
  id: Ulid,
  /** Epoch milliseconds of the last change. */
  updatedAt: Schema.Finite,
  /** Tombstone: kept so a merge doesn't resurrect what the user deleted. */
  deleted: Schema.optionalKey(Schema.Literal(true)),
  /** `seed` for starter data the app offered; `user` for what the user made. */
  origin: Schema.Literals(["user", "seed"]),
};

export const PlaceKind = Schema.Literals(["home", "work", "school", "star"]);
export type PlaceKind = typeof PlaceKind.Type;

/** A point the user cares about. Stays on the device unless exported. */
export const Place = Schema.TaggedStruct("Place", {
  ...Meta,
  cityId: CityId,
  name: Schema.String.check(Schema.isMinLength(1)),
  kind: PlaceKind,
  point: LatLon,
});
export type Place = typeof Place.Type;

export const AreaRecord = Schema.TaggedStruct("Area", {
  ...Meta,
  area: InterchangeArea,
});
export type AreaRecord = typeof AreaRecord.Type;

export const CorridorRecord = Schema.TaggedStruct("Corridor", {
  ...Meta,
  corridor: Corridor,
});
export type CorridorRecord = typeof CorridorRecord.Type;

export const UserRecord = Schema.Union([Place, AreaRecord, CorridorRecord]);
export type UserRecord = typeof UserRecord.Type;

export const Theme = Schema.Literals(["system", "light", "dark"]);
export type Theme = typeof Theme.Type;

/** App-wide preferences; each one changes what the app computes or shows. */
export const Preferences = Schema.Struct({
  /** Walking speed for every walk the planner times. */
  walkingSpeedKmh: Schema.Finite.check(Schema.isBetween({ minimum: 2, maximum: 8 })),
  /** Minimum time to change vehicles, seconds. */
  transferBufferSec: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 900 })),
  /**
   * On a route leg that prefers lines, other lines count as leaving this much
   * later. Line preferences themselves live on route legs, never app-wide.
   */
  preferencePenaltyMin: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
  /** A trip following one of the user's routes is suggested when at most this much slower. */
  routeToleranceMin: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
  theme: Theme,
  /** City opened at start; the first available when absent. */
  city: Schema.optionalKey(CityId),
  updatedAt: Schema.Finite,
});
export type Preferences = typeof Preferences.Type;

export const defaultPreferences: Preferences = {
  walkingSpeedKmh: 4.5,
  transferBufferSec: 60,
  preferencePenaltyMin: 4,
  routeToleranceMin: 5,
  theme: "system",
  updatedAt: 0,
};

export const userDataVersion = 2;

/** The whole store, as kept on the device and as exported. */
export const UserData = Schema.Struct({
  schemaVersion: Schema.Literal(userDataVersion),
  records: Schema.Array(UserRecord),
  preferences: Preferences,
  /** Cities whose starter data was offered once (so deleting it sticks). */
  seeded: Schema.Array(CityId),
});
export type UserData = typeof UserData.Type;

export const emptyUserData: UserData = {
  schemaVersion: userDataVersion,
  records: [],
  preferences: defaultPreferences,
  seeded: [],
};

/** Raised when an import or a stored copy can't be read even after migration. */
export class UserDataInvalid extends Schema.TaggedError<UserDataInvalid>()("UserDataInvalid", {
  message: Schema.String,
}) {}
