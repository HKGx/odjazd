import { lineRefMatches, type EpochSeconds, type LegRule, type LineId } from "@odjazd/model";
import type { Realization } from "@odjazd/prediction";
import { runsOn, StopTimeFlag, type Timetable } from "@odjazd/timetable";
import type { ResolvedArea } from "./areas.ts";

/**
 * A leg rule resolved against one timetable and realization: every trip
 * instance that can carry the rider from the `from` area to the `to` area
 * within the window, sorted by departure. Struct-of-arrays for the scan.
 */
export interface ResolvedLeg {
  readonly rule: LegRule;
  readonly count: number;
  readonly departure: Float64Array;
  readonly arrival: Float64Array;
  readonly trip: Uint32Array;
  readonly day: Uint32Array;
  /** Stop time indexes of boarding and alighting. */
  readonly board: Uint32Array;
  readonly alight: Uint32Array;
  readonly preferred: Uint8Array;
  /** What the rule resolved to: lines with at least one instance, by instance count. */
  readonly lines: ReadonlyArray<{ readonly id: LineId; readonly instances: number }>;
}

const membership = (timetable: Timetable, area: ResolvedArea): Uint8Array => {
  const member = new Uint8Array(timetable.stops.count);
  for (const stop of area.stops) member[stop] = 1;
  return member;
};

const lineFilter = (timetable: Timetable, rule: LegRule) =>
  timetable.lines.map((line) => {
    const { modes, lines } = rule.allow;
    const allowed =
      (modes === undefined || modes.includes(line.mode)) &&
      (lines === undefined || lines.some((ref) => lineRefMatches(ref, line.id))) &&
      !(rule.avoid ?? []).some((ref) => lineRefMatches(ref, line.id));
    const preferred = (rule.prefer ?? []).some((ref) => lineRefMatches(ref, line.id));
    return { allowed, preferred };
  });

/**
 * Instances depart in `[from, to]`. A trip that passes several stops of the
 * `from` area yields one instance per boarding stop; each alights at the first
 * `to` stop after it.
 */
export const resolveLeg = (
  timetable: Timetable,
  realization: Realization,
  rule: LegRule,
  fromArea: ResolvedArea,
  toArea: ResolvedArea,
  from: EpochSeconds,
  to: EpochSeconds,
): ResolvedLeg => {
  const isFrom = membership(timetable, fromArea);
  const isTo = membership(timetable, toArea);
  const filter = lineFilter(timetable, rule);
  const { trips, stopTimes, days } = timetable;

  // Service days whose trips can depart inside the window (offsets reach ~31 h).
  const dayRange: Array<number> = [];
  for (let day = 0; day < days.count; day++) {
    const anchor = days.anchors[day] ?? 0;
    if (anchor <= to && anchor + 2 * 86_400 >= from) dayRange.push(day);
  }

  type Instance = {
    departure: number;
    arrival: number;
    trip: number;
    day: number;
    board: number;
    alight: number;
  };
  const instances: Array<Instance> = [];
  const lineCounts = new Map<number, number>();

  for (let trip = 0; trip < trips.count; trip++) {
    const line = trips.line[trip] ?? 0;
    if (filter[line]?.allowed !== true) continue;
    const first = trips.firstStopTime[trip] ?? 0;
    const last = (trips.firstStopTime[trip + 1] ?? 0) - 1;

    // Walk backwards, remembering the nearest later stop in the `to` area.
    const pairs: Array<readonly [number, number]> = [];
    let nextTo = -1;
    for (let st = last; st >= first; st--) {
      const stop = stopTimes.stop[st] ?? 0;
      const flags = stopTimes.flags[st] ?? 0;
      if (nextTo >= 0 && isFrom[stop] === 1 && (flags & StopTimeFlag.noPickup) === 0) {
        pairs.push([st, nextTo]);
      }
      if (isTo[stop] === 1 && (flags & StopTimeFlag.noDropOff) === 0) nextTo = st;
    }
    if (pairs.length === 0) continue;

    const service = trips.service[trip] ?? 0;
    for (const day of dayRange) {
      if (!runsOn(timetable, service, day)) continue;
      for (const [board, alight] of pairs) {
        const departure = realization.departure(day, board);
        if (departure < from || departure > to) continue;
        instances.push({
          departure,
          arrival: realization.arrival(day, alight),
          trip,
          day,
          board,
          alight,
        });
        lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
      }
    }
  }

  instances.sort((a, b) => a.departure - b.departure || a.arrival - b.arrival);
  return {
    rule,
    count: instances.length,
    departure: Float64Array.from(instances, (i) => i.departure),
    arrival: Float64Array.from(instances, (i) => i.arrival),
    trip: Uint32Array.from(instances, (i) => i.trip),
    day: Uint32Array.from(instances, (i) => i.day),
    board: Uint32Array.from(instances, (i) => i.board),
    alight: Uint32Array.from(instances, (i) => i.alight),
    preferred: Uint8Array.from(instances, (i) =>
      filter[trips.line[i.trip] ?? 0]?.preferred === true ? 1 : 0,
    ),
    lines: [...lineCounts]
      .sort((a, b) => b[1] - a[1])
      .map(([line, instances]) => ({
        id: timetable.lines[line]?.id ?? ("?" as LineId),
        instances,
      })),
  };
};

/** Index of the first instance departing at or after `time` (binary search). */
export const firstDepartingAt = (leg: ResolvedLeg, time: number): number => {
  let lo = 0;
  let hi = leg.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((leg.departure[mid] ?? 0) < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
