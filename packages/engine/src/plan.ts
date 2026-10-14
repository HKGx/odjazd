import { distanceMeters } from "@odjazd/model";
import type { Realization, WalkingModel } from "@odjazd/prediction";
import { runsOn, StopTimeFlag, type Timetable } from "@odjazd/timetable";

/*
 * Point-to-point journey search: RAPTOR (Delling et al.), one round per
 * vehicle, so each round's best arrival is the Pareto front over transfers.
 * Times come from a `Realization`, so live delays move boardings and
 * arrivals; avoided lines are never boarded.
 */

/** Trips with one stop sequence that never overtake each other. */
interface Pattern {
  readonly line: number;
  readonly stops: Uint32Array;
  /** Sorted by scheduled departure; FIFO at every position. */
  readonly trips: Uint32Array;
}

export interface PlanIndex {
  readonly patterns: ReadonlyArray<Pattern>;
  /** Per stop: pairs of (pattern, position) flattened. */
  readonly patternsOfStop: ReadonlyArray<Uint32Array>;
  /** Per stop: stops within transfer walking distance (excluding itself). */
  readonly neighbors: ReadonlyArray<Uint32Array>;
  /** Walking meters to each of `neighbors`, along the ground. */
  readonly neighborMeters: ReadonlyArray<Uint32Array>;
}

/** Without footpaths: straight-line estimate, as in `straightLineWalking`. */
const detourFactor = 1.3;

export const buildPlanIndex = (timetable: Timetable, maxTransferMeters = 400): PlanIndex => {
  const { trips, stopTimes, stops } = timetable;
  const byKey = new Map<string, Array<number>>();
  for (let trip = 0; trip < trips.count; trip++) {
    const first = trips.firstStopTime[trip] ?? 0;
    const last = trips.firstStopTime[trip + 1] ?? 0;
    if (last - first < 2) continue;
    // Pickup/drop-off flags are part of the key: trips of one pattern must allow the same
    // boardings and alightings, or skipping a trip could hide a later one that works.
    const key =
      `${trips.line[trip]}:${Array.from(stopTimes.stop.subarray(first, last)).join(",")}:` +
      Array.from(stopTimes.flags.subarray(first, last)).join("");
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [trip]);
    else list.push(trip);
  }

  const dep = (trip: number, i: number) =>
    stopTimes.departure[(trips.firstStopTime[trip] ?? 0) + i] ?? 0;
  const arr = (trip: number, i: number) =>
    stopTimes.arrival[(trips.firstStopTime[trip] ?? 0) + i] ?? 0;
  const patterns: Array<Pattern> = [];
  for (const group of byKey.values()) {
    const first = group[0] ?? 0;
    const length = (trips.firstStopTime[first + 1] ?? 0) - (trips.firstStopTime[first] ?? 0);
    group.sort((a, b) => dep(a, 0) - dep(b, 0));
    // Greedy split so no trip overtakes the one before it in its pattern.
    const lanes: Array<Array<number>> = [];
    for (const trip of group) {
      const lane = lanes.find((candidate) => {
        const before = candidate[candidate.length - 1] ?? 0;
        for (let i = 0; i < length; i++) {
          if (dep(trip, i) < dep(before, i) || arr(trip, i) < arr(before, i)) return false;
        }
        return true;
      });
      if (lane === undefined) lanes.push([trip]);
      else lane.push(trip);
    }
    const stopSeq = stopTimes.stop.slice(
      trips.firstStopTime[first] ?? 0,
      trips.firstStopTime[first + 1] ?? 0,
    );
    for (const lane of lanes) {
      patterns.push({
        line: trips.line[first] ?? 0,
        stops: stopSeq,
        trips: Uint32Array.from(lane),
      });
    }
  }

  const ofStop = Array.from({ length: stops.count }, () => [] as Array<number>);
  patterns.forEach((pattern, p) => {
    pattern.stops.forEach((stop, i) => {
      // A stop visited twice (loops) keeps its first position; boarding later is rarely better.
      const list = ofStop[stop];
      if (list === undefined) return;
      for (let j = 0; j < list.length; j += 2) if (list[j] === p) return;
      list.push(p, i);
    });
  });

  // The timetable's street footpaths when it has them.
  const { footpaths } = timetable;
  if (footpaths !== undefined) {
    const range = (s: number) => [footpaths.first[s] ?? 0, footpaths.first[s + 1] ?? 0] as const;
    return {
      patterns,
      patternsOfStop: ofStop.map((list) => Uint32Array.from(list)),
      neighbors: Array.from({ length: stops.count }, (_, s) => footpaths.to.subarray(...range(s))),
      neighborMeters: Array.from({ length: stops.count }, (_, s) =>
        footpaths.meters.subarray(...range(s)),
      ),
    };
  }

  // Otherwise neighbors via a latitude-sorted sweep.
  const order = Array.from({ length: stops.count }, (_, i) => i).sort(
    (a, b) => (stops.lat[a] ?? 0) - (stops.lat[b] ?? 0),
  );
  const near = Array.from({ length: stops.count }, () => [] as Array<number>);
  const dLat = maxTransferMeters / 111_320;
  for (let a = 0; a < order.length; a++) {
    const i = order[a] ?? 0;
    const lat = stops.lat[i] ?? 0;
    const lon = stops.lon[i] ?? 0;
    for (let b = a + 1; b < order.length; b++) {
      const j = order[b] ?? 0;
      if ((stops.lat[j] ?? 0) - lat > dLat) break;
      if (distanceMeters(lat, lon, stops.lat[j] ?? 0, stops.lon[j] ?? 0) <= maxTransferMeters) {
        near[i]?.push(j);
        near[j]?.push(i);
      }
    }
  }

  return {
    patterns,
    patternsOfStop: ofStop.map((list) => Uint32Array.from(list)),
    neighbors: near.map((list) => Uint32Array.from(list)),
    neighborMeters: near.map((list, i) =>
      Uint32Array.from(list, (j) =>
        Math.round(
          distanceMeters(
            stops.lat[i] ?? 0,
            stops.lon[i] ?? 0,
            stops.lat[j] ?? 0,
            stops.lon[j] ?? 0,
          ) * detourFactor,
        ),
      ),
    ),
  };
};

export interface Endpoint {
  readonly lat: number;
  readonly lon: number;
  /** Stops to start or end at; stops near the point when absent. */
  readonly stops?: ReadonlyArray<number> | undefined;
}

export type PlannedLeg =
  | {
      readonly kind: "walk";
      /** Stop index at either end; `undefined` for the origin or destination point. */
      readonly fromStop: number | undefined;
      readonly toStop: number | undefined;
      readonly departAt: number;
      readonly arriveAt: number;
    }
  | {
      readonly kind: "ride";
      readonly trip: number;
      readonly day: number;
      readonly line: number;
      /** Stop time indexes of boarding and alighting. */
      readonly board: number;
      readonly alight: number;
      readonly departAt: number;
      readonly arriveAt: number;
    };

export interface Journey {
  /** When to leave the origin. */
  readonly departAt: number;
  readonly arriveAt: number;
  readonly legs: ReadonlyArray<PlannedLeg>;
  readonly rides: number;
}

export interface PlanOptions {
  readonly realization: Realization;
  readonly walking: WalkingModel;
  /** Epoch seconds: leave no earlier than this. */
  readonly at: number;
  /** Extra seconds to change vehicles. */
  readonly transferBufferSec: number;
  readonly maxRides?: number;
  /** Line indexes never to board. */
  readonly avoidLines?: ReadonlySet<number>;
  /** Walk radius around a point origin or destination. */
  readonly accessMeters?: number;
  /** Departures may run up to this late; searched trips start this far before `at`. */
  readonly maxDelaySec?: number;
}

const none = -1;
const KIND_ACCESS = 1;
const KIND_RIDE = 2;
const KIND_WALK = 3;

/** Stops around an endpoint with the walking time to each. */
const accessStops = (
  timetable: Timetable,
  endpoint: Endpoint,
  walking: WalkingModel,
  radius: number,
): Map<number, number> => {
  const { stops } = timetable;
  const result = new Map<number, number>();
  const walkTo = (stop: number) =>
    walking.seconds(endpoint.lat, endpoint.lon, stops.lat[stop] ?? 0, stops.lon[stop] ?? 0);
  if (endpoint.stops !== undefined && endpoint.stops.length > 0) {
    for (const stop of endpoint.stops) result.set(stop, walkTo(stop));
    return result;
  }
  for (const r of [radius, radius * 2]) {
    for (let stop = 0; stop < stops.count; stop++) {
      const d = distanceMeters(
        endpoint.lat,
        endpoint.lon,
        stops.lat[stop] ?? 0,
        stops.lon[stop] ?? 0,
      );
      if (d <= r) result.set(stop, walkTo(stop));
    }
    if (result.size > 0) break;
  }
  return result;
};

/**
 * One RAPTOR run from `options.at`: the earliest arrival using 1, 2, …
 * vehicles, keeping only results that improve on fewer vehicles.
 */
export const planOnce = (
  timetable: Timetable,
  index: PlanIndex,
  from: Endpoint,
  to: Endpoint,
  options: PlanOptions,
): ReadonlyArray<Journey> => {
  const { stops, stopTimes, trips, days } = timetable;
  const { realization, walking, at } = options;
  const maxRides = options.maxRides ?? 4;
  const radius = options.accessMeters ?? 700;
  const slack = options.maxDelaySec ?? 1800;
  const n = stops.count;

  const access = accessStops(timetable, from, walking, radius);
  const egress = accessStops(timetable, to, walking, radius);

  // Service days whose trips can run around `at` (incl. after-midnight trips of yesterday).
  const candidateDays: Array<number> = [];
  for (let d = 0; d < days.count; d++) {
    const anchor = days.anchors[d] ?? 0;
    if (anchor > at - 32 * 3600 && anchor < at + 24 * 3600) candidateDays.push(d);
  }

  const best = new Float64Array(n).fill(Infinity);
  // Labels per round. a: pattern (ride) or previous stop (walk); b: trip; c: day;
  // d, e: board and alight positions in the pattern.
  const rounds: Array<Round> = [];
  const makeRound = (): Round => ({
    arrival: new Float64Array(n).fill(Infinity),
    kind: new Int8Array(n),
    a: new Int32Array(n),
    b: new Int32Array(n),
    c: new Int32Array(n),
    d: new Int32Array(n),
    e: new Int32Array(n),
  });

  const round0 = makeRound();
  let marked: Array<number> = [];
  for (const [stop, seconds] of access) {
    round0.arrival[stop] = at + seconds;
    round0.kind[stop] = KIND_ACCESS;
    best[stop] = at + seconds;
    marked.push(stop);
  }
  rounds.push(round0);

  let bestTarget = Infinity;
  const journeys: Array<Journey> = [];
  const earliest = new Int32Array(index.patterns.length).fill(none);

  /** Earliest realized departure at `position` of `pattern` no earlier than `time`. */
  const earliestTrip = (pattern: Pattern, position: number, time: number) => {
    let bestDep = Infinity;
    let bestTrip = none;
    let bestDay = none;
    const list = pattern.trips;
    for (const day of candidateDays) {
      const anchor = days.anchors[day] ?? 0;
      const target = time - anchor - slack;
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const st = (trips.firstStopTime[list[mid] ?? 0] ?? 0) + position;
        if ((stopTimes.departure[st] ?? 0) < target) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < list.length; k++) {
        const trip = list[k] ?? 0;
        const st = (trips.firstStopTime[trip] ?? 0) + position;
        // Departures never run early, so a later schedule can't beat what we have.
        if (anchor + (stopTimes.departure[st] ?? 0) >= bestDep) break;
        if (!runsOn(timetable, trips.service[trip] ?? 0, day)) continue;
        if (((stopTimes.flags[st] ?? 0) & StopTimeFlag.noPickup) !== 0) continue;
        const departure = realization.departure(day, st);
        if (departure >= time && departure < bestDep) {
          bestDep = departure;
          bestTrip = trip;
          bestDay = day;
        }
      }
    }
    return { trip: bestTrip, day: bestDay, departure: bestDep };
  };

  for (let k = 1; k <= maxRides && marked.length > 0; k++) {
    const previous = rounds[k - 1];
    if (previous === undefined) break;
    const current = makeRound();
    rounds.push(current);

    const touched: Array<number> = [];
    for (const stop of marked) {
      const list = index.patternsOfStop[stop] ?? new Uint32Array();
      for (let j = 0; j < list.length; j += 2) {
        const p = list[j] ?? 0;
        const position = list[j + 1] ?? 0;
        const pattern = index.patterns[p];
        if (pattern === undefined || options.avoidLines?.has(pattern.line) === true) continue;
        const was = earliest[p] ?? none;
        if (was === none) touched.push(p);
        if (was === none || position < was) earliest[p] = position;
      }
    }

    const reached: Array<number> = [];
    for (const p of touched) {
      const pattern = index.patterns[p];
      const start = earliest[p] ?? 0;
      earliest[p] = none;
      if (pattern === undefined) continue;
      let trip = none;
      let day = none;
      let boardPos = none;
      for (let i = start; i < pattern.stops.length; i++) {
        const stop = pattern.stops[i] ?? 0;
        if (trip !== none) {
          const st = (trips.firstStopTime[trip] ?? 0) + i;
          const arrival = realization.arrival(day, st);
          if (
            ((stopTimes.flags[st] ?? 0) & StopTimeFlag.noDropOff) === 0 &&
            arrival < (best[stop] ?? Infinity) &&
            arrival < bestTarget
          ) {
            current.arrival[stop] = arrival;
            current.kind[stop] = KIND_RIDE;
            current.a[stop] = p;
            current.b[stop] = trip;
            current.c[stop] = day;
            current.d[stop] = boardPos;
            current.e[stop] = i;
            best[stop] = arrival;
            reached.push(stop);
          }
        }
        const ready = previous.arrival[stop] ?? Infinity;
        if (ready === Infinity) continue;
        const buffer = previous.kind[stop] === KIND_ACCESS ? 0 : options.transferBufferSec;
        const onBoard =
          trip === none
            ? Infinity
            : realization.departure(day, (trips.firstStopTime[trip] ?? 0) + i);
        if (ready + buffer >= onBoard) continue;
        const found = earliestTrip(pattern, i, ready + buffer);
        if (found.trip !== none && found.departure < onBoard) {
          trip = found.trip;
          day = found.day;
          boardPos = i;
        }
      }
    }

    // One footpath after each ride.
    const walked: Array<number> = [];
    for (const stop of reached) {
      const arrival = current.arrival[stop] ?? Infinity;
      const neighbors = index.neighbors[stop] ?? new Uint32Array(0);
      const meters = index.neighborMeters[stop];
      for (let k = 0; k < neighbors.length; k++) {
        const next = neighbors[k] ?? 0;
        const time = arrival + walking.secondsAlong(meters?.[k] ?? 0);
        if (time < (best[next] ?? Infinity) && time < bestTarget) {
          current.arrival[next] = time;
          current.kind[next] = KIND_WALK;
          current.a[next] = stop;
          best[next] = time;
          walked.push(next);
        }
      }
    }

    // The destination, from stops reached by a ride this round.
    let target = Infinity;
    let via = none;
    for (const [stop, seconds] of egress) {
      if (current.kind[stop] !== KIND_RIDE) continue;
      const time = (current.arrival[stop] ?? Infinity) + seconds;
      if (time < target) {
        target = time;
        via = stop;
      }
    }
    if (via !== none && target < bestTarget) {
      bestTarget = target;
      journeys.push(reconstruct(timetable, realization, rounds, k, via, target, access));
    }
    marked = [...new Set([...reached, ...walked])];
  }
  return journeys;
};

type Round = {
  readonly arrival: Float64Array;
  readonly kind: Int8Array;
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly c: Int32Array;
  readonly d: Int32Array;
  readonly e: Int32Array;
};

/**
 * Walks the labels back from the last stop. The journey leaves the origin as
 * late as still catches the first vehicle.
 */
const reconstruct = (
  timetable: Timetable,
  realization: Realization,
  rounds: ReadonlyArray<Round>,
  k: number,
  last: number,
  target: number,
  access: ReadonlyMap<number, number>,
): Journey => {
  const { trips } = timetable;
  const legs: Array<PlannedLeg> = [];
  const lastArrival = rounds[k]?.arrival[last] ?? 0;
  if (target > lastArrival) {
    legs.push({
      kind: "walk",
      fromStop: last,
      toStop: undefined,
      departAt: lastArrival,
      arriveAt: target,
    });
  }
  let stop = last;
  for (let r = k; r >= 1; r--) {
    const round = rounds[r];
    if (round === undefined) break;
    if (round.kind[stop] === KIND_WALK) {
      const from = round.a[stop] ?? 0;
      legs.push({
        kind: "walk",
        fromStop: from,
        toStop: stop,
        departAt: round.arrival[from] ?? 0,
        arriveAt: round.arrival[stop] ?? 0,
      });
      stop = from;
    }
    const trip = round.b[stop] ?? 0;
    const day = round.c[stop] ?? 0;
    const first = trips.firstStopTime[trip] ?? 0;
    const board = first + (round.d[stop] ?? 0);
    const alight = first + (round.e[stop] ?? 0);
    legs.push({
      kind: "ride",
      trip,
      day,
      line: trips.line[trip] ?? 0,
      board,
      alight,
      departAt: realization.departure(day, board),
      arriveAt: round.arrival[stop] ?? 0,
    });
    stop = timetable.stopTimes.stop[board] ?? 0;
  }
  legs.reverse();
  const firstRide = legs[0]?.departAt ?? target;
  const walk = access.get(stop) ?? 0;
  const departAt = firstRide - walk;
  if (walk > 0) {
    legs.unshift({
      kind: "walk",
      fromStop: undefined,
      toStop: stop,
      departAt,
      arriveAt: firstRide,
    });
  }
  return { departAt, arriveAt: target, legs, rides: k };
};

/** Walking straight there, when it's short enough to be an option. */
const walkOnly = (from: Endpoint, to: Endpoint, walking: WalkingModel, at: number) => {
  const seconds = walking.seconds(from.lat, from.lon, to.lat, to.lon);
  return {
    departAt: at,
    arriveAt: at + seconds,
    legs: [
      {
        kind: "walk" as const,
        fromStop: undefined,
        toStop: undefined,
        departAt: at,
        arriveAt: at + seconds,
      },
    ],
    rides: 0,
  };
};

/**
 * Several options leaving from `at` on: repeated RAPTOR runs, each starting
 * just after the previous options leave, with dominated ones removed (an
 * option is dominated by one leaving no earlier, arriving no later, with no
 * more vehicles).
 */
export const plan = (
  timetable: Timetable,
  index: PlanIndex,
  from: Endpoint,
  to: Endpoint,
  options: PlanOptions & {
    readonly count?: number;
    readonly maxWalkOnlySec?: number;
    /** What each extra vehicle must save to be worth listing, seconds. */
    readonly changePenaltySec?: number;
  },
): ReadonlyArray<Journey> => {
  const count = options.count ?? 6;
  const found: Array<Journey> = [];
  const walk = walkOnly(from, to, options.walking, options.at);
  if (walk.arriveAt - walk.departAt <= (options.maxWalkOnlySec ?? 40 * 60)) found.push(walk);

  let at = options.at;
  for (let run = 0; run < count + 2; run++) {
    const journeys = planOnce(timetable, index, from, to, { ...options, at });
    if (journeys.length === 0) break;
    found.push(...journeys);
    at = Math.min(...journeys.map((j) => j.departAt)) + 60;
    if (found.filter((j) => j.rides > 0).length >= count * 2) break;
  }

  const signature = (j: Journey) =>
    j.legs
      .map((leg) => (leg.kind === "ride" ? `${leg.trip}/${leg.day}/${leg.board}` : "w"))
      .join(" ");
  const unique = [...new Map(found.map((j) => [signature(j), j])).values()];
  const kept = unique.filter(
    (j) =>
      !unique.some(
        (o) =>
          o !== j &&
          o.departAt >= j.departAt &&
          o.arriveAt <= j.arriveAt &&
          o.rides <= j.rides &&
          (o.departAt > j.departAt || o.arriveAt < j.arriveAt || o.rides < j.rides),
      ),
  );
  // Extra vehicles must earn their keep: drop a journey when one with fewer rides, leaving at
  // most 10 min earlier, arrives less than `changePenaltySec` per extra ride later.
  const penalty = options.changePenaltySec ?? 180;
  const sensible = kept.filter(
    (j) =>
      !kept.some(
        (o) =>
          o.rides < j.rides &&
          o.departAt >= j.departAt - 600 &&
          o.arriveAt <= j.arriveAt + penalty * (j.rides - o.rides),
      ),
  );
  return sensible
    .sort((a, b) => a.departAt - b.departAt || a.arriveAt - b.arriveAt)
    .slice(0, count + 1);
};
