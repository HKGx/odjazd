import { compareCorridors, departuresFromArea, resolveArea } from "@odjazd/engine";
import { localToEpoch, type EpochSeconds, type LineId } from "@odjazd/model";
import { scheduleRealization, straightLineWalking } from "@odjazd/prediction";
import type { Timetable } from "@odjazd/timetable";
import type { BoardDto, BoardQuery, CompareQuery, ComparisonDto, LineLabel } from "./schema.ts";

/** The engine bound to one loaded timetable; everything here is synchronous. */
export const makeHost = (timetable: Timetable) => {
  const realization = scheduleRealization(timetable);
  const walking = straightLineWalking();
  const lineIndex = new Map(timetable.lines.map((line) => [line.id, line]));

  const label = (id: LineId): LineLabel => {
    const line = lineIndex.get(id);
    const short = id.split("@")[0] ?? id;
    return { id, label: short.slice(short.indexOf(":") + 1), mode: line?.mode ?? "bus" };
  };
  const tripOf = new Map<string, number>();
  const headsign = (tripFeedId: string) => {
    if (tripOf.size === 0) timetable.trips.feedIds.forEach((id, i) => tripOf.set(id, i));
    return timetable.trips.headsigns[tripOf.get(tripFeedId) ?? -1] ?? "";
  };
  const stopName = (stop: number) => timetable.stops.names[stop] ?? "?";

  const dayIndex = (date: string) => {
    const first = Date.parse(`${timetable.days.first}T00:00:00Z`);
    return Math.round((Date.parse(`${date}T00:00:00Z`) - first) / 86_400_000);
  };

  const compare = (request: CompareQuery): ComparisonDto => {
    const { date, areas, corridors } = request;
    const known = new Set(areas.map((area) => area.slug));
    const areaName = new Map<string, string>(areas.map((area) => [area.slug, area.name]));
    const rejected: Array<{ slug: string; reason: string }> = [];
    const usable = corridors.filter((corridor) => {
      const missing = corridor.legs
        .flatMap((leg) => [leg.from, leg.to])
        .filter((slug) => !known.has(slug));
      if (missing.length > 0) {
        rejected.push({ slug: corridor.slug, reason: `unknown area ${missing.join(", ")}` });
      }
      return missing.length === 0;
    });

    const day = dayIndex(date);
    const from = localToEpoch(date, request.from, timetable.timeZone);
    const to = localToEpoch(date, request.to, timetable.timeZone);
    const comparison = compareCorridors(
      {
        timetable,
        realization,
        walking,
        transferBufferSec: request.transferBufferSec,
        nonPreferredPenaltySec: 0,
        maxWaitSec: 3600,
      },
      usable,
      areas,
      from,
      (to < from ? from : to) as EpochSeconds,
      Math.max(1, request.stepMinutes) * 60,
    );

    return {
      date,
      timeZone: timetable.timeZone,
      inRange: day >= 0 && day < timetable.days.count,
      rejected,
      corridors: comparison.corridors.map((prepared) => ({
        slug: prepared.corridor.slug,
        name: prepared.corridor.name,
        legs: prepared.legs.map((leg) => ({
          from: leg.rule.from,
          to: leg.rule.to,
          fromName: areaName.get(leg.rule.from) ?? leg.rule.from,
          toName: areaName.get(leg.rule.to) ?? leg.rule.to,
          lines: leg.lines.map((line) => ({ ...label(line.id), instances: line.instances })),
        })),
      })),
      rows: comparison.rows.map((row) => ({
        departAt: row.departAt,
        results: row.results.map((itinerary) =>
          itinerary === undefined
            ? null
            : {
                departAt: itinerary.departAt,
                arriveAt: itinerary.arriveAt,
                legs: itinerary.legs.map((leg) => ({
                  ...label(leg.line),
                  headsign: headsign(leg.tripFeedId),
                  boardStop: stopName(leg.boardStop),
                  alightStop: stopName(leg.alightStop),
                  departAt: leg.departAt,
                  arriveAt: leg.arriveAt,
                  walkSec: leg.walkSec,
                  waitSec: leg.waitSec,
                  stayedAboard: leg.stayedAboard,
                })),
              },
        ),
      })),
      summaries: comparison.summaries,
    };
  };

  const board = (request: BoardQuery): BoardDto => {
    const { area } = request;
    const resolved = resolveArea(timetable, area);
    const departures = departuresFromArea(
      timetable,
      realization,
      area,
      request.at as EpochSeconds,
      request.horizonMinutes * 60,
      request.limit,
    );
    return {
      stops: Array.from(resolved.stops, (stop, i) => ({
        name: stopName(stop),
        distanceMeters: Math.round(resolved.distances[i] ?? 0),
      })),
      departures: departures.map((departure) => ({
        ...label(departure.line),
        headsign: departure.headsign,
        stop: stopName(departure.stop),
        departAt: departure.departAt,
      })),
    };
  };

  return { timetable, compare, board };
};

export type Host = ReturnType<typeof makeHost>;
