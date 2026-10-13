import type {
  AreaSlug,
  Corridor,
  EpochSeconds,
  InterchangeArea,
  LatLon,
  LineId,
} from "@odjazd/model";
import type { Realization, WalkingModel } from "@odjazd/prediction";
import type { Timetable } from "@odjazd/timetable";
import { resolveArea, type ResolvedArea } from "./areas.ts";
import { firstDepartingAt, resolveLeg, type ResolvedLeg } from "./legs.ts";

export interface EvaluationOptions {
  readonly timetable: Timetable;
  readonly realization: Realization;
  readonly walking: WalkingModel;
  /** Extra slack required for every transfer (not the first boarding). */
  readonly transferBufferSec: number;
  /** How much later non-preferred lines effectively depart, when a leg prefers lines. */
  readonly nonPreferredPenaltySec: number;
  /** Give up on a leg if nothing departs within this long. */
  readonly maxWaitSec: number;
}

export interface PreparedCorridor {
  readonly corridor: Corridor;
  readonly origin: LatLon;
  readonly destination: LatLon;
  readonly legs: ReadonlyArray<ResolvedLeg>;
  readonly areas: ReadonlyMap<AreaSlug, ResolvedArea>;
}

export interface LegResult {
  readonly line: LineId;
  readonly tripFeedId: string;
  readonly boardStop: number;
  readonly alightStop: number;
  readonly walkSec: number;
  readonly waitSec: number;
  /** The rider stayed on the vehicle of the previous leg. */
  readonly stayedAboard: boolean;
  readonly departAt: EpochSeconds;
  readonly arriveAt: EpochSeconds;
}

/** Outcome of following the policy from the origin area's center at `departAt`. */
export interface Itinerary {
  readonly departAt: EpochSeconds;
  /** At the destination area's center. */
  readonly arriveAt: EpochSeconds;
  readonly legs: ReadonlyArray<LegResult>;
}

/**
 * Resolves the corridor's areas and leg rules for departures from `from`
 * (origin) up to `to` plus the per-leg wait limit. Throws if an area is unknown:
 * callers validate corridors against their areas first.
 */
export const prepareCorridor = (
  options: EvaluationOptions,
  corridor: Corridor,
  areaList: ReadonlyArray<InterchangeArea>,
  from: EpochSeconds,
  to: EpochSeconds,
): PreparedCorridor => {
  const bySlug = new Map(areaList.map((area) => [area.slug, area]));
  const area = (slug: AreaSlug) => {
    const found = bySlug.get(slug);
    if (found === undefined) throw new Error(`corridor ${corridor.slug}: unknown area ${slug}`);
    return found;
  };
  const resolved = new Map<AreaSlug, ResolvedArea>();
  for (const leg of corridor.legs) {
    for (const slug of [leg.from, leg.to]) {
      if (!resolved.has(slug)) resolved.set(slug, resolveArea(options.timetable, area(slug)));
    }
  }
  // Later legs can start up to (legs × maxWait + travel) after the last origin departure.
  const horizon = (to + corridor.legs.length * (options.maxWaitSec + 3600)) as EpochSeconds;
  const legs = corridor.legs.map((rule) =>
    resolveLeg(
      options.timetable,
      options.realization,
      rule,
      resolved.get(rule.from) as ResolvedArea,
      resolved.get(rule.to) as ResolvedArea,
      from,
      horizon,
    ),
  );
  const first = corridor.legs[0];
  const last = corridor.legs[corridor.legs.length - 1];
  return {
    corridor,
    origin: area(first.from).center,
    destination: area(last?.to ?? first.to).center,
    legs,
    areas: resolved,
  };
};

/**
 * "Board the first suitable vehicle" at every area: at each leg take the
 * instance with the earliest (penalized) departure that the rider can still
 * reach on foot from where they are, then ride to the leg's first stop in the
 * next area. `undefined` if some leg has no reachable departure.
 */
export const evaluateFirstSuitable = (
  options: EvaluationOptions,
  prepared: PreparedCorridor,
  departAt: EpochSeconds,
): Itinerary | undefined => {
  const { timetable, walking } = options;
  const { lat, lon } = timetable.stops;
  let atLat = prepared.origin.lat;
  let atLon = prepared.origin.lon;
  let time: number = departAt;
  const results: Array<LegResult> = [];
  // The trip instance the rider is on, and where they'd get off; -1 before boarding.
  let onTrip = -1;
  let onDay = -1;
  let onAlight = -1;

  for (let l = 0; l < prepared.legs.length; l++) {
    const leg = prepared.legs[l];
    if (leg === undefined) return undefined;
    const buffer = l === 0 ? 0 : options.transferBufferSec;
    const maxWalk =
      leg.rule.maxWalkMin === undefined ? Number.POSITIVE_INFINITY : leg.rule.maxWalkMin * 60;
    const giveUpAt = time + options.maxWaitSec;

    let best = -1;
    let bestKey = Number.POSITIVE_INFINITY;
    let bestWalk = 0;
    for (let k = firstDepartingAt(leg, time); k < leg.count; k++) {
      const departure = leg.departure[k] ?? 0;
      // Penalties only push options later, so nothing past the best key can win.
      if (departure > bestKey || departure > giveUpAt) break;
      // Staying aboard needs no walk and no transfer buffer.
      const aboard =
        leg.trip[k] === onTrip && leg.day[k] === onDay && (leg.board[k] ?? 0) >= onAlight;
      const stop = timetable.stopTimes.stop[leg.board[k] ?? 0] ?? 0;
      const walk = aboard ? 0 : walking.seconds(atLat, atLon, lat[stop] ?? 0, lon[stop] ?? 0);
      if (!aboard && (walk > maxWalk || departure < time + walk + buffer)) continue;
      const key = departure + (leg.preferred[k] === 1 ? 0 : options.nonPreferredPenaltySec);
      const better =
        key < bestKey || (key === bestKey && (leg.arrival[k] ?? 0) < (leg.arrival[best] ?? 0));
      if (better) {
        best = k;
        bestKey = key;
        bestWalk = walk;
      }
    }
    if (best < 0) return undefined;

    const trip = leg.trip[best] ?? 0;
    const day = leg.day[best] ?? 0;
    const stayedAboard = trip === onTrip && day === onDay;
    const boardStop = timetable.stopTimes.stop[leg.board[best] ?? 0] ?? 0;
    const alightStop = timetable.stopTimes.stop[leg.alight[best] ?? 0] ?? 0;
    const legDepart = leg.departure[best] ?? 0;
    const legArrive = leg.arrival[best] ?? 0;
    results.push({
      line: timetable.lines[timetable.trips.line[trip] ?? 0]?.id ?? ("?" as LineId),
      tripFeedId: timetable.trips.feedIds[trip] ?? "",
      boardStop,
      alightStop,
      walkSec: bestWalk,
      waitSec: legDepart - time - bestWalk,
      stayedAboard,
      departAt: legDepart as EpochSeconds,
      arriveAt: legArrive as EpochSeconds,
    });
    time = legArrive;
    onTrip = trip;
    onDay = day;
    onAlight = leg.alight[best] ?? 0;
    atLat = lat[alightStop] ?? 0;
    atLon = lon[alightStop] ?? 0;
  }

  const finalWalk = walking.seconds(
    atLat,
    atLon,
    prepared.destination.lat,
    prepared.destination.lon,
  );
  return { departAt, arriveAt: Math.round(time + finalWalk) as EpochSeconds, legs: results };
};

/** The policy evaluated for departures every `stepSec` in `[from, to]`. */
export const evaluateWindow = (
  options: EvaluationOptions,
  prepared: PreparedCorridor,
  from: EpochSeconds,
  to: EpochSeconds,
  stepSec: number,
): ReadonlyArray<{
  readonly departAt: EpochSeconds;
  readonly itinerary: Itinerary | undefined;
}> => {
  const rows = [];
  for (let t = from; t <= to; t = (t + stepSec) as EpochSeconds) {
    rows.push({ departAt: t, itinerary: evaluateFirstSuitable(options, prepared, t) });
  }
  return rows;
};
