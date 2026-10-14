import { type BoundingBox, type CityId, distanceMeters } from "@odjazd/model";
import type { WalkGraph } from "@odjazd/walk";
import { simplify } from "../shapes.ts";
import { OsmFormatError, readOsmPbf } from "./pbf.ts";

const walkableHighways = new Set([
  "footway",
  "pedestrian",
  "path",
  "steps",
  "living_street",
  "residential",
  "service",
  "unclassified",
  "road",
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "primary",
  "primary_link",
  "trunk",
  "trunk_link",
  "track",
  "cycleway",
  "corridor",
  "platform",
]);
const yes = new Set(["yes", "designated", "permissive"]);

/** Whether a way's tags make it walkable: OSM's usual foot defaults, conservatively. */
export const isWalkable = (tag: (key: string) => string | undefined): boolean => {
  const highway = tag("highway");
  if (highway === undefined || !walkableHighways.has(highway)) return false;
  const foot = tag("foot");
  if (foot === "no" || foot === "private" || foot === "use_sidepath") return false;
  const access = tag("access");
  if ((access === "no" || access === "private") && !yes.has(foot ?? "")) return false;
  if (tag("motorroad") === "yes" && !yes.has(foot ?? "")) return false;
  // Trunk roads are walkable only where it says so (or there's a sidewalk).
  if (highway === "trunk" || highway === "trunk_link") {
    const sidewalk = tag("sidewalk");
    return (
      yes.has(foot ?? "") || (sidewalk !== undefined && sidewalk !== "no" && sidewalk !== "none")
    );
  }
  return true;
};

/** Pieces of the network whose streets add up to less than this connect to nothing useful. */
const minComponentMeters = 500;
/** Shape points closer than this to the simplified line are dropped. */
const toleranceMeters = 2;

class Growable<T extends Float64Array | Int32Array> {
  length = 0;
  data: T;
  constructor(data: T) {
    this.data = data;
  }
  push(value: number) {
    if (this.length === this.data.length) {
      const grown = new (this.data.constructor as new (n: number) => T)(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = value;
  }
  get view(): T {
    return this.data.subarray(0, this.length) as T;
  }
}

/**
 * The walkable network inside `bbox` from an OSM extract: two passes are
 * avoided by keeping every node inside the box (files list nodes first, sorted
 * by id), then cutting ways into pieces wherever they leave it.
 */
export const walkGraphFromPbf = async (
  chunks: AsyncIterable<Uint8Array>,
  cityId: CityId,
  bbox: BoundingBox,
): Promise<WalkGraph> => {
  const south = Math.round(bbox.south * 1e6);
  const north = Math.round(bbox.north * 1e6);
  const west = Math.round(bbox.west * 1e6);
  const east = Math.round(bbox.east * 1e6);

  const ids = new Growable(new Float64Array(1 << 16));
  const lats = new Growable(new Int32Array(1 << 16));
  const lons = new Growable(new Int32Array(1 << 16));
  let waysStarted = false;
  let timestamp: number | undefined;

  /** Node index of an OSM id, or -1 when outside the box. */
  let find = (_id: number) => -1;
  // Ways as runs of node indexes; -1 separates pieces.
  const pieces = new Growable(new Int32Array(1 << 16));

  await readOsmPbf(chunks, {
    header: (header) => {
      timestamp = header.timestamp;
      if (!header.optionalFeatures.includes("Sort.Type_then_ID")) {
        throw new OsmFormatError("the extract must be sorted by type then id");
      }
    },
    nodes: (blockIds, lat, lon, count) => {
      if (waysStarted) throw new OsmFormatError("nodes after ways: the extract isn't sorted");
      for (let i = 0; i < count; i++) {
        const la = lat[i] ?? 0;
        const lo = lon[i] ?? 0;
        if (la < south || la > north || lo < west || lo > east) continue;
        ids.push(blockIds[i] ?? 0);
        lats.push(la);
        lons.push(lo);
      }
    },
    way: (_id, refs, count, tag) => {
      if (!waysStarted) {
        waysStarted = true;
        const sorted = ids.view;
        find = (id) => {
          let lo = 0;
          let hi = sorted.length - 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const value = sorted[mid] ?? 0;
            if (value === id) return mid;
            if (value < id) lo = mid + 1;
            else hi = mid - 1;
          }
          return -1;
        };
      }
      if (!isWalkable(tag)) return;
      let run = 0;
      for (let i = 0; i < count; i++) {
        const node = find(refs[i] ?? 0);
        if (node < 0) {
          if (run > 0) pieces.push(-1);
          run = 0;
          continue;
        }
        pieces.push(node);
        run++;
      }
      if (run > 0) pieces.push(-1);
    },
  });

  return buildGraph(cityId, lats.view, lons.view, pieces.view, timestamp);
};

/**
 * Turns way pieces (node indexes, -1 between pieces) into the walk graph:
 * junctions and dead ends become nodes, everything between becomes one edge's
 * shape; small disconnected fragments are dropped.
 */
export const buildGraph = (
  cityId: CityId,
  lat: Int32Array,
  lon: Int32Array,
  pieces: Int32Array,
  timestamp?: number,
): WalkGraph => {
  const nodeCount = lat.length;
  const meters = (a: number, b: number) =>
    distanceMeters(
      (lat[a] ?? 0) / 1e6,
      (lon[a] ?? 0) / 1e6,
      (lat[b] ?? 0) / 1e6,
      (lon[b] ?? 0) / 1e6,
    );

  // Raw segments between consecutive distinct nodes, deduplicated (ways often overlap).
  const adjacency = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    let set = adjacency.get(a);
    if (set === undefined) adjacency.set(a, (set = new Set()));
    set.add(b);
  };
  let previous = -1;
  for (let i = 0; i < pieces.length; i++) {
    const node = pieces[i] ?? -1;
    if (node >= 0 && previous >= 0 && node !== previous) {
      link(previous, node);
      link(node, previous);
    }
    previous = node;
  }

  // Connected components and their total length.
  const component = new Int32Array(nodeCount).fill(-1);
  const componentMeters: Array<number> = [];
  for (const start of adjacency.keys()) {
    if ((component[start] ?? -1) >= 0) continue;
    const id = componentMeters.length;
    let total = 0;
    const stack = [start];
    component[start] = id;
    while (stack.length > 0) {
      const u = stack.pop() ?? 0;
      for (const v of adjacency.get(u) ?? []) {
        if (u < v) total += meters(u, v);
        if ((component[v] ?? -1) < 0) {
          component[v] = id;
          stack.push(v);
        }
      }
    }
    componentMeters.push(total);
  }
  const kept = (node: number) =>
    (componentMeters[component[node] ?? -1] ?? 0) >= minComponentMeters;

  // Graph nodes: everything that isn't a plain point on a line (degree 2).
  const index = new Int32Array(nodeCount).fill(-1);
  const outLat: Array<number> = [];
  const outLon: Array<number> = [];
  const nodeOf = (node: number) => {
    let i = index[node] ?? -1;
    if (i < 0) {
      i = outLat.length;
      index[node] = i;
      outLat.push(lat[node] ?? 0);
      outLon.push(lon[node] ?? 0);
    }
    return i;
  };
  const isJunction = (node: number) => (adjacency.get(node)?.size ?? 0) !== 2;

  const edgeA: Array<number> = [];
  const edgeB: Array<number> = [];
  const edgeLength: Array<number> = [];
  const firstPoint: Array<number> = [0];
  const pointLat: Array<number> = [];
  const pointLon: Array<number> = [];
  const used = new Set<string>();
  const segmentKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

  /** Follows plain points from `start` through `next` until a junction (or back to `start`). */
  const trace = (start: number, next: number) => {
    const chain = [start];
    let from = start;
    let at = next;
    used.add(segmentKey(from, at));
    while (!isJunction(at) && at !== start) {
      chain.push(at);
      let onward = -1;
      for (const v of adjacency.get(at) ?? []) if (v !== from) onward = v;
      if (onward < 0 || used.has(segmentKey(at, onward))) break;
      used.add(segmentKey(at, onward));
      from = at;
      at = onward;
    }
    chain.push(at);
    let length = 0;
    for (let i = 1; i < chain.length; i++) length += meters(chain[i - 1] ?? 0, chain[i] ?? 0);
    const chainLat = chain.map((node) => lat[node] ?? 0);
    const chainLon = chain.map((node) => lon[node] ?? 0);
    const shape = simplify(chainLat, chainLon, toleranceMeters);
    edgeA.push(nodeOf(start));
    edgeB.push(nodeOf(at));
    edgeLength.push(Math.max(1, Math.round(length * 10)));
    for (const i of shape.slice(1, -1)) {
      pointLat.push(chainLat[i] ?? 0);
      pointLon.push(chainLon[i] ?? 0);
    }
    firstPoint.push(pointLat.length);
  };

  for (const [node, neighbors] of adjacency) {
    if (!kept(node) || !isJunction(node)) continue;
    for (const next of neighbors) if (!used.has(segmentKey(node, next))) trace(node, next);
  }
  // Loops made only of plain points (a closed footway around a square): start anywhere.
  for (const [node, neighbors] of adjacency) {
    if (!kept(node)) continue;
    for (const next of neighbors) if (!used.has(segmentKey(node, next))) trace(node, next);
  }

  return {
    cityId,
    osmTimestamp: timestamp === undefined ? undefined : new Date(timestamp * 1000).toISOString(),
    nodes: { count: outLat.length, lat: Int32Array.from(outLat), lon: Int32Array.from(outLon) },
    edges: {
      count: edgeA.length,
      a: Uint32Array.from(edgeA),
      b: Uint32Array.from(edgeB),
      length: Uint32Array.from(edgeLength),
      firstPoint: Uint32Array.from(firstPoint),
    },
    points: { lat: Int32Array.from(pointLat), lon: Int32Array.from(pointLon) },
  };
};
