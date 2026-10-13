import type { EpochSeconds, InterchangeArea, LineId } from "@odjazd/model";
import type { Realization } from "@odjazd/prediction";
import { instantOn, runsOn, StopTimeFlag, type Timetable } from "@odjazd/timetable";
import { resolveArea } from "./areas.ts";

export interface Departure {
  readonly line: LineId;
  readonly headsign: string;
  readonly stop: number;
  /** Per the realization (equal to `scheduledAt` for the schedule realization). */
  readonly departAt: EpochSeconds;
  readonly scheduledAt: EpochSeconds;
  readonly trip: number;
  readonly day: number;
  /** Stop time index of this departure. */
  readonly stopTime: number;
  readonly tripFeedId: string;
}

/**
 * Next departures from any stop of `area` in `[from, from + horizonSec]`,
 * soonest first. Skips a trip's last stop and stops without pickup.
 */
export const departuresFromArea = (
  timetable: Timetable,
  realization: Realization,
  area: InterchangeArea,
  from: EpochSeconds,
  horizonSec: number,
  limit: number,
): ReadonlyArray<Departure> =>
  departuresFromStops(
    timetable,
    realization,
    resolveArea(timetable, area).stops,
    from,
    horizonSec,
    limit,
  );

/** Like {@link departuresFromArea}, for an explicit set of stop indexes. */
export const departuresFromStops = (
  timetable: Timetable,
  realization: Realization,
  stops: ArrayLike<number>,
  from: EpochSeconds,
  horizonSec: number,
  limit: number,
): ReadonlyArray<Departure> => {
  const member = new Uint8Array(timetable.stops.count);
  for (let i = 0; i < stops.length; i++) member[stops[i] ?? 0] = 1;
  const to = from + horizonSec;
  const { trips, stopTimes, days } = timetable;

  const dayRange: Array<number> = [];
  for (let day = 0; day < days.count; day++) {
    const anchor = days.anchors[day] ?? 0;
    if (anchor <= to && anchor + 2 * 86_400 >= from) dayRange.push(day);
  }

  const found: Array<Departure> = [];
  for (let trip = 0; trip < trips.count; trip++) {
    const first = trips.firstStopTime[trip] ?? 0;
    const last = (trips.firstStopTime[trip + 1] ?? 0) - 1;
    for (let st = first; st < last; st++) {
      const stop = stopTimes.stop[st] ?? 0;
      if (member[stop] !== 1 || ((stopTimes.flags[st] ?? 0) & StopTimeFlag.noPickup) !== 0) {
        continue;
      }
      for (const day of dayRange) {
        if (!runsOn(timetable, trips.service[trip] ?? 0, day)) continue;
        const departAt = realization.departure(day, st);
        if (departAt < from || departAt > to) continue;
        found.push({
          line: timetable.lines[trips.line[trip] ?? 0]?.id ?? ("?" as LineId),
          headsign: trips.headsigns[trip] ?? "",
          stop,
          departAt,
          scheduledAt: instantOn(timetable, day, stopTimes.departure[st] ?? 0),
          trip,
          day,
          stopTime: st,
          tripFeedId: trips.feedIds[trip] ?? "",
        });
      }
    }
  }
  found.sort((a, b) => a.departAt - b.departAt || a.line.localeCompare(b.line));
  return found.slice(0, limit);
};
