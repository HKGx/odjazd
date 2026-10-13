import { distanceMeters } from "@odjazd/model";
import type { Timetable } from "@odjazd/timetable";

/*
 * Stop groups and text search. A group is the set of platforms riders call by
 * one name: same (normalized) name, within `maxSpreadMeters` of each other.
 * Feeds without parent stations (Łódź) need this to make "pl. Niepodległości"
 * one search hit instead of seven.
 */

export interface StopGroup {
  readonly name: string;
  /** Stop indexes, sorted. */
  readonly stops: ReadonlyArray<number>;
  readonly lat: number;
  readonly lon: number;
  /** Line indexes serving any stop of the group, sorted by mode then label. */
  readonly lines: ReadonlyArray<number>;
}

export interface SearchIndex {
  readonly groups: ReadonlyArray<StopGroup>;
  /** Group index of each stop. */
  readonly groupOfStop: Uint32Array;
  /** Line indexes serving each stop. */
  readonly linesOfStop: ReadonlyArray<ReadonlyArray<number>>;
}

/** Lowercase, no diacritics (ł → l too), punctuation as spaces. */
export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll("ł", "l")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const lineLabel = (timetable: Timetable, line: number) => {
  const id = timetable.lines[line]?.id ?? "";
  const short = id.split("@")[0] ?? id;
  return short.slice(short.indexOf(":") + 1);
};

/** Natural order for line labels: 2 < 10 < 10A < N1. */
export const compareLabels = (a: string, b: string): number =>
  a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

export const buildSearchIndex = (timetable: Timetable, maxSpreadMeters = 400): SearchIndex => {
  const { stops, trips, stopTimes } = timetable;

  const lineSets = Array.from({ length: stops.count }, () => new Set<number>());
  for (let trip = 0; trip < trips.count; trip++) {
    const line = trips.line[trip] ?? 0;
    const first = trips.firstStopTime[trip] ?? 0;
    const last = trips.firstStopTime[trip + 1] ?? 0;
    for (let st = first; st < last; st++) lineSets[stopTimes.stop[st] ?? 0]?.add(line);
  }
  const modeOrder = (line: number) => (timetable.lines[line]?.mode === "tram" ? 0 : 1);
  const sortLines = (lines: Iterable<number>) =>
    [...lines].sort(
      (a, b) =>
        modeOrder(a) - modeOrder(b) ||
        compareLabels(lineLabel(timetable, a), lineLabel(timetable, b)),
    );
  const linesOfStop = lineSets.map((set) => sortLines(set));

  const byName = new Map<string, Array<number>>();
  for (let stop = 0; stop < stops.count; stop++) {
    const key = normalize(stops.names[stop] ?? "");
    const list = byName.get(key);
    if (list === undefined) byName.set(key, [stop]);
    else list.push(stop);
  }

  const groups: Array<StopGroup> = [];
  const groupOfStop = new Uint32Array(stops.count);
  for (const members of byName.values()) {
    const clusters: Array<{ stops: Array<number>; lat: number; lon: number }> = [];
    for (const stop of members) {
      const lat = stops.lat[stop] ?? 0;
      const lon = stops.lon[stop] ?? 0;
      const near = clusters.find(
        (cluster) => distanceMeters(cluster.lat, cluster.lon, lat, lon) <= maxSpreadMeters,
      );
      if (near === undefined) {
        clusters.push({ stops: [stop], lat, lon });
      } else {
        near.stops.push(stop);
        const n = near.stops.length;
        near.lat += (lat - near.lat) / n;
        near.lon += (lon - near.lon) / n;
      }
    }
    for (const cluster of clusters) {
      const index = groups.length;
      const lines = new Set<number>();
      for (const stop of cluster.stops) {
        groupOfStop[stop] = index;
        for (const line of linesOfStop[stop] ?? []) lines.add(line);
      }
      groups.push({
        name: stops.names[cluster.stops[0] ?? 0] ?? "",
        stops: cluster.stops.sort((a, b) => a - b),
        lat: cluster.lat,
        lon: cluster.lon,
        lines: sortLines(lines),
      });
    }
  }
  return { groups, groupOfStop, linesOfStop };
};

export type SearchHit =
  | { readonly kind: "stop"; readonly group: number; readonly score: number }
  | { readonly kind: "line"; readonly line: number; readonly score: number };

/**
 * Stops whose name contains every query word as a word prefix, and lines
 * whose label starts with the query. Best first: exact > starts with > word
 * prefix; busier stops break ties; `near` (if given) favors closer stops.
 */
export const search = (
  timetable: Timetable,
  index: SearchIndex,
  query: string,
  limit: number,
  near?: { readonly lat: number; readonly lon: number },
): ReadonlyArray<SearchHit> => {
  const q = normalize(query);
  if (q === "") return [];
  const words = q.split(" ");
  const hits: Array<SearchHit> = [];

  const compact = q.replaceAll(" ", "");
  if (compact.length <= 4) {
    timetable.lines.forEach((_, line) => {
      const label = normalize(lineLabel(timetable, line));
      if (label === compact) hits.push({ kind: "line", line, score: 100 });
      else if (label.startsWith(compact))
        hits.push({ kind: "line", line, score: 60 - label.length });
    });
  }

  index.groups.forEach((group, i) => {
    const name = normalize(group.name);
    const tokens = name.split(" ");
    if (!words.every((word) => tokens.some((token) => token.startsWith(word)))) return;
    let score = name === q ? 90 : name.startsWith(q) ? 70 : 40;
    score += Math.min(24, group.lines.length) / 2;
    if (near !== undefined) {
      const km = distanceMeters(near.lat, near.lon, group.lat, group.lon) / 1000;
      score += Math.max(0, 10 - km);
    }
    hits.push({ kind: "stop", group: i, score });
  });

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
};

/** Stop groups within `radiusMeters` of a point, nearest first. */
export const nearbyGroups = (
  index: SearchIndex,
  lat: number,
  lon: number,
  radiusMeters: number,
  limit: number,
): ReadonlyArray<{ readonly group: number; readonly distanceMeters: number }> =>
  index.groups
    .map((group, i) => ({
      group: i,
      distanceMeters: distanceMeters(lat, lon, group.lat, group.lon),
    }))
    .filter((hit) => hit.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
