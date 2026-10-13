import {
  buildSearchIndex,
  departuresFromStops,
  nearbyGroups,
  search,
  type SearchIndex,
} from "@odjazd/engine";
import type { Vehicle } from "@odjazd/api";
import type { EpochSeconds, LineId } from "@odjazd/model";
import { liveRealization, type LiveDelay, type Realization } from "@odjazd/prediction";
import { instantOn, runsOn, type Timetable } from "@odjazd/timetable";
import type {
  LineLabel,
  LineRouteDto,
  LineRouteQuery,
  NearbyDto,
  NearbyQuery,
  SearchHitDto,
  SearchQuery,
  StopBoardDto,
  StopBoardQuery,
  StopGroupDto,
  StopsDto,
  TripDto,
  TripQuery,
} from "./schema.ts";

/*
 * Stop/line exploration and live delays over one timetable. Indexes are built
 * on first use: loading a city shouldn't pay for search until someone types.
 */
export const makeExplorer = (
  timetable: Timetable,
  base: Realization,
  label: (id: LineId) => LineLabel,
) => {
  const { trips, stopTimes, stops } = timetable;
  let index: SearchIndex | undefined;
  const searchIndex = () => (index ??= buildSearchIndex(timetable));

  let tripByFeedId: Map<string, number> | undefined;
  const tripOf = (feedId: string) => {
    tripByFeedId ??= new Map(trips.feedIds.map((id, i) => [id, i]));
    return tripByFeedId.get(feedId);
  };
  let stopByFeedId: Map<string, number> | undefined;
  const stopOf = (feedId: string) => {
    stopByFeedId ??= new Map(stops.feedIds.map((id, i) => [id, i]));
    return stopByFeedId.get(feedId);
  };

  const groupDto = (group: number): StopGroupDto => {
    const g = searchIndex().groups[group];
    return {
      group,
      name: g?.name ?? "?",
      lat: g?.lat ?? 0,
      lon: g?.lon ?? 0,
      lines: (g?.lines ?? []).map((line) => label(timetable.lines[line]?.id ?? ("?" as LineId))),
    };
  };

  // Live delays, replaced on every realtime update.
  let delays = new Map<number, LiveDelay>();
  let realization = base;
  const current = () => realization;

  /** The service day whose instance of `trip` is running (or nearest) at `at`. */
  const instanceDay = (trip: number, at: number): number | undefined => {
    const first = trips.firstStopTime[trip] ?? 0;
    const last = (trips.firstStopTime[trip + 1] ?? 1) - 1;
    let best: number | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let day = 0; day < timetable.days.count; day++) {
      if (!runsOn(timetable, trips.service[trip] ?? 0, day)) continue;
      const start = instantOn(timetable, day, stopTimes.departure[first] ?? 0);
      const end = instantOn(timetable, day, stopTimes.arrival[last] ?? 0);
      const gap = at < start ? start - at : at > end ? at - end : 0;
      if (gap < bestGap) {
        bestGap = gap;
        best = day;
      }
    }
    return bestGap <= 6 * 3600 ? best : undefined;
  };

  /** Stop time of `stopFeedId` within `trip`, nearest to the feed's sequence hint. */
  const stopTimeIn = (trip: number, stopFeedId: string | undefined, sequence?: number) => {
    const first = trips.firstStopTime[trip] ?? 0;
    const end = trips.firstStopTime[trip + 1] ?? 0;
    const stop = stopFeedId === undefined ? undefined : stopOf(stopFeedId);
    if (stop === undefined) {
      return sequence === undefined
        ? undefined
        : Math.min(end - 1, first + Math.max(0, sequence - 1));
    }
    const target = first + (sequence ?? 1) - 1;
    let best: number | undefined;
    for (let st = first; st < end; st++) {
      if (stopTimes.stop[st] !== stop) continue;
      if (best === undefined || Math.abs(st - target) < Math.abs(best - target)) best = st;
    }
    return best;
  };

  const setLive = (vehicles: ReadonlyArray<Vehicle>, now: number) => {
    const next = new Map<number, LiveDelay>();
    for (const vehicle of vehicles) {
      if (vehicle.trip === undefined || vehicle.delay === undefined) continue;
      // Far "early" reports are a vehicle matched to the wrong trip instance, not a fast tram.
      if (vehicle.delay < -600) continue;
      const trip = tripOf(vehicle.trip);
      if (trip === undefined) continue;
      const day = instanceDay(trip, now);
      if (day === undefined) continue;
      const fromStopTime =
        stopTimeIn(trip, vehicle.stop, vehicle.stopSequence) ?? trips.firstStopTime[trip] ?? 0;
      next.set(trip, { trip, day, fromStopTime, delay: vehicle.delay });
    }
    delays = next;
    realization = next.size === 0 ? base : liveRealization(timetable, base, next);
  };

  const searchStops = (query: SearchQuery): ReadonlyArray<SearchHitDto> =>
    search(timetable, searchIndex(), query.text, query.limit, query.near).map((hit) => {
      if (hit.kind === "stop") return { _tag: "Stop", stop: groupDto(hit.group) };
      const line = timetable.lines[hit.line];
      const headsigns = new Map<string, number>();
      for (let trip = 0; trip < trips.count; trip++) {
        if (trips.line[trip] !== hit.line) continue;
        const h = trips.headsigns[trip] ?? "";
        headsigns.set(h, (headsigns.get(h) ?? 0) + 1);
      }
      return {
        _tag: "Line",
        line: label(line?.id ?? ("?" as LineId)),
        headsigns: [...headsigns]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([h]) => h)
          .filter((h) => h !== ""),
      };
    });

  const allStops = (): StopsDto => {
    const { groups } = searchIndex();
    return {
      names: groups.map((g) => g.name),
      lat: groups.map((g) => Math.round(g.lat * 1e6) / 1e6),
      lon: groups.map((g) => Math.round(g.lon * 1e6) / 1e6),
      modes: groups.map((g) =>
        g.lines.reduce((bits, line) => bits | (timetable.lines[line]?.mode === "tram" ? 1 : 2), 0),
      ),
    };
  };

  const nearby = (query: NearbyQuery): NearbyDto =>
    nearbyGroups(searchIndex(), query.lat, query.lon, query.radiusMeters, query.limit).map(
      (hit) => ({ stop: groupDto(hit.group), distanceMeters: Math.round(hit.distanceMeters) }),
    );

  const stopBoard = (query: StopBoardQuery): StopBoardDto => {
    const group = searchIndex().groups[query.group];
    const members = group?.stops ?? [];
    const departures = departuresFromStops(
      timetable,
      realization,
      members,
      // Include just-missed departures of late vehicles.
      (query.at - 120) as EpochSeconds,
      query.horizonMinutes * 60 + 120,
      query.limit + 20,
    )
      .filter((departure) => departure.departAt >= query.at - 30)
      .slice(0, query.limit);
    return {
      stop: groupDto(query.group),
      platforms: members.map((stop, platform) => ({
        platform,
        lat: stops.lat[stop] ?? 0,
        lon: stops.lon[stop] ?? 0,
      })),
      departures: departures.map((departure) => {
        const live = delays.get(departure.trip);
        const isLive = live !== undefined && live.day === departure.day;
        return {
          ...label(departure.line),
          headsign: departure.headsign,
          stop: stops.names[departure.stop] ?? "?",
          platform: members.indexOf(departure.stop),
          departAt: departure.departAt,
          scheduledAt: departure.scheduledAt,
          ...(isLive ? { delay: live.delay } : {}),
          trip: departure.tripFeedId,
        };
      }),
    };
  };

  const routeStop = (stop: number) => {
    const { groupOfStop, groups } = searchIndex();
    const group = groupOfStop[stop] ?? 0;
    return {
      group,
      name: groups[group]?.name ?? stops.names[stop] ?? "?",
      lat: stops.lat[stop] ?? 0,
      lon: stops.lon[stop] ?? 0,
    };
  };

  const lineRoute = (query: LineRouteQuery): LineRouteDto | undefined => {
    const lineIndex = timetable.lines.findIndex((line) => line.id === query.line);
    if (lineIndex < 0) return undefined;
    // Most frequent stop pattern per direction.
    const patterns = new Map<
      string,
      { direction: number; trips: number; trip: number; headsign: string }
    >();
    for (let trip = 0; trip < trips.count; trip++) {
      if (trips.line[trip] !== lineIndex) continue;
      const first = trips.firstStopTime[trip] ?? 0;
      const end = trips.firstStopTime[trip + 1] ?? 0;
      const key = Array.from(stopTimes.stop.subarray(first, end)).join(",");
      const seen = patterns.get(key);
      if (seen === undefined) {
        patterns.set(key, {
          direction: trips.direction[trip] ?? -1,
          trips: 1,
          trip,
          headsign: trips.headsigns[trip] ?? "",
        });
      } else {
        patterns.set(key, { ...seen, trips: seen.trips + 1 });
      }
    }
    const best = new Map<number, { trips: number; trip: number; headsign: string }>();
    for (const pattern of patterns.values()) {
      const top = best.get(pattern.direction);
      if (top === undefined || pattern.trips > top.trips) best.set(pattern.direction, pattern);
    }
    return {
      line: label(query.line as LineId),
      directions: [...best.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, pattern]) => {
          const first = trips.firstStopTime[pattern.trip] ?? 0;
          const end = trips.firstStopTime[pattern.trip + 1] ?? 0;
          return {
            headsign: pattern.headsign,
            trips: pattern.trips,
            stops: Array.from(stopTimes.stop.subarray(first, end), routeStop),
          };
        }),
    };
  };

  const trip = (query: TripQuery): TripDto | undefined => {
    const index = tripOf(query.trip);
    if (index === undefined) return undefined;
    const day = instanceDay(index, query.at);
    if (day === undefined) return undefined;
    const first = trips.firstStopTime[index] ?? 0;
    const end = trips.firstStopTime[index + 1] ?? 0;
    const live = delays.get(index);
    const applies = live !== undefined && live.day === day;
    const result: Array<TripDto["stops"][number]> = [];
    for (let st = first; st < end; st++) {
      result.push({
        ...routeStop(stopTimes.stop[st] ?? 0),
        sequence: st - first,
        scheduledAt: instantOn(timetable, day, stopTimes.departure[st] ?? 0),
        expectedAt: realization.departure(day, st),
      });
    }
    return {
      line: label(timetable.lines[trips.line[index] ?? 0]?.id ?? ("?" as LineId)),
      headsign: trips.headsigns[index] ?? "",
      stops: result,
      ...(applies ? { delay: live.delay, fromSequence: live.fromStopTime - first } : {}),
    };
  };

  /** The live delay of a trip instance at a stop time, if one is reported and applies. */
  const delayAt = (trip: number, day: number, stopTime: number): number | undefined => {
    const live = delays.get(trip);
    return live !== undefined && live.day === day && stopTime >= live.fromStopTime
      ? live.delay
      : undefined;
  };

  return {
    current,
    setLive,
    delayAt,
    searchIndex,
    searchStops,
    allStops,
    nearby,
    stopBoard,
    lineRoute,
    trip,
  };
};
