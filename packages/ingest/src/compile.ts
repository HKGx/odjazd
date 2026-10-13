import type { CatalogEntry, StaticFeed } from "@odjazd/cities";
import { bboxContains, LineId, parseGtfsTime, TimeZone } from "@odjazd/model";
import { StopTimeFlag, type Agency, type Line, type Timetable } from "@odjazd/timetable";
import { Effect, Schema } from "effect";
import { compileServices } from "./calendar.ts";
import {
  cell,
  readOptionalTable,
  readTable,
  unzipGtfs,
  type GtfsFiles,
  type Table,
} from "./csv.ts";
import { GtfsValidationError, Warnings, type IngestWarning } from "./errors.ts";
import { modeFromRouteType } from "./route-type.ts";

export interface IngestResult {
  readonly timetable: Timetable;
  readonly warnings: ReadonlyArray<IngestWarning>;
}

const isLineId = Schema.is(LineId);
const isTimeZone = Schema.is(TimeZone);

/** Agencies in catalog order, indexed by feed agency_id ("" when the feed omits it). */
const compileAgencies = Effect.fn("compileAgencies")(function* (
  table: Table,
  entry: CatalogEntry,
  feed: StaticFeed,
) {
  const idColumn = table.column("agency_id");
  const zoneColumn = table.column("agency_timezone");
  const agencies: Array<Agency> = feed.agencies.map(({ slug, name }) => ({ slug, name }));
  const index = new Map<string, number>();
  for (const row of table.rows) {
    const feedId = cell(row, idColumn);
    const zone = cell(row, zoneColumn);
    if (!isTimeZone(zone) || zone !== entry.timezone) {
      return yield* GtfsValidationError.make({
        file: table.file,
        message: `agency ${feedId} uses time zone ${zone}, catalog says ${entry.timezone}`,
      });
    }
    const mapping =
      feedId === "" && feed.agencies.length === 1
        ? 0
        : feed.agencies.findIndex((agency) => agency.feedAgencyId === feedId);
    if (mapping < 0) {
      return yield* GtfsValidationError.make({
        file: table.file,
        message: `agency_id ${feedId} has no mapping in catalog feed ${feed.id}`,
      });
    }
    index.set(feedId, mapping);
  }
  if (index.size === 0) {
    return yield* GtfsValidationError.make({ file: table.file, message: "no agencies" });
  }
  return { agencies, index };
});

const compileLines = (
  table: Table,
  agencyIndex: ReadonlyMap<string, number>,
  agencies: ReadonlyArray<Agency>,
  warnings: Warnings,
) => {
  const routeId = table.column("route_id");
  const agencyId = table.column("agency_id");
  const shortName = table.column("route_short_name");
  const routeType = table.column("route_type");
  const soleAgency = agencyIndex.size === 1 ? [...agencyIndex.values()][0] : undefined;

  const lines: Array<Line> = [];
  const lineIndex = new Map<string, number>();
  const routeToLine = new Map<string, number>();
  for (const row of table.rows) {
    const route = cell(row, routeId);
    const feedAgency = cell(row, agencyId);
    const agency = feedAgency === "" ? soleAgency : agencyIndex.get(feedAgency);
    if (agency === undefined) {
      warnings.add(
        table.file,
        "unknown-agency",
        "route references an unknown agency; skipped",
        route,
      );
      continue;
    }
    const mode = modeFromRouteType(Number(cell(row, routeType)));
    if (mode === undefined) {
      warnings.add(table.file, "unsupported-route-type", "route_type not routable; skipped", route);
      continue;
    }
    const id = `${mode}:${cell(row, shortName).trim()}@${agencies[agency]?.slug ?? ""}`;
    if (!isLineId(id)) {
      warnings.add(
        table.file,
        "bad-line-number",
        "route_short_name empty or not usable as a line number; skipped",
        route,
      );
      continue;
    }
    let line = lineIndex.get(id);
    if (line === undefined) {
      line = lines.length;
      lines.push({ id, mode, agency });
      lineIndex.set(id, line);
    }
    routeToLine.set(route, line);
  }
  return { lines, routeToLine };
};

const compileStops = (table: Table, entry: CatalogEntry, warnings: Warnings) => {
  const idColumn = table.column("stop_id");
  const nameColumn = table.column("stop_name");
  const latColumn = table.column("stop_lat");
  const lonColumn = table.column("stop_lon");
  const typeColumn = table.column("location_type");

  const feedIds: Array<string> = [];
  const names: Array<string> = [];
  const lat: Array<number> = [];
  const lon: Array<number> = [];
  const index = new Map<string, number>();
  for (const row of table.rows) {
    const id = cell(row, idColumn);
    const type = cell(row, typeColumn);
    // Only boarding locations; stations, entrances and nodes aren't served by trips.
    if (type !== "" && type !== "0") continue;
    if (index.has(id)) {
      warnings.add(table.file, "duplicate-stop", "duplicate stop_id; later row skipped", id);
      continue;
    }
    const point = { lat: Number(cell(row, latColumn)), lon: Number(cell(row, lonColumn)) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || cell(row, latColumn) === "") {
      warnings.add(table.file, "bad-coordinates", "missing or invalid coordinates; skipped", id);
      continue;
    }
    if (!bboxContains(entry.bbox, point)) {
      warnings.add(table.file, "outside-bbox", "stop lies outside the city bbox (kept)", id);
    }
    index.set(id, feedIds.length);
    feedIds.push(id);
    names.push(cell(row, nameColumn));
    lat.push(point.lat);
    lon.push(point.lon);
  }
  const stops = {
    count: feedIds.length,
    names,
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    feedIds,
  };
  return { stops, index };
};

const compileTrips = (
  table: Table,
  routeToLine: ReadonlyMap<string, number>,
  serviceIndex: ReadonlyMap<string, number>,
  warnings: Warnings,
) => {
  const tripId = table.column("trip_id");
  const routeId = table.column("route_id");
  const serviceId = table.column("service_id");
  const headsign = table.column("trip_headsign");
  const direction = table.column("direction_id");

  const feedIds: Array<string> = [];
  const line: Array<number> = [];
  const service: Array<number> = [];
  const directions: Array<number> = [];
  const headsigns: Array<string> = [];
  const index = new Map<string, number>();
  for (const row of table.rows) {
    const id = cell(row, tripId);
    const lineOf = routeToLine.get(cell(row, routeId));
    const serviceOf = serviceIndex.get(cell(row, serviceId));
    if (index.has(id)) {
      warnings.add(table.file, "duplicate-trip", "duplicate trip_id; later row skipped", id);
      continue;
    }
    if (lineOf === undefined) {
      warnings.add(table.file, "unknown-route", "route missing or skipped; trip skipped", id);
      continue;
    }
    if (serviceOf === undefined) {
      warnings.add(table.file, "unknown-service", "service_id has no calendar; trip skipped", id);
      continue;
    }
    const dir = cell(row, direction);
    index.set(id, feedIds.length);
    feedIds.push(id);
    line.push(lineOf);
    service.push(serviceOf);
    directions.push(dir === "0" ? 0 : dir === "1" ? 1 : -1);
    headsigns.push(cell(row, headsign));
  }
  return { feedIds, line, service, directions, headsigns, index };
};

const pickupFlags = (value: string, none: number): number =>
  value === "1" ? none : value === "2" || value === "3" ? StopTimeFlag.onRequest : 0;

/**
 * Groups stop_times by trip in stop_sequence order, fills in missing times and
 * drops trips that can't be ridden. Hot path: typed arrays, no per-row objects.
 */
const compileStopTimes = (
  table: Table,
  tripCount: number,
  tripIndex: ReadonlyMap<string, number>,
  stopIndex: ReadonlyMap<string, number>,
  tripFeedIds: ReadonlyArray<string>,
  warnings: Warnings,
) => {
  const { file, rows } = table;
  const tripColumn = table.column("trip_id");
  const stopColumn = table.column("stop_id");
  const seqColumn = table.column("stop_sequence");
  const arrColumn = table.column("arrival_time");
  const depColumn = table.column("departure_time");
  const pickupColumn = table.column("pickup_type");
  const dropColumn = table.column("drop_off_type");

  const n = rows.length;
  const trip = new Uint32Array(n);
  const stop = new Uint32Array(n);
  const seq = new Uint32Array(n);
  const arr = new Int32Array(n);
  const dep = new Int32Array(n);
  const flags = new Uint8Array(n);
  const badTrip = new Uint8Array(tripCount);
  let rowCount = 0;

  for (const row of rows) {
    const t = tripIndex.get(cell(row, tripColumn));
    if (t === undefined) {
      warnings.add(
        file,
        "unknown-trip",
        "trip missing or skipped; stop time skipped",
        cell(row, tripColumn),
      );
      continue;
    }
    const s = stopIndex.get(cell(row, stopColumn));
    if (s === undefined) {
      warnings.add(
        file,
        "unknown-stop",
        "stop missing or skipped; its trip is dropped",
        tripFeedIds[t] ?? "",
      );
      badTrip[t] = 1;
      continue;
    }
    const sequence = Number(cell(row, seqColumn));
    const arrText = cell(row, arrColumn);
    const depText = cell(row, depColumn);
    const a = arrText === "" ? -1 : parseGtfsTime(arrText);
    const d = depText === "" ? -1 : parseGtfsTime(depText);
    if (!Number.isInteger(sequence) || sequence < 0 || a === undefined || d === undefined) {
      warnings.add(
        file,
        "bad-stop-time",
        "invalid stop_sequence or time; trip dropped",
        tripFeedIds[t] ?? "",
      );
      badTrip[t] = 1;
      continue;
    }
    trip[rowCount] = t;
    stop[rowCount] = s;
    seq[rowCount] = sequence;
    arr[rowCount] = a;
    dep[rowCount] = d;
    flags[rowCount] =
      pickupFlags(cell(row, pickupColumn), StopTimeFlag.noPickup) |
      pickupFlags(cell(row, dropColumn), StopTimeFlag.noDropOff);
    rowCount++;
  }

  const order = new Uint32Array(rowCount);
  for (let i = 0; i < rowCount; i++) order[i] = i;
  order.sort((x, y) => (trip[x] ?? 0) - (trip[y] ?? 0) || (seq[x] ?? 0) - (seq[y] ?? 0));

  const out = {
    stop: new Uint32Array(rowCount),
    arrival: new Int32Array(rowCount),
    departure: new Int32Array(rowCount),
    flags: new Uint8Array(rowCount),
  };
  const keptTrips: Array<number> = [];
  const firstStopTime: Array<number> = [];
  let written = 0;

  let start = 0;
  while (start < rowCount) {
    const t = trip[order[start] ?? 0] ?? 0;
    let end = start;
    while (end < rowCount && trip[order[end] ?? 0] === t) end++;
    const length = end - start;
    const feedId = tripFeedIds[t] ?? "";

    const drop = (code: string, message: string) => {
      warnings.add(file, code, message, feedId);
      start = end;
    };
    if (badTrip[t] === 1) {
      start = end;
      continue;
    }
    if (length < 2) {
      drop("too-few-stops", "trip has fewer than two stop times; dropped");
      continue;
    }

    // Copy into the output tentatively; `written` only advances if the trip is valid.
    let duplicate = false;
    for (let i = 0; i < length; i++) {
      const r = order[start + i] ?? 0;
      if (i > 0 && seq[r] === seq[order[start + i - 1] ?? 0]) duplicate = true;
      const a = arr[r] ?? -1;
      const d = dep[r] ?? -1;
      out.stop[written + i] = stop[r] ?? 0;
      out.arrival[written + i] = a < 0 ? d : a;
      out.departure[written + i] = d < 0 ? a : d;
      out.flags[written + i] = flags[r] ?? 0;
    }
    if (duplicate) {
      drop("duplicate-stop-sequence", "repeated stop_sequence; trip dropped");
      continue;
    }
    const last = written + length - 1;
    if ((out.departure[written] ?? -1) < 0 || (out.arrival[last] ?? -1) < 0) {
      drop("missing-terminal-times", "first or last stop has no time; trip dropped");
      continue;
    }

    // Interpolate untimed stops evenly between their timed neighbours.
    let interpolated = false;
    for (let i = written + 1; i < last; i++) {
      if ((out.arrival[i] ?? 0) >= 0) continue;
      let next = i + 1;
      while ((out.arrival[next] ?? 0) < 0) next++;
      const from = out.departure[i - 1] ?? 0;
      const to = out.arrival[next] ?? 0;
      for (let j = i; j < next; j++) {
        const time = Math.round(from + ((to - from) * (j - i + 1)) / (next - i + 1));
        out.arrival[j] = time;
        out.departure[j] = time;
      }
      interpolated = true;
      i = next;
    }
    if (interpolated) {
      warnings.add(file, "interpolated-times", "untimed stops interpolated (kept)", feedId);
    }

    let monotonic = true;
    for (let i = written; i <= last && monotonic; i++) {
      if ((out.departure[i] ?? 0) < (out.arrival[i] ?? 0)) monotonic = false;
      if (i < last && (out.arrival[i + 1] ?? 0) < (out.departure[i] ?? 0)) monotonic = false;
    }
    if (!monotonic) {
      drop("non-monotonic-times", "times go backwards; trip dropped");
      continue;
    }

    keptTrips.push(t);
    firstStopTime.push(written);
    written += length;
    start = end;
  }
  firstStopTime.push(written);

  const stopTimes = {
    count: written,
    stop: out.stop.slice(0, written),
    arrival: out.arrival.slice(0, written),
    departure: out.departure.slice(0, written),
    flags: out.flags.slice(0, written),
  };
  return { stopTimes, keptTrips, firstStopTime: Uint32Array.from(firstStopTime) };
};

const weekdayColumns = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Compiles one static feed of a catalog city into a {@link Timetable}. */
export const compileGtfs = Effect.fn("compileGtfs")(function* (
  files: GtfsFiles,
  entry: CatalogEntry,
  feed: StaticFeed,
) {
  const warnings = new Warnings();
  const agencyTable = yield* readTable(files, "agency.txt", ["agency_name", "agency_timezone"]);
  const routesTable = yield* readTable(files, "routes.txt", ["route_id", "route_type"]);
  const stopsTable = yield* readTable(files, "stops.txt", ["stop_id", "stop_lat", "stop_lon"]);
  const tripsTable = yield* readTable(files, "trips.txt", ["route_id", "service_id", "trip_id"]);
  const stopTimesTable = yield* readTable(files, "stop_times.txt", [
    "trip_id",
    "stop_id",
    "stop_sequence",
    "arrival_time",
    "departure_time",
  ]);
  const calendarTable = yield* readOptionalTable(files, "calendar.txt", [
    "service_id",
    ...weekdayColumns,
    "start_date",
    "end_date",
  ]);
  const calendarDatesTable = yield* readOptionalTable(files, "calendar_dates.txt", [
    "service_id",
    "date",
    "exception_type",
  ]);
  const feedInfoTable = yield* readOptionalTable(files, "feed_info.txt", []);
  if (files.has("frequencies.txt")) {
    warnings.add(
      "frequencies.txt",
      "unsupported-file",
      "frequency-based service not supported; only listed stop times are used",
      "",
    );
  }

  const { agencies, index: agencyIndex } = yield* compileAgencies(agencyTable, entry, feed);
  const services = yield* compileServices(
    calendarTable,
    calendarDatesTable,
    entry.timezone,
    warnings,
  );
  const { lines, routeToLine } = compileLines(routesTable, agencyIndex, agencies, warnings);
  const { stops, index: stopIndex } = compileStops(stopsTable, entry, warnings);
  const trips = compileTrips(tripsTable, routeToLine, services.index, warnings);
  const { stopTimes, keptTrips, firstStopTime } = compileStopTimes(
    stopTimesTable,
    trips.feedIds.length,
    trips.index,
    stopIndex,
    trips.feedIds,
    warnings,
  );
  if (stopTimes.count === 0) {
    return yield* GtfsValidationError.make({ message: "no rideable trips" });
  }

  const pick = <A>(values: ReadonlyArray<A>, fallback: A) =>
    keptTrips.map((t) => values[t] ?? fallback);
  const feedVersion = feedInfoTable?.rows[0]?.[feedInfoTable.column("feed_version")];

  const timetable: Timetable = {
    cityId: entry.id,
    timeZone: entry.timezone,
    feedVersion: feedVersion === undefined || feedVersion === "" ? undefined : feedVersion,
    days: services.days,
    agencies,
    lines,
    stops,
    services: {
      count: services.count,
      activeDays: services.activeDays,
      bytesPerService: services.bytesPerService,
    },
    trips: {
      count: keptTrips.length,
      line: Uint32Array.from(pick(trips.line, 0)),
      service: Uint32Array.from(pick(trips.service, 0)),
      firstStopTime,
      direction: Int8Array.from(pick(trips.directions, -1)),
      headsigns: pick(trips.headsigns, ""),
      feedIds: pick(trips.feedIds, ""),
    },
    stopTimes,
  };

  const result: IngestResult = { timetable, warnings: warnings.toArray() };
  for (const warning of result.warnings) {
    yield* Effect.logWarning(
      `${warning.file}: ${warning.message} ×${warning.count} (e.g. ${warning.example})`,
    );
  }
  yield* Effect.logInfo(
    `compiled ${entry.id}/${feed.id}: ${lines.length} lines, ${stops.count} stops, ` +
      `${timetable.trips.count} trips, ${stopTimes.count} stop times, ` +
      `${services.days.count} days from ${services.days.first}`,
  );
  return result;
});

/** Unzips and compiles a GTFS archive. */
export const ingestGtfsZip = (zip: Uint8Array, entry: CatalogEntry, feed: StaticFeed) =>
  Effect.flatMap(unzipGtfs(zip), (files) => compileGtfs(files, entry, feed));
