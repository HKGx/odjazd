import { Schema } from "effect";
import { Temporal } from "temporal-polyfill";

/**
 * Absolute time in whole seconds since the Unix epoch (UTC). The only time
 * representation below the UI; local time exists only for display.
 */
export const EpochSeconds = Schema.Int.pipe(Schema.brand("EpochSeconds"));
export type EpochSeconds = typeof EpochSeconds.Type;

const isValidTimeZone = (id: string): boolean => {
  try {
    Temporal.Now.zonedDateTimeISO(id);
    return true;
  } catch {
    return false;
  }
};

/** IANA time zone id, e.g. `Europe/Warsaw`. */
export const TimeZone = Schema.String.check(
  Schema.makeFilter(isValidTimeZone, { expected: "an IANA time zone id" }),
).pipe(Schema.brand("TimeZone"));
export type TimeZone = typeof TimeZone.Type;

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

const isValidIsoDate = (text: string): boolean => {
  const match = isoDatePattern.exec(text);
  if (match === null) return false;
  try {
    Temporal.PlainDate.from(
      { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
      { overflow: "reject" },
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * A calendar day on which a timetable operates, in ISO form (`2026-10-13`).
 * Not an instant: it only becomes one together with a time zone.
 */
export const ServiceDate = Schema.String.check(
  Schema.makeFilter(isValidIsoDate, { expected: "a calendar date in YYYY-MM-DD form" }),
).pipe(Schema.brand("ServiceDate"));
export type ServiceDate = typeof ServiceDate.Type;

/** Parses a GTFS date (`20261013`). Returns `undefined` if malformed or not a real date. */
export const parseGtfsDate = (text: string): ServiceDate | undefined => {
  if (text.length !== 8) return undefined;
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return isValidIsoDate(iso) ? (iso as ServiceDate) : undefined;
};

const CHAR_0 = 48;
const CHAR_COLON = 58;

const digit = (text: string, index: number): number => {
  const d = text.charCodeAt(index) - CHAR_0;
  return d >= 0 && d <= 9 ? d : -1;
};

/**
 * Parses a GTFS time (`H:MM:SS` or `HH:MM:SS`, hours may exceed 23) into
 * seconds after the service day's reference instant (see {@link serviceDayAnchor}).
 * Returns `undefined` if malformed. Allocation-free: runs once per stop_times row.
 */
export const parseGtfsTime = (text: string): number | undefined => {
  const length = text.length;
  if (length < 7 || length > 9) return undefined;
  if (text.charCodeAt(length - 3) !== CHAR_COLON || text.charCodeAt(length - 6) !== CHAR_COLON) {
    return undefined;
  }
  let hours = 0;
  for (let i = 0; i < length - 6; i++) {
    const d = digit(text, i);
    if (d < 0) return undefined;
    hours = hours * 10 + d;
  }
  const m1 = digit(text, length - 5);
  const m2 = digit(text, length - 4);
  const s1 = digit(text, length - 2);
  const s2 = digit(text, length - 1);
  if (m1 < 0 || m2 < 0 || s1 < 0 || s2 < 0 || m1 > 5 || s1 > 5) return undefined;
  return hours * 3600 + (m1 * 10 + m2) * 60 + s1 * 10 + s2;
};

/**
 * The instant GTFS times on `date` are measured from: local noon minus 12 hours,
 * as the GTFS spec defines it. That equals local midnight except on DST change
 * days, where it is one hour off, which is exactly what keeps daytime departures
 * on the right wall-clock time and makes times past 24:00 continue seamlessly.
 *
 * Compute once per (service date, zone) and add the parsed time offsets.
 */
export const serviceDayAnchor = (date: ServiceDate, timeZone: TimeZone): EpochSeconds => {
  const noon = Temporal.PlainDate.from(date).toZonedDateTime({
    timeZone,
    plainTime: { hour: 12 },
  });
  return (noon.epochMilliseconds / 1000 - 12 * 3600) as EpochSeconds;
};

/** Absolute instant of a GTFS time offset on a service day. */
export const gtfsTimeToEpoch = (anchor: EpochSeconds, offsetSeconds: number): EpochSeconds =>
  (anchor + offsetSeconds) as EpochSeconds;

/** For display and tests only: the instant as wall-clock time in `timeZone`. */
export const toZoned = (epoch: EpochSeconds, timeZone: TimeZone): Temporal.ZonedDateTime =>
  Temporal.Instant.fromEpochMilliseconds(epoch * 1000).toZonedDateTimeISO(timeZone);

/**
 * The instant of wall-clock `time` (`HH:MM` or `HH:MM:SS`) on `date` in `timeZone`.
 * For user input; nonexistent DST times resolve forward, repeated ones to the first.
 */
export const localToEpoch = (date: ServiceDate, time: string, timeZone: TimeZone): EpochSeconds =>
  (Temporal.PlainDate.from(date).toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from(time),
  }).epochMilliseconds / 1000) as EpochSeconds;
