import { CityManifest, Vehicle } from "@odjazd/api";
import { Corridor, InterchangeArea, LineRef, Mode, ServiceDate, TimeZone } from "@odjazd/model";
import { Schema } from "effect";

/*
 * What crosses the worker boundary. The timetable itself never does: the
 * worker answers with small DTOs, and requests name the timetable by hash so
 * an answer can never come from a different version than the caller loaded.
 */

const Clock = Schema.String.check(Schema.isPattern(/^\d{2}:\d{2}$/));
const Epoch = Schema.Finite;
const Hash = Schema.String;

export const LoadResult = Schema.Struct({
  manifest: CityManifest,
  /** `cache` when the network was unreachable and a stored copy was used. */
  source: Schema.Literals(["network", "cache"]),
  timeZone: TimeZone,
  stats: Schema.Struct({ lines: Schema.Int, stops: Schema.Int, trips: Schema.Int }),
  /** Service dates the timetable covers, inclusive. */
  firstDate: ServiceDate,
  lastDate: ServiceDate,
});
export type LoadResult = typeof LoadResult.Type;

export const LineLabel = Schema.Struct({
  id: Schema.String,
  /** Short name as riders know it, e.g. `12`. */
  label: Schema.String,
  mode: Mode,
});
export type LineLabel = typeof LineLabel.Type;

export const LegDto = Schema.Struct({
  ...LineLabel.fields,
  headsign: Schema.String,
  boardStop: Schema.String,
  alightStop: Schema.String,
  departAt: Epoch,
  arriveAt: Epoch,
  walkSec: Schema.Finite,
  waitSec: Schema.Finite,
  stayedAboard: Schema.Boolean,
});
export type LegDto = typeof LegDto.Type;

export const ItineraryDto = Schema.Struct({
  departAt: Epoch,
  arriveAt: Epoch,
  legs: Schema.Array(LegDto),
});
export type ItineraryDto = typeof ItineraryDto.Type;

export const CorridorDto = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  legs: Schema.Array(
    Schema.Struct({
      from: Schema.String,
      to: Schema.String,
      fromName: Schema.String,
      toName: Schema.String,
      lines: Schema.Array(Schema.Struct({ ...LineLabel.fields, instances: Schema.Int })),
    }),
  ),
});
export type CorridorDto = typeof CorridorDto.Type;

const Minutes = Schema.UndefinedOr(Schema.Finite);

export const SummaryDto = Schema.Struct({
  feasible: Schema.Int,
  meanMinutes: Minutes,
  medianMinutes: Minutes,
  worstMinutes: Minutes,
  earliest: Schema.Int,
  meanLossMinutes: Minutes,
});

export const ComparisonDto = Schema.Struct({
  date: ServiceDate,
  timeZone: TimeZone,
  /** False when the date lies outside the loaded timetable. */
  inRange: Schema.Boolean,
  corridors: Schema.Array(CorridorDto),
  /** Corridors left out because they reference unknown areas. */
  rejected: Schema.Array(Schema.Struct({ slug: Schema.String, reason: Schema.String })),
  rows: Schema.Array(
    Schema.Struct({
      departAt: Epoch,
      /** One per corridor in `corridors`; null where it has no service. */
      results: Schema.Array(Schema.NullOr(ItineraryDto)),
    }),
  ),
  summaries: Schema.Array(SummaryDto),
});
export type ComparisonDto = typeof ComparisonDto.Type;

export const CompareQuery = Schema.Struct({
  hash: Hash,
  areas: Schema.Array(InterchangeArea),
  corridors: Schema.Array(Corridor),
  date: ServiceDate,
  /** Wall-clock `HH:MM` in the city's time zone. */
  from: Clock,
  to: Clock,
  stepMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
  transferBufferSec: Schema.Finite,
  /** The user's walking speed; 4.5 km/h when absent. */
  walkingSpeedKmh: Schema.optionalKey(Schema.Finite),
  /** How much later non-preferred lines count as leaving, seconds. */
  preferencePenaltySec: Schema.optionalKey(Schema.Finite),
});
export type CompareQuery = typeof CompareQuery.Type;

export const BoardDto = Schema.Struct({
  stops: Schema.Array(Schema.Struct({ name: Schema.String, distanceMeters: Schema.Finite })),
  departures: Schema.Array(
    Schema.Struct({
      ...LineLabel.fields,
      headsign: Schema.String,
      stop: Schema.String,
      departAt: Epoch,
    }),
  ),
});
export type BoardDto = typeof BoardDto.Type;

export const BoardQuery = Schema.Struct({
  hash: Hash,
  area: InterchangeArea,
  at: Epoch,
  horizonMinutes: Schema.Int,
  limit: Schema.Int,
});
export type BoardQuery = typeof BoardQuery.Type;

/** A named cluster of platforms (one search hit, one map marker). */
export const StopGroupDto = Schema.Struct({
  group: Schema.Int,
  name: Schema.String,
  lat: Schema.Finite,
  lon: Schema.Finite,
  lines: Schema.Array(LineLabel),
});
export type StopGroupDto = typeof StopGroupDto.Type;

export const SearchQuery = Schema.Struct({
  hash: Hash,
  text: Schema.String,
  limit: Schema.Int,
  near: Schema.optionalKey(Schema.Struct({ lat: Schema.Finite, lon: Schema.Finite })),
});
export type SearchQuery = typeof SearchQuery.Type;

export const SearchHitDto = Schema.Union([
  Schema.TaggedStruct("Stop", { stop: StopGroupDto }),
  Schema.TaggedStruct("Line", { line: LineLabel, headsigns: Schema.Array(Schema.String) }),
]);
export type SearchHitDto = typeof SearchHitDto.Type;

/** Compact list of every stop group, for the map layer. */
export const StopsDto = Schema.Struct({
  names: Schema.Array(Schema.String),
  lat: Schema.Array(Schema.Finite),
  lon: Schema.Array(Schema.Finite),
  /** Bit 1: served by tram; bit 2: served by anything else. */
  modes: Schema.Array(Schema.Int),
});
export type StopsDto = typeof StopsDto.Type;

export const NearbyQuery = Schema.Struct({
  hash: Hash,
  lat: Schema.Finite,
  lon: Schema.Finite,
  radiusMeters: Schema.Finite,
  limit: Schema.Int,
});
export type NearbyQuery = typeof NearbyQuery.Type;

export const NearbyDto = Schema.Array(
  Schema.Struct({ stop: StopGroupDto, distanceMeters: Schema.Finite }),
);
export type NearbyDto = typeof NearbyDto.Type;

export const DepartureDto = Schema.Struct({
  ...LineLabel.fields,
  headsign: Schema.String,
  /** Platform name, and its index for telling platforms of one group apart. */
  stop: Schema.String,
  platform: Schema.Int,
  /** Expected departure (live where reported, else scheduled). */
  departAt: Epoch,
  scheduledAt: Epoch,
  /** Live delay in seconds, when the trip reports one. */
  delay: Schema.optionalKey(Schema.Finite),
  trip: Schema.String,
});
export type DepartureDto = typeof DepartureDto.Type;

export const StopBoardQuery = Schema.Struct({
  hash: Hash,
  group: Schema.Int,
  at: Epoch,
  horizonMinutes: Schema.Int,
  limit: Schema.Int,
});
export type StopBoardQuery = typeof StopBoardQuery.Type;

export const StopBoardDto = Schema.Struct({
  stop: StopGroupDto,
  platforms: Schema.Array(
    Schema.Struct({ platform: Schema.Int, lat: Schema.Finite, lon: Schema.Finite }),
  ),
  departures: Schema.Array(DepartureDto),
});
export type StopBoardDto = typeof StopBoardDto.Type;

export const LineRouteQuery = Schema.Struct({ hash: Hash, line: Schema.String });
export type LineRouteQuery = typeof LineRouteQuery.Type;

const RouteStop = Schema.Struct({
  group: Schema.Int,
  name: Schema.String,
  lat: Schema.Finite,
  lon: Schema.Finite,
});

/** The most common stop sequence per direction. */
export const LineRouteDto = Schema.Struct({
  line: LineLabel,
  directions: Schema.Array(
    Schema.Struct({ headsign: Schema.String, trips: Schema.Int, stops: Schema.Array(RouteStop) }),
  ),
});
export type LineRouteDto = typeof LineRouteDto.Type;

export const TripQuery = Schema.Struct({ hash: Hash, trip: Schema.String, at: Epoch });
export type TripQuery = typeof TripQuery.Type;

export const TripDto = Schema.Struct({
  line: LineLabel,
  headsign: Schema.String,
  stops: Schema.Array(
    Schema.Struct({
      ...RouteStop.fields,
      sequence: Schema.Int,
      scheduledAt: Epoch,
      expectedAt: Epoch,
    }),
  ),
  /** Live delay applied from `fromSequence` onward, if reported. */
  delay: Schema.optionalKey(Schema.Finite),
  fromSequence: Schema.optionalKey(Schema.Int),
});
export type TripDto = typeof TripDto.Type;

/** A point to plan from or to; a stop group pins it to that group's platforms. */
export const PlanEndpoint = Schema.Struct({
  lat: Schema.Finite,
  lon: Schema.Finite,
  group: Schema.optionalKey(Schema.Int),
});
export type PlanEndpoint = typeof PlanEndpoint.Type;

export const PlanQuery = Schema.Struct({
  hash: Hash,
  from: PlanEndpoint,
  to: PlanEndpoint,
  /** Leave no earlier than this. */
  at: Epoch,
  count: Schema.Int,
  transferBufferSec: Schema.Finite,
  walkingSpeedKmh: Schema.Finite,
  preferLines: Schema.Array(LineRef),
  avoidLines: Schema.Array(LineRef),
  preferencePenaltySec: Schema.Finite,
});
export type PlanQuery = typeof PlanQuery.Type;

export const PlanLegDto = Schema.Union([
  Schema.TaggedStruct("Walk", {
    /** Stop names at either end; absent for the origin or destination point. */
    from: Schema.optionalKey(Schema.String),
    to: Schema.optionalKey(Schema.String),
    departAt: Epoch,
    arriveAt: Epoch,
    meters: Schema.Finite,
    path: Schema.Array(Schema.Struct({ lat: Schema.Finite, lon: Schema.Finite })),
  }),
  Schema.TaggedStruct("Ride", {
    line: LineLabel,
    headsign: Schema.String,
    /** Feed trip id, for following the vehicle. */
    trip: Schema.String,
    from: Schema.String,
    to: Schema.String,
    fromGroup: Schema.Int,
    departAt: Epoch,
    arriveAt: Epoch,
    scheduledDepartAt: Epoch,
    scheduledArriveAt: Epoch,
    /** Live delay at boarding, when the trip reports one. */
    delay: Schema.optionalKey(Schema.Finite),
    stops: Schema.Int,
    preferred: Schema.Boolean,
    path: Schema.Array(Schema.Struct({ lat: Schema.Finite, lon: Schema.Finite })),
  }),
]);
export type PlanLegDto = typeof PlanLegDto.Type;

export const JourneyDto = Schema.Struct({
  departAt: Epoch,
  arriveAt: Epoch,
  rides: Schema.Int,
  walkMeters: Schema.Finite,
  /** Any ride carries a live delay. */
  live: Schema.Boolean,
  legs: Schema.Array(PlanLegDto),
});
export type JourneyDto = typeof JourneyDto.Type;

export const PlanDto = Schema.Struct({
  journeys: Schema.Array(JourneyDto),
  /** Index of the suggested journey, given the line preferences. */
  recommended: Schema.optionalKey(Schema.Int),
});
export type PlanDto = typeof PlanDto.Type;

export const LiveStatus = Schema.Literals(["connecting", "live", "offline"]);
export type LiveStatus = typeof LiveStatus.Type;

/** Every vehicle the worker knows about, after each realtime update. */
export const LiveDto = Schema.Struct({
  status: LiveStatus,
  /** Server fetch time of the newest data, epoch seconds (0 before any). */
  fetchedAt: Epoch,
  vehicles: Schema.Array(Vehicle),
});
export type LiveDto = typeof LiveDto.Type;

/** Neither the network nor the device has a timetable for the city. */
export class TimetableUnavailable extends Schema.TaggedError<TimetableUnavailable>()(
  "TimetableUnavailable",
  { message: Schema.String },
) {}

/** A query named a timetable hash the worker hasn't loaded. */
export class TimetableNotLoaded extends Schema.TaggedError<TimetableNotLoaded>()(
  "TimetableNotLoaded",
  { hash: Schema.String },
) {}
