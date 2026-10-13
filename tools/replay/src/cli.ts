// Replay CLI. Usage:
//   pnpm -F @odjazd/replay compare --gtfs GTFS.zip --date 2026-10-14 [--from 07:00] [--to 09:00]
//     [--step 5] [--buffer 60]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { NodeRuntime } from "@effect/platform-node";
import { loadCatalog } from "@odjazd/cities";
import { compareCorridors, type Comparison } from "@odjazd/engine";
import { ingestGtfsZip } from "@odjazd/ingest";
import {
  Corridor,
  InterchangeArea,
  localToEpoch,
  ServiceDate,
  toZoned,
  type EpochSeconds,
  type TimeZone,
} from "@odjazd/model";
import { scheduleRealization, straightLineWalking } from "@odjazd/prediction";
import { Effect, Schema } from "effect";
import { lodzAreas, lodzCorridors } from "./fixtures/pl-lodz.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    gtfs: { type: "string" },
    date: { type: "string" },
    from: { type: "string", default: "07:00" },
    to: { type: "string", default: "09:00" },
    step: { type: "string", default: "5" },
    buffer: { type: "string", default: "60" },
  },
});

const hhmm = (epoch: number, timeZone: TimeZone) =>
  toZoned(epoch as EpochSeconds, timeZone)
    .toPlainTime()
    .toString({ smallestUnit: "minute" });

const pad = (text: string, width: number) => text.padEnd(width);

const render = (comparison: Comparison, timeZone: TimeZone, stopNames: ReadonlyArray<string>) => {
  const out: Array<string> = [];
  const columns = comparison.corridors.map((_, i) => `R${i + 1}`);

  comparison.corridors.forEach((prepared, i) => {
    out.push(`${columns[i]}  ${prepared.corridor.name}`);
    for (const leg of prepared.legs) {
      const lines = leg.lines.map((line) => `${line.id.split("@")[0]} (${line.instances})`);
      out.push(
        `      ${leg.rule.from} → ${leg.rule.to}: ${lines.length === 0 ? "NO SERVICE" : lines.join(", ")}`,
      );
    }
  });
  out.push("");

  const width = 22;
  out.push(["depart", ...columns].map((c, i) => pad(c, i === 0 ? 8 : width)).join(""));
  for (const row of comparison.rows) {
    const best = Math.min(...row.results.map((r) => r?.arriveAt ?? Number.POSITIVE_INFINITY));
    const cells = row.results.map((result) => {
      if (result === undefined) return pad("—", width);
      const minutes = Math.round((result.arriveAt - row.departAt) / 60);
      const via = result.legs.map((leg) => leg.line.split("@")[0]?.split(":")[1]).join("→");
      const mark = result.arriveAt === best ? "*" : " ";
      return pad(`${hhmm(result.arriveAt, timeZone)}${mark}${minutes}m ${via}`, width);
    });
    out.push(pad(hhmm(row.departAt, timeZone), 8) + cells.join(""));
  }
  out.push("", "* = earliest arrival for that departure", "");

  out.push(
    ["", "feasible", "mean", "median", "worst", "earliest", "mean loss"]
      .map((c, i) => pad(c, i === 0 ? 6 : 11))
      .join(""),
  );
  const fmt = (value: number | undefined) => (value === undefined ? "—" : `${value.toFixed(1)}m`);
  comparison.summaries.forEach((s, i) => {
    out.push(
      [
        columns[i] ?? "",
        `${s.feasible}/${comparison.rows.length}`,
        fmt(s.meanMinutes),
        fmt(s.medianMinutes),
        fmt(s.worstMinutes),
        `${s.earliest}`,
        fmt(s.meanLossMinutes),
      ]
        .map((c, j) => pad(c, j === 0 ? 6 : 11))
        .join(""),
    );
  });

  const sample = comparison.rows.find((row) => row.results.some((r) => r !== undefined));
  if (sample !== undefined) {
    out.push("", `Itineraries for ${hhmm(sample.departAt, timeZone)}:`);
    sample.results.forEach((result, i) => {
      if (result === undefined) return;
      const legs = result.legs.map(
        (leg) =>
          `${leg.line.split("@")[0]} ${stopNames[leg.boardStop]} ${hhmm(leg.departAt, timeZone)}` +
          ` → ${stopNames[leg.alightStop]} ${hhmm(leg.arriveAt, timeZone)}` +
          ` (walk ${Math.round(leg.walkSec)}s, wait ${Math.round(leg.waitSec / 60)}m)`,
      );
      out.push(`  ${columns[i]}: ${legs.join("  |  ")}`);
    });
  }
  return out.join("\n");
};

const compare = Effect.gen(function* () {
  const { gtfs, date } = values;
  if (gtfs === undefined || date === undefined) {
    return yield* Effect.fail("usage: compare --gtfs <GTFS.zip> --date YYYY-MM-DD");
  }
  const catalog = yield* loadCatalog;
  const entry = catalog.find((city) => city.id === "pl-lodz");
  const feed = entry?.feeds.static[0];
  if (entry === undefined || feed === undefined) return yield* Effect.fail("pl-lodz missing");

  const zip = yield* Effect.try({
    try: () => readFileSync(gtfs),
    catch: (cause) => `cannot read ${gtfs}: ${String(cause)}`,
  });
  const { timetable } = yield* ingestGtfsZip(zip, entry, feed);
  const serviceDate = yield* Schema.decodeEffect(ServiceDate)(date);
  const areas = yield* Schema.decodeEffect(Schema.Array(InterchangeArea))(lodzAreas);
  const corridors = yield* Schema.decodeEffect(Schema.Array(Corridor))(lodzCorridors);

  const options = {
    timetable,
    realization: scheduleRealization(timetable),
    walking: straightLineWalking(),
    transferBufferSec: Number(values.buffer),
    nonPreferredPenaltySec: 0,
    maxWaitSec: 3600,
  };
  const from = localToEpoch(serviceDate, values.from, entry.timezone);
  const to = localToEpoch(serviceDate, values.to, entry.timezone);
  const comparison = compareCorridors(
    options,
    corridors,
    areas,
    from,
    to,
    Number(values.step) * 60,
  );

  yield* Effect.logInfo(
    `${entry.id} feed ${timetable.feedVersion ?? "?"}, ${date} ${values.from}–${values.to} ` +
      `every ${values.step} min, transfer buffer ${values.buffer}s (schedule only)`,
  );
  process.stdout.write(`${render(comparison, entry.timezone, timetable.stops.names)}\n`);
});

if (positionals[0] === "compare") {
  NodeRuntime.runMain(compare);
} else {
  process.stderr.write("commands: compare\n");
  process.exitCode = 1;
}
