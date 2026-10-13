import { CityId, LineId, Mode } from "@odjazd/model";
import { Schema } from "effect";
import { ContentHash } from "./payloads.ts";

export const VehicleStatus = Schema.Literals(["incoming", "stopped", "in_transit"]);
export type VehicleStatus = typeof VehicleStatus.Type;

/** One vehicle as last reported, resolved against the city's current timetable. */
export const Vehicle = Schema.Struct({
  /** Feed vehicle id; stable across polls. */
  id: Schema.String,
  /** Fleet number painted on the vehicle, if the feed gives one. */
  label: Schema.optionalKey(Schema.String),
  /** Timetable line, when the route resolved. */
  line: Schema.optionalKey(LineId),
  /** Public line number ("10", "58A"); the feed's route id when unresolved. */
  lineLabel: Schema.String,
  mode: Mode,
  /** Feed trip id. */
  trip: Schema.optionalKey(Schema.String),
  headsign: Schema.optionalKey(Schema.String),
  lat: Schema.Finite,
  lon: Schema.Finite,
  /** Degrees clockwise from north; from the feed or derived from movement. */
  bearing: Schema.optionalKey(Schema.Finite),
  /** Meters per second. */
  speed: Schema.optionalKey(Schema.Finite),
  status: Schema.optionalKey(VehicleStatus),
  /** Feed stop id of the current or next stop, and its name. */
  stop: Schema.optionalKey(Schema.String),
  stopName: Schema.optionalKey(Schema.String),
  stopSequence: Schema.optionalKey(Schema.Int),
  /** Latest reported delay in seconds; positive is late. */
  delay: Schema.optionalKey(Schema.Finite),
  /** Epoch seconds of the position fix. */
  at: Schema.Finite,
});
export type Vehicle = typeof Vehicle.Type;

/** `GET /rt/:city/snapshot`: every vehicle currently reporting. */
export const RealtimeSnapshot = Schema.Struct({
  city: CityId,
  /** Timetable the ids were resolved against. */
  timetable: Schema.optionalKey(ContentHash),
  /** Producer timestamp of the newest feed, epoch seconds. */
  feedAt: Schema.Finite,
  /** When the server last fetched successfully, epoch seconds. */
  fetchedAt: Schema.Finite,
  vehicles: Schema.Array(Vehicle),
});
export type RealtimeSnapshot = typeof RealtimeSnapshot.Type;

/**
 * `GET /rt/:city/stream` (SSE): a `Snapshot` first, then one `Delta` per poll
 * that changed anything. Apply deltas in order; reconnect for a fresh snapshot.
 */
export const RealtimeEvent = Schema.Union([
  Schema.TaggedStruct("Snapshot", { snapshot: RealtimeSnapshot }),
  Schema.TaggedStruct("Delta", {
    feedAt: Schema.Finite,
    fetchedAt: Schema.Finite,
    upserts: Schema.Array(Vehicle),
    removed: Schema.Array(Schema.String),
  }),
]);
export type RealtimeEvent = typeof RealtimeEvent.Type;
