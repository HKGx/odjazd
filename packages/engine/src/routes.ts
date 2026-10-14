import {
  distanceMeters,
  type AreaSlug,
  type Corridor,
  type EpochSeconds,
  type InterchangeArea,
  type LatLon,
  type LegRule,
  type LineId,
} from "@odjazd/model";
import type { Realization, WalkingModel } from "@odjazd/prediction";
import type { Timetable } from "@odjazd/timetable";
import { resolveArea } from "./areas.ts";
import {
  evaluateFirstSuitable,
  type EvaluationOptions,
  type Itinerary,
  prepareCorridor,
} from "./evaluate.ts";
import { resolveLeg } from "./legs.ts";

/*
 * The user's routes inside trip planning. A route (corridor) is a chain of
 * interchange areas; any contiguous part of it whose first area is within
 * walking distance of the origin and whose last area is within walking
 * distance of the destination is a candidate. It's evaluated with the same
 * "first suitable vehicle at each area" policy as the comparison view.
 */

export interface RouteMatch {
  /** The original route. */
  readonly corridor: Corridor;
  /** The part used: legs `fromLeg .. toLeg - 1` of the original. */
  readonly used: Corridor;
  readonly fromLeg: number;
  readonly toLeg: number;
  readonly accessSec: number;
  readonly egressSec: number;
}

/** Area slugs of a corridor in travel order. */
export const chainOf = (corridor: Corridor): ReadonlyArray<AreaSlug> => [
  corridor.legs[0].from,
  ...corridor.legs.map((leg) => leg.to),
];

/**
 * Routes usable between two points, with the part of each that fits best:
 * least walking to the first area and from the last; on a tie, more of the
 * route. Routes with an unknown area are skipped.
 */
export const matchRoutes = (
  corridors: ReadonlyArray<Corridor>,
  areas: ReadonlyArray<InterchangeArea>,
  from: LatLon,
  to: LatLon,
  walking: WalkingModel,
  maxWalkSec: number,
): ReadonlyArray<RouteMatch> => {
  const bySlug = new Map(areas.map((area) => [area.slug, area]));
  const matches: Array<RouteMatch> = [];
  for (const corridor of corridors) {
    const chain = chainOf(corridor).map((slug) => bySlug.get(slug));
    if (chain.some((area) => area === undefined)) continue;
    const centers = chain as ReadonlyArray<InterchangeArea>;
    // Walking to an area counts from its edge: anywhere inside is "there".
    const walkTo = (area: InterchangeArea, point: LatLon) => {
      const meters = distanceMeters(point.lat, point.lon, area.center.lat, area.center.lon);
      if (meters <= area.radiusMeters) return 0;
      const seconds = walking.seconds(point.lat, point.lon, area.center.lat, area.center.lon);
      return (seconds * (meters - area.radiusMeters)) / meters;
    };
    let best: RouteMatch | undefined;
    for (let i = 0; i < centers.length - 1; i++) {
      const access = walkTo(centers[i] as InterchangeArea, from);
      if (access > maxWalkSec) continue;
      for (let j = centers.length - 1; j > i; j--) {
        const egress = walkTo(centers[j] as InterchangeArea, to);
        if (egress > maxWalkSec) continue;
        const cost = access + egress;
        const bestCost = best === undefined ? Infinity : best.accessSec + best.egressSec;
        const longer = best !== undefined && j - i > best.toLeg - best.fromLeg;
        if (cost < bestCost - 30 || (Math.abs(cost - bestCost) <= 30 && longer)) {
          const legs = corridor.legs.slice(i, j) as unknown as Corridor["legs"];
          best = {
            corridor,
            used: { ...corridor, legs },
            fromLeg: i,
            toLeg: j,
            accessSec: access,
            egressSec: egress,
          };
        }
      }
    }
    if (best !== undefined) matches.push(best);
  }
  return matches;
};

export interface RouteOption extends Itinerary {
  readonly match: RouteMatch;
}

/**
 * Up to `count` departures following a matched route from `at` on, from the
 * origin point to the destination point. Each next one is looked for just
 * after the previous one leaves.
 */
export const routeOptions = (
  options: EvaluationOptions,
  match: RouteMatch,
  areas: ReadonlyArray<InterchangeArea>,
  from: LatLon,
  to: LatLon,
  at: EpochSeconds,
  count: number,
  horizonSec = 2 * 3600,
): ReadonlyArray<RouteOption> => {
  const prepared = {
    ...prepareCorridor(options, match.used, areas, at, (at + horizonSec) as EpochSeconds),
    origin: from,
    destination: to,
  };
  const result: Array<RouteOption> = [];
  let t = at;
  for (let n = 0; n < count; n++) {
    const itinerary = evaluateFirstSuitable(options, prepared, t);
    const first = itinerary?.legs[0];
    if (itinerary === undefined || first === undefined) break;
    const leave = (first.departAt - first.walkSec) as EpochSeconds;
    result.push({ ...itinerary, departAt: leave, match });
    t = (leave + 60) as EpochSeconds;
  }
  return result;
};

export interface SectionDeparture {
  readonly trip: number;
  readonly day: number;
  /** Stop time indexes. */
  readonly board: number;
  readonly alight: number;
  readonly departAt: number;
  readonly arriveAt: number;
}

export interface SectionLine {
  readonly line: LineId;
  readonly preferred: boolean;
  /** Reachable departures, soonest first. */
  readonly departures: ReadonlyArray<SectionDeparture>;
}

/**
 * Every line that can take the rider across one section (from one area to
 * the next) after `ready`, with its next few departures the rider can still
 * reach on foot from `position`. The soonest line first: these are the
 * vehicles one can substitute for each other.
 */
export const sectionOptions = (
  timetable: Timetable,
  realization: Realization,
  walking: WalkingModel,
  rule: LegRule,
  fromArea: InterchangeArea,
  toArea: InterchangeArea,
  position: LatLon,
  ready: number,
  bufferSec: number,
  windowSec = 30 * 60,
  perLine = 3,
): ReadonlyArray<SectionLine> => {
  const leg = resolveLeg(
    timetable,
    realization,
    rule,
    resolveArea(timetable, fromArea),
    resolveArea(timetable, toArea),
    ready as EpochSeconds,
    (ready + windowSec) as EpochSeconds,
  );
  const { stops, stopTimes, trips, lines } = timetable;
  const byLine = new Map<number, { preferred: boolean; departures: Array<SectionDeparture> }>();
  for (let k = 0; k < leg.count; k++) {
    const board = leg.board[k] ?? 0;
    const stop = stopTimes.stop[board] ?? 0;
    const walk = walking.seconds(
      position.lat,
      position.lon,
      stops.lat[stop] ?? 0,
      stops.lon[stop] ?? 0,
    );
    const departAt = leg.departure[k] ?? 0;
    if (departAt < ready + walk + bufferSec) continue;
    const trip = leg.trip[k] ?? 0;
    const line = trips.line[trip] ?? 0;
    const entry = byLine.get(line) ?? { preferred: leg.preferred[k] === 1, departures: [] };
    byLine.set(line, entry);
    // One trip can board at several stops of the area; keep its first.
    if (entry.departures.length >= perLine || entry.departures.some((d) => d.trip === trip)) {
      continue;
    }
    entry.departures.push({
      trip,
      day: leg.day[k] ?? 0,
      board,
      alight: leg.alight[k] ?? 0,
      departAt,
      arriveAt: leg.arrival[k] ?? 0,
    });
  }
  return [...byLine]
    .map(([line, entry]) => ({
      line: lines[line]?.id ?? ("?" as LineId),
      preferred: entry.preferred,
      departures: entry.departures,
    }))
    .sort((a, b) => (a.departures[0]?.departAt ?? 0) - (b.departures[0]?.departAt ?? 0));
};

export interface SectionSummary {
  readonly line: LineId;
  /** Instances in the window: how often it runs. */
  readonly trips: number;
  /** Median ride time between the areas, seconds. */
  readonly rideSec: number;
}

/**
 * What runs between two areas over a span (e.g. a whole service day),
 * regardless of rules: for the route editor's line chips.
 */
export const sectionLines = (
  timetable: Timetable,
  realization: Realization,
  fromArea: InterchangeArea,
  toArea: InterchangeArea,
  from: EpochSeconds,
  to: EpochSeconds,
): ReadonlyArray<SectionSummary> => {
  const rule: LegRule = { from: fromArea.slug, to: toArea.slug, allow: {} };
  const leg = resolveLeg(
    timetable,
    realization,
    rule,
    resolveArea(timetable, fromArea),
    resolveArea(timetable, toArea),
    from,
    to,
  );
  const rides = new Map<number, Array<number>>();
  for (let k = 0; k < leg.count; k++) {
    const line = timetable.trips.line[leg.trip[k] ?? 0] ?? 0;
    const list = rides.get(line) ?? [];
    list.push((leg.arrival[k] ?? 0) - (leg.departure[k] ?? 0));
    rides.set(line, list);
  }
  return [...rides]
    .map(([line, list]) => {
      const sorted = list.sort((a, b) => a - b);
      return {
        line: timetable.lines[line]?.id ?? ("?" as LineId),
        trips: list.length,
        rideSec: sorted[Math.floor(sorted.length / 2)] ?? 0,
      };
    })
    .sort((a, b) => b.trips - a.trips);
};
