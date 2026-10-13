import { CityManifest } from "@odjazd/api";
import { Corridor, InterchangeArea, Mode, ServiceDate, TimeZone } from "@odjazd/model";
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
