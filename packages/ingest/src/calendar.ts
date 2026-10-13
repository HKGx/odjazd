import { parseGtfsDate, serviceDayAnchor, type ServiceDate, type TimeZone } from "@odjazd/model";
import type { ServiceDays } from "@odjazd/timetable";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { cell, type Table } from "./csv.ts";
import { GtfsValidationError, type Warnings } from "./errors.ts";

/** Longest timetable we accept; real feeds cover weeks to a year. */
const maxDays = 800;

const weekdayColumns = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export interface CompiledServices {
  readonly days: ServiceDays;
  /** Service index by GTFS service_id. */
  readonly index: ReadonlyMap<string, number>;
  readonly count: number;
  readonly activeDays: Uint8Array;
  readonly bytesPerService: number;
}

/** Active dates per service_id, from calendar.txt plus calendar_dates.txt exceptions. */
const collectDates = (
  calendar: Table | undefined,
  calendarDates: Table | undefined,
  warnings: Warnings,
): Map<string, Set<string>> => {
  const dates = new Map<string, Set<string>>();
  const datesOf = (serviceId: string) => {
    let set = dates.get(serviceId);
    if (set === undefined) dates.set(serviceId, (set = new Set()));
    return set;
  };

  if (calendar !== undefined) {
    const serviceId = calendar.column("service_id");
    const start = calendar.column("start_date");
    const end = calendar.column("end_date");
    const weekdays = weekdayColumns.map((name) => calendar.column(name));
    for (const row of calendar.rows) {
      const id = cell(row, serviceId);
      const from = parseGtfsDate(cell(row, start));
      const to = parseGtfsDate(cell(row, end));
      if (from === undefined || to === undefined || from > to) {
        warnings.add(calendar.file, "bad-date-range", "invalid start/end date; row skipped", id);
        continue;
      }
      const set = datesOf(id);
      const runs = weekdays.map((column) => cell(row, column) === "1");
      if (!runs.includes(true)) continue;
      let date = Temporal.PlainDate.from(from);
      const last = Temporal.PlainDate.from(to);
      for (let n = 0; Temporal.PlainDate.compare(date, last) <= 0 && n <= maxDays; n++) {
        if (runs[date.dayOfWeek - 1] === true) set.add(date.toString());
        date = date.add({ days: 1 });
      }
    }
  }

  if (calendarDates !== undefined) {
    const serviceId = calendarDates.column("service_id");
    const dateColumn = calendarDates.column("date");
    const type = calendarDates.column("exception_type");
    for (const row of calendarDates.rows) {
      const id = cell(row, serviceId);
      const date = parseGtfsDate(cell(row, dateColumn));
      const exception = cell(row, type);
      if (date === undefined || (exception !== "1" && exception !== "2")) {
        warnings.add(
          calendarDates.file,
          "bad-exception",
          "invalid date or exception_type; row skipped",
          id,
        );
        continue;
      }
      if (exception === "1") datesOf(id).add(date);
      else datesOf(id).delete(date);
    }
  }
  return dates;
};

export const compileServices = Effect.fn("compileServices")(function* (
  calendar: Table | undefined,
  calendarDates: Table | undefined,
  timeZone: TimeZone,
  warnings: Warnings,
) {
  if (calendar === undefined && calendarDates === undefined) {
    return yield* GtfsValidationError.make({
      message: "feed has neither calendar.txt nor calendar_dates.txt",
    });
  }
  const dates = collectDates(calendar, calendarDates, warnings);

  let min: string | undefined;
  let max: string | undefined;
  for (const set of dates.values()) {
    for (const date of set) {
      if (min === undefined || date < min) min = date;
      if (max === undefined || date > max) max = date;
    }
  }
  if (min === undefined || max === undefined) {
    return yield* GtfsValidationError.make({ message: "no service runs on any day" });
  }

  const first = Temporal.PlainDate.from(min);
  const count = first.until(Temporal.PlainDate.from(max)).days + 1;
  if (count > maxDays) {
    return yield* GtfsValidationError.make({
      message: `service spans ${count} days (${min}..${max}), more than ${maxDays}`,
    });
  }

  const anchors = new Float64Array(count);
  for (let day = 0; day < count; day++) {
    anchors[day] = serviceDayAnchor(first.add({ days: day }).toString() as ServiceDate, timeZone);
  }

  const bytesPerService = (count + 7) >> 3;
  const activeDays = new Uint8Array(dates.size * bytesPerService);
  const index = new Map<string, number>();
  for (const [serviceId, set] of dates) {
    const service = index.size;
    index.set(serviceId, service);
    for (const date of set) {
      const day = first.until(Temporal.PlainDate.from(date)).days;
      const byte = service * bytesPerService + (day >> 3);
      activeDays[byte] = (activeDays[byte] ?? 0) | (1 << (day & 7));
    }
  }

  const services: CompiledServices = {
    days: { first: min as ServiceDate, count, anchors },
    index,
    count: index.size,
    activeDays,
    bytesPerService,
  };
  return services;
});
