import {
  buildPlanIndex,
  chainOf,
  type Endpoint,
  type EvaluationOptions,
  type Journey,
  matchRoutes,
  plan,
  type PlanIndex,
  type RouteMatch,
  type RouteOption,
  routeOptions,
  type SearchIndex,
  sectionLines,
  sectionOptions,
} from "@odjazd/engine";
import {
  AreaSlug,
  distanceMeters,
  type EpochSeconds,
  type InterchangeArea,
  type LatLon,
  type LegRule,
  type LineId,
  lineRefMatches,
} from "@odjazd/model";
import { type Realization, straightLineWalking } from "@odjazd/prediction";
import { instantOn, type Timetable } from "@odjazd/timetable";
import type {
  JourneyDto,
  LineLabel,
  PlanDto,
  PlanEndpoint,
  PlanLegDto,
  PlanQuery,
  RouteNowQuery,
  SectionDto,
  SectionLinesDto,
  SectionLinesQuery,
  SectionQuery,
  SectionRef,
} from "./schema.ts";

type Ride = Extract<PlanLegDto, { _tag: "Ride" }>;

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

/**
 * Point-to-point trips over one timetable with live delays: the user's own
 * routes where they fit, plus whatever else gets there, each explained.
 */
export const makePlanner = (
  timetable: Timetable,
  context: {
    readonly current: () => Realization;
    readonly delayAt: (trip: number, day: number, stopTime: number) => number | undefined;
    readonly searchIndex: () => SearchIndex;
    readonly label: (id: LineId) => LineLabel;
  },
) => {
  const { stops, stopTimes, trips, lines } = timetable;
  let index: PlanIndex | undefined;
  const planIndex = () => (index ??= buildPlanIndex(timetable));
  const point = (stop: number): LatLon => ({
    lat: stops.lat[stop] ?? 0,
    lon: stops.lon[stop] ?? 0,
  });
  const lineLabel = (line: number) => context.label(lines[line]?.id ?? ("?" as LineId));

  const endpoint = (e: PlanEndpoint): Endpoint => {
    const group = e.group === undefined ? undefined : context.searchIndex().groups[e.group];
    return group === undefined
      ? { lat: e.lat, lon: e.lon }
      : { lat: e.lat, lon: e.lon, stops: group.stops };
  };

  /** A stop group as an ad-hoc interchange area: its platforms plus a short walk. */
  const groupArea = (stop: number): InterchangeArea => {
    const { groups, groupOfStop } = context.searchIndex();
    const id = groupOfStop[stop] ?? 0;
    const group = groups[id];
    const center = group === undefined ? point(stop) : { lat: group.lat, lon: group.lon };
    const spread = Math.max(
      0,
      ...(group?.stops ?? [stop]).map((s) =>
        distanceMeters(center.lat, center.lon, stops.lat[s] ?? 0, stops.lon[s] ?? 0),
      ),
    );
    return {
      slug: AreaSlug.make(`stop-${id}`),
      cityId: timetable.cityId,
      name: group?.name ?? stops.names[stop] ?? "?",
      center,
      radiusMeters: Math.round(Math.min(400, Math.max(120, spread + 60))),
    };
  };

  const rideDto = (
    leg: {
      readonly trip: number;
      readonly day: number;
      readonly board: number;
      readonly alight: number;
      readonly departAt: number;
      readonly arriveAt: number;
    },
    section: SectionRef,
    stayAboard: boolean,
  ): Ride => {
    const line = trips.line[leg.trip] ?? 0;
    const boardStop = stopTimes.stop[leg.board] ?? 0;
    const delay = context.delayAt(leg.trip, leg.day, leg.board);
    const path: Array<LatLon> = [];
    for (let st = leg.board; st <= leg.alight; st++) path.push(point(stopTimes.stop[st] ?? 0));
    const id = lines[line]?.id ?? ("?" as LineId);
    return {
      _tag: "Ride",
      line: lineLabel(line),
      headsign: trips.headsigns[leg.trip] ?? "",
      trip: trips.feedIds[leg.trip] ?? "",
      from: stops.names[boardStop] ?? "?",
      to: stops.names[stopTimes.stop[leg.alight] ?? 0] ?? "?",
      fromGroup: context.searchIndex().groupOfStop[boardStop] ?? 0,
      departAt: leg.departAt,
      arriveAt: leg.arriveAt,
      scheduledDepartAt: instantOn(timetable, leg.day, stopTimes.departure[leg.board] ?? 0),
      scheduledArriveAt: instantOn(timetable, leg.day, stopTimes.arrival[leg.alight] ?? 0),
      ...(delay === undefined ? {} : { delay }),
      stops: leg.alight - leg.board,
      preferred: (section.rule.prefer ?? []).some((ref) => lineRefMatches(ref, id)),
      stayAboard,
      section,
      path,
    };
  };

  const walkDto = (
    from: LatLon,
    to: LatLon,
    departAt: number,
    arriveAt: number,
    names: { readonly from?: string | undefined; readonly to?: string | undefined },
  ): PlanLegDto => ({
    _tag: "Walk",
    ...(names.from === undefined ? {} : { from: names.from }),
    ...(names.to === undefined ? {} : { to: names.to }),
    departAt,
    arriveAt,
    meters: Math.round(distanceMeters(from.lat, from.lon, to.lat, to.lon) * 1.3),
    path: [from, to],
  });

  const summarize = (legs: ReadonlyArray<PlanLegDto>) => ({
    walkMeters: legs.reduce((sum, leg) => sum + (leg._tag === "Walk" ? leg.meters : 0), 0),
    live: legs.some((leg) => leg._tag === "Ride" && leg.delay !== undefined),
  });

  /** A RAPTOR journey; each ride's section runs between the stop groups it uses. */
  const directDto = (journey: Journey, from: LatLon, to: LatLon): JourneyDto => {
    const legs = journey.legs.map((leg, i): PlanLegDto => {
      if (leg.kind === "walk") {
        const start = leg.fromStop === undefined ? (i === 0 ? from : to) : point(leg.fromStop);
        const end = leg.toStop === undefined ? to : point(leg.toStop);
        return walkDto(start, end, leg.departAt, leg.arriveAt, {
          from: leg.fromStop === undefined ? undefined : stops.names[leg.fromStop],
          to: leg.toStop === undefined ? undefined : stops.names[leg.toStop],
        });
      }
      const fromArea = groupArea(stopTimes.stop[leg.board] ?? 0);
      const toArea = groupArea(stopTimes.stop[leg.alight] ?? 0);
      return rideDto(
        leg,
        { from: fromArea, to: toArea, rule: { from: fromArea.slug, to: toArea.slug, allow: {} } },
        false,
      );
    });
    return {
      departAt: journey.departAt,
      arriveAt: journey.arriveAt,
      rides: journey.rides,
      legs,
      ...summarize(legs),
      reasons: [],
    };
  };

  /** A journey that follows a route: walk to each area's boarding stop, ride the section. */
  const routeDto = (
    option: RouteOption,
    areas: ReadonlyMap<string, InterchangeArea>,
    from: LatLon,
    to: LatLon,
  ): JourneyDto => {
    const { match } = option;
    const legs: Array<PlanLegDto> = [];
    let at: LatLon = from;
    let atName: string | undefined;
    let ready: number = option.departAt;
    option.legs.forEach((result, i) => {
      const rule = match.used.legs[i] as LegRule;
      const board = point(result.boardStop);
      if (!result.stayedAboard && result.walkSec >= 30) {
        legs.push(
          walkDto(at, board, ready, ready + result.walkSec, {
            from: atName,
            to: stops.names[result.boardStop],
          }),
        );
      }
      const section = {
        from: areas.get(rule.from) as InterchangeArea,
        to: areas.get(rule.to) as InterchangeArea,
        rule,
      };
      legs.push(rideDto(result, section, result.stayedAboard));
      at = point(result.alightStop);
      atName = stops.names[result.alightStop];
      ready = result.arriveAt;
    });
    if (option.arriveAt - ready >= 30) {
      legs.push(walkDto(at, to, ready, option.arriveAt, { from: atName }));
    }
    const chain = chainOf(match.used);
    return {
      departAt: option.departAt,
      arriveAt: option.arriveAt,
      rides: legs.filter((leg) => leg._tag === "Ride" && !leg.stayAboard).length,
      legs,
      ...summarize(legs),
      route: {
        slug: match.corridor.slug,
        name: match.corridor.name,
        partial: match.toLeg - match.fromLeg < match.corridor.legs.length,
        via: chain.map((slug) => areas.get(slug)?.name ?? slug),
      },
      reasons: [],
    };
  };

  const evaluation = (query: {
    readonly walkingSpeedKmh: number;
    readonly transferBufferSec: number;
    readonly preferencePenaltySec: number;
  }): EvaluationOptions => ({
    timetable,
    realization: context.current(),
    walking: straightLineWalking({ speedKmh: query.walkingSpeedKmh }),
    transferBufferSec: query.transferBufferSec,
    nonPreferredPenaltySec: query.preferencePenaltySec,
    maxWaitSec: 3600,
  });

  const signature = (journey: JourneyDto) =>
    journey.legs
      .filter((leg): leg is Ride => leg._tag === "Ride")
      .map((ride) => `${ride.trip}@${ride.departAt}`)
      .join(" ");

  const run = (query: PlanQuery): PlanDto => {
    const options = evaluation(query);
    const from = endpoint(query.from);
    const to = endpoint(query.to);
    const areas = new Map(query.areas.map((area) => [area.slug as string, area]));

    // The user's routes first: they're the point.
    const notes: Array<string> = [];
    const matches = matchRoutes(query.corridors, query.areas, from, to, options.walking, 15 * 60);
    const routed: Array<JourneyDto> = [];
    for (const match of matches) {
      const found = routeOptions(
        options,
        match,
        query.areas,
        from,
        to,
        query.at as EpochSeconds,
        3,
      );
      if (found.length === 0) {
        notes.push(
          `Your route “${match.corridor.name}”: nothing suitable runs in the next 2 hours.`,
        );
      }
      routed.push(...found.map((option) => routeDto(option, areas, from, to)));
    }
    if (query.corridors.length === 0) {
      notes.push("Save a route (Places → Routes) and it will be suggested here when it fits.");
    } else if (matches.length === 0) {
      notes.push("None of your routes start and end near this trip.");
    }

    const direct = plan(timetable, planIndex(), from, to, {
      realization: options.realization,
      walking: options.walking,
      at: query.at,
      transferBufferSec: query.transferBufferSec,
      count: query.count,
    }).map((journey) => directDto(journey, from, to));

    // Leaving no sooner and arriving no later on the same route makes an option pointless.
    const useful = routed.filter(
      (j) =>
        !routed.some(
          (k) =>
            k !== j &&
            k.route?.slug === j.route?.slug &&
            k.departAt >= j.departAt &&
            k.arriveAt <= j.arriveAt &&
            (k.departAt > j.departAt || k.arriveAt < j.arriveAt),
        ),
    );
    // The same vehicles are the same option, whichever route or search found them first.
    const seen = new Set<string>();
    const unique = (j: JourneyDto) => {
      const key = signature(j);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    const journeys = [...useful.filter(unique), ...direct.filter(unique)].sort(
      (a, b) => a.departAt - b.departAt || a.arriveAt - b.arriveAt,
    );
    return { ...explain(journeys, query.routeToleranceSec), notes };
  };

  const section = (query: SectionQuery): SectionDto => {
    const walking = straightLineWalking({ speedKmh: query.walkingSpeedKmh });
    const found = sectionOptions(
      timetable,
      context.current(),
      walking,
      query.section.rule,
      query.section.from,
      query.section.to,
      query.position,
      query.ready,
      query.bufferSec,
    );
    return found.map((entry) => {
      const line = context.label(entry.line);
      return {
        line,
        preferred: entry.preferred,
        departures: entry.departures.map((d) => {
          const delay = context.delayAt(d.trip, d.day, d.board);
          return {
            trip: trips.feedIds[d.trip] ?? "",
            from: stops.names[stopTimes.stop[d.board] ?? 0] ?? "?",
            to: stops.names[stopTimes.stop[d.alight] ?? 0] ?? "?",
            departAt: d.departAt,
            arriveAt: d.arriveAt,
            scheduledDepartAt: instantOn(timetable, d.day, stopTimes.departure[d.board] ?? 0),
            ...(delay === undefined ? {} : { delay }),
          };
        }),
      };
    });
  };

  const lineSummary = (query: SectionLinesQuery): SectionLinesDto =>
    sectionLines(
      timetable,
      context.current(),
      query.from,
      query.to,
      query.at as EpochSeconds,
      (query.at + 86_400) as EpochSeconds,
    ).map((entry) => ({
      line: context.label(entry.line),
      trips: entry.trips,
      rideSec: entry.rideSec,
    }));

  /** A route followed end to end from its first area's center: the editor's preview. */
  const routeNow = (query: RouteNowQuery): ReadonlyArray<JourneyDto> => {
    const options = evaluation(query);
    const areas = new Map(query.areas.map((area) => [area.slug as string, area]));
    const chain = chainOf(query.corridor);
    const first = areas.get(chain[0] ?? "");
    const last = areas.get(chain[chain.length - 1] ?? "");
    if (first === undefined || last === undefined) return [];
    const match: RouteMatch = {
      corridor: query.corridor,
      used: query.corridor,
      fromLeg: 0,
      toLeg: query.corridor.legs.length,
      accessSec: 0,
      egressSec: 0,
    };
    return routeOptions(
      options,
      match,
      query.areas,
      first.center,
      last.center,
      query.at as EpochSeconds,
      query.count,
    ).map((option) => routeDto(option, areas, first.center, last.center));
  };

  return { plan: run, section, sectionLines: lineSummary, routeNow };
};

/**
 * Tags each journey with what sets it apart and picks one to suggest: the
 * best option on one of the user's routes if it's within `toleranceSec` of
 * the fastest arrival, otherwise the fastest (fewer changes on a tie).
 */
const explain = (
  journeys: ReadonlyArray<JourneyDto>,
  toleranceSec: number,
): Omit<PlanDto, "notes"> => {
  if (journeys.length === 0) return { journeys };
  const fastest = Math.min(...journeys.map((j) => j.arriveAt));
  const soonest = Math.min(...journeys.map((j) => j.departAt));
  const close = journeys.filter((j) => j.arriveAt - fastest <= 5 * 60);
  const fewest = Math.min(...close.map((j) => j.rides));
  const leastWalk = Math.min(...close.map((j) => j.walkMeters));

  const tagged = journeys.map((journey): JourneyDto => {
    const reasons: Array<string> = [];
    if (journey.route !== undefined) {
      reasons.push(
        journey.route.partial
          ? `Your route “${journey.route.name}” (${journey.route.via[0]} → ${journey.route.via[journey.route.via.length - 1]})`
          : `Your route “${journey.route.name}”`,
      );
    }
    const late = journey.arriveAt - fastest;
    reasons.push(late < 60 ? "Fastest arrival" : `${minutes(late)} min after the fastest`);
    if (journey.departAt === soonest) reasons.push("Leaves soonest");
    if (
      close.includes(journey) &&
      journey.rides === fewest &&
      close.some((j) => j.rides > fewest)
    ) {
      reasons.push(journey.rides <= 1 ? "No change" : "Fewest changes");
    }
    if (close.includes(journey) && journey.walkMeters === leastWalk && close.length > 1) {
      reasons.push("Least walking");
    }
    if (journey.live) reasons.push("Live delays included");
    return { ...journey, reasons };
  });

  const byArrival = (a: JourneyDto, b: JourneyDto) =>
    a.arriveAt - b.arriveAt || a.rides - b.rides || a.walkMeters - b.walkMeters;
  const bestOverall = [...tagged].sort(byArrival)[0] as JourneyDto;
  const bestRoute = tagged.filter((j) => j.route !== undefined).sort(byArrival)[0];

  let pick = bestOverall;
  let why: string;
  if (bestRoute !== undefined && bestRoute.arriveAt - bestOverall.arriveAt <= toleranceSec) {
    pick = bestRoute;
    const late = bestRoute.arriveAt - bestOverall.arriveAt;
    why =
      late < 60
        ? `Follows your route “${bestRoute.route?.name ?? ""}” and is also the fastest.`
        : `Follows your route “${bestRoute.route?.name ?? ""}”; only ${minutes(late)} min slower than the fastest option, within your ${minutes(toleranceSec)} min tolerance.`;
  } else if (bestRoute !== undefined) {
    why = `Fastest. Your route “${bestRoute.route?.name ?? ""}” would arrive ${minutes(bestRoute.arriveAt - bestOverall.arriveAt)} min later, more than your ${minutes(toleranceSec)} min tolerance.`;
  } else {
    why =
      bestOverall.rides <= 1 ? "Fastest, and no change needed." : "Fastest arrival of the options.";
  }
  return { journeys: tagged, recommended: tagged.indexOf(pick), why };
};
