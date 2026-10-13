import {
  buildPlanIndex,
  type Endpoint,
  plan,
  type PlanIndex,
  type SearchIndex,
} from "@odjazd/engine";
import { distanceMeters, type LineId, type LineRef, lineRefMatches } from "@odjazd/model";
import { type Realization, straightLineWalking } from "@odjazd/prediction";
import { instantOn, type Timetable } from "@odjazd/timetable";
import type {
  JourneyDto,
  LineLabel,
  PlanDto,
  PlanEndpoint,
  PlanLegDto,
  PlanQuery,
} from "./schema.ts";

/** Point-to-point trips over one timetable, with live delays. Indexed on first use. */
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

  const endpoint = (e: PlanEndpoint): Endpoint => {
    const group = e.group === undefined ? undefined : context.searchIndex().groups[e.group];
    return group === undefined
      ? { lat: e.lat, lon: e.lon }
      : { lat: e.lat, lon: e.lon, stops: group.stops };
  };
  const point = (stop: number) => ({ lat: stops.lat[stop] ?? 0, lon: stops.lon[stop] ?? 0 });

  const run = (query: PlanQuery): PlanDto => {
    const linesMatching = (refs: ReadonlyArray<LineRef>) =>
      new Set(
        lines.flatMap((line, i) => (refs.some((ref) => lineRefMatches(ref, line.id)) ? [i] : [])),
      );
    const avoid = linesMatching(query.avoidLines);
    const prefer = linesMatching(query.preferLines);
    const from = endpoint(query.from);
    const to = endpoint(query.to);
    const journeys = plan(timetable, planIndex(), from, to, {
      realization: context.current(),
      walking: straightLineWalking({ speedKmh: query.walkingSpeedKmh }),
      at: query.at,
      transferBufferSec: query.transferBufferSec,
      avoidLines: avoid,
      count: query.count,
    });

    const dto = journeys.map(
      (journey): { journey: JourneyDto; effective: number; rides: number } => {
        let walkMeters = 0;
        let live = false;
        let unpreferred = 0;
        const legs = journey.legs.map((leg, i): PlanLegDto => {
          if (leg.kind === "walk") {
            const start = leg.fromStop === undefined ? (i === 0 ? from : to) : point(leg.fromStop);
            const end = leg.toStop === undefined ? to : point(leg.toStop);
            const meters = Math.round(distanceMeters(start.lat, start.lon, end.lat, end.lon) * 1.3);
            walkMeters += meters;
            return {
              _tag: "Walk",
              ...(leg.fromStop === undefined ? {} : { from: stops.names[leg.fromStop] ?? "?" }),
              ...(leg.toStop === undefined ? {} : { to: stops.names[leg.toStop] ?? "?" }),
              departAt: leg.departAt,
              arriveAt: leg.arriveAt,
              meters,
              path: [
                { lat: start.lat, lon: start.lon },
                { lat: end.lat, lon: end.lon },
              ],
            };
          }
          const delay = context.delayAt(leg.trip, leg.day, leg.board);
          if (delay !== undefined) live = true;
          const preferred = prefer.has(leg.line);
          if (!preferred) unpreferred++;
          const boardStop = stopTimes.stop[leg.board] ?? 0;
          const path: Array<{ lat: number; lon: number }> = [];
          for (let st = leg.board; st <= leg.alight; st++)
            path.push(point(stopTimes.stop[st] ?? 0));
          return {
            _tag: "Ride",
            line: context.label(lines[leg.line]?.id ?? ("?" as LineId)),
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
            preferred,
            path,
          };
        });
        return {
          journey: {
            departAt: journey.departAt,
            arriveAt: journey.arriveAt,
            rides: journey.rides,
            walkMeters,
            live,
            legs,
          },
          rides: journey.rides,
          effective:
            journey.arriveAt + (prefer.size === 0 ? 0 : unpreferred * query.preferencePenaltySec),
        };
      },
    );
    return { journeys: dto.map((entry) => entry.journey), ...recommend(dto) };
  };

  return { plan: run };
};

/** The option to suggest: earliest arrival, counting non-preferred lines as later. */
const recommend = (
  journeys: ReadonlyArray<{ readonly effective: number; readonly rides: number }>,
) => {
  let best: number | undefined;
  journeys.forEach((journey, i) => {
    const current = best === undefined ? undefined : journeys[best];
    if (
      current === undefined ||
      journey.effective < current.effective ||
      (journey.effective === current.effective && journey.rides < current.rides)
    ) {
      best = i;
    }
  });
  return best === undefined ? {} : { recommended: best };
};
