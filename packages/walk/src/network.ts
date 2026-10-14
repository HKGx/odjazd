import type { WalkGraph } from "./graph.ts";

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** Where a point meets the network: the nearest spot on the nearest edge. */
export interface Snap {
  readonly edge: number;
  /** Meters along the edge from its `a` end. */
  readonly along: number;
  /** Meters from the point to the street. */
  readonly offset: number;
}

export interface WalkRoute {
  readonly meters: number;
  /** From the start point to the end point, along the streets. */
  readonly path: ReadonlyArray<LatLon>;
}

/** Everything walkable within a distance of one point. */
export interface Reach {
  readonly meters: (lat: number, lon: number) => number | undefined;
  readonly route: (lat: number, lon: number) => WalkRoute | undefined;
}

export interface WalkNetwork {
  readonly graph: WalkGraph;
  readonly snap: (lat: number, lon: number) => Snap | undefined;
  /** One search from `lat, lon` out to `maxMeters`; undefined off the network. */
  readonly from: (lat: number, lon: number, maxMeters: number) => Reach | undefined;
}

/** Farther than this from any street, a point isn't on the network. */
const maxSnapMeters = 250;
const cellMeters = 100;
const metersPerDegree = 111_320;

/** Adds one at `i`; returns the value before. */
const bump = (counts: Uint32Array, i: number) => {
  const before = counts[i] ?? 0;
  counts[i] = before + 1;
  return before;
};

/** Running totals in place: counts become start offsets (CSR). */
const prefixSum = (counts: Uint32Array) => {
  for (let i = 1; i < counts.length; i++) counts[i] = (counts[i] ?? 0) + (counts[i - 1] ?? 0);
};

/** Indexes a walk graph for snapping and shortest walks. Builds in well under a second. */
export const makeWalkNetwork = (graph: WalkGraph): WalkNetwork => {
  const { nodes, edges, points } = graph;
  const n = nodes.count;
  const m = edges.count;

  // Local flat projection, meters per microdegree: fine at city scale.
  let latSum = 0;
  for (let i = 0; i < n; i++) latSum += nodes.lat[i] ?? 0;
  const ky = metersPerDegree / 1e6;
  const kx = ky * Math.cos((n === 0 ? 0 : latSum / n / 1e6) * (Math.PI / 180));

  const edgeMeters = (e: number) => (edges.length[e] ?? 0) / 10;
  const other = (e: number, node: number) =>
    edges.a[e] === node ? (edges.b[e] ?? 0) : (edges.a[e] ?? 0);

  // Adjacency, both directions.
  const adjFirst = new Uint32Array(n + 1);
  for (let e = 0; e < m; e++) {
    bump(adjFirst, (edges.a[e] ?? 0) + 1);
    bump(adjFirst, (edges.b[e] ?? 0) + 1);
  }
  prefixSum(adjFirst);
  const adjEdge = new Uint32Array(adjFirst[n] ?? 0);
  {
    const fill = adjFirst.slice(0, n);
    for (let e = 0; e < m; e++) {
      adjEdge[bump(fill, edges.a[e] ?? 0)] = e;
      adjEdge[bump(fill, edges.b[e] ?? 0)] = e;
    }
  }

  /** Point `i` of edge `e`'s polyline, `a` end first: microdegrees. */
  const pointCount = (e: number) => (edges.firstPoint[e + 1] ?? 0) - (edges.firstPoint[e] ?? 0) + 2;
  const pointLat = (e: number, i: number, count: number) =>
    i === 0
      ? (nodes.lat[edges.a[e] ?? 0] ?? 0)
      : i === count - 1
        ? (nodes.lat[edges.b[e] ?? 0] ?? 0)
        : (points.lat[(edges.firstPoint[e] ?? 0) + i - 1] ?? 0);
  const pointLon = (e: number, i: number, count: number) =>
    i === 0
      ? (nodes.lon[edges.a[e] ?? 0] ?? 0)
      : i === count - 1
        ? (nodes.lon[edges.b[e] ?? 0] ?? 0)
        : (points.lon[(edges.firstPoint[e] ?? 0) + i - 1] ?? 0);

  // Segment grid for snapping: every segment listed in each cell its box touches.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const extend = (lat: number, lon: number) => {
    const x = lon * kx;
    const y = lat * ky;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (let i = 0; i < n; i++) extend(nodes.lat[i] ?? 0, nodes.lon[i] ?? 0);
  for (let i = 0; i < points.lat.length; i++) extend(points.lat[i] ?? 0, points.lon[i] ?? 0);
  const width = n === 0 ? 1 : Math.floor((maxX - minX) / cellMeters) + 1;
  const height = n === 0 ? 1 : Math.floor((maxY - minY) / cellMeters) + 1;
  const cellX = (x: number) =>
    Math.min(width - 1, Math.max(0, Math.floor((x - minX) / cellMeters)));
  const cellY = (y: number) =>
    Math.min(height - 1, Math.max(0, Math.floor((y - minY) / cellMeters)));
  const eachSegmentCell = (visit: (cell: number, edge: number, segment: number) => void) => {
    for (let e = 0; e < m; e++) {
      const count = pointCount(e);
      for (let i = 0; i < count - 1; i++) {
        const x0 = pointLon(e, i, count) * kx;
        const y0 = pointLat(e, i, count) * ky;
        const x1 = pointLon(e, i + 1, count) * kx;
        const y1 = pointLat(e, i + 1, count) * ky;
        const cx1 = cellX(Math.max(x0, x1));
        const cy1 = cellY(Math.max(y0, y1));
        for (let cy = cellY(Math.min(y0, y1)); cy <= cy1; cy++) {
          for (let cx = cellX(Math.min(x0, x1)); cx <= cx1; cx++) visit(cy * width + cx, e, i);
        }
      }
    }
  };
  const cellFirst = new Uint32Array(width * height + 1);
  eachSegmentCell((cell) => void bump(cellFirst, cell + 1));
  prefixSum(cellFirst);
  const cellEdge = new Uint32Array(cellFirst[width * height] ?? 0);
  const cellSegment = new Uint32Array(cellEdge.length);
  {
    const fill = cellFirst.slice(0, width * height);
    eachSegmentCell((cell, e, i) => {
      const at = bump(fill, cell);
      cellEdge[at] = e;
      cellSegment[at] = i;
    });
  }

  /** Meters from the `a` end to segment `segment` + `t` of the way along it. */
  const alongAt = (e: number, segment: number, t: number) => {
    const count = pointCount(e);
    let before = 0;
    let total = 0;
    let within = 0;
    for (let i = 0; i < count - 1; i++) {
      const length = Math.hypot(
        (pointLon(e, i + 1, count) - pointLon(e, i, count)) * kx,
        (pointLat(e, i + 1, count) - pointLat(e, i, count)) * ky,
      );
      if (i < segment) before += length;
      if (i === segment) within = length * t;
      total += length;
    }
    // Projected lengths, scaled to the stored ground length.
    return total === 0 ? 0 : ((before + within) / total) * edgeMeters(e);
  };

  const snapUncached = (lat: number, lon: number): Snap | undefined => {
    const px = lon * 1e6 * kx;
    const py = lat * 1e6 * ky;
    if (n === 0) return undefined;
    const cx = Math.floor((px - minX) / cellMeters);
    const cy = Math.floor((py - minY) / cellMeters);
    let best = { edge: -1, segment: 0, t: 0, distance: Number.POSITIVE_INFINITY };
    const rings = Math.ceil(maxSnapMeters / cellMeters) + 1;
    for (let r = 0; r <= rings; r++) {
      // Nothing in a farther ring can beat a match closer than the ring's inner edge.
      if (best.distance <= (r - 1) * cellMeters) break;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= height) continue;
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || x >= width) continue;
          if (Math.abs(y - cy) !== r && Math.abs(x - cx) !== r) continue;
          const cell = y * width + x;
          for (let k = cellFirst[cell] ?? 0; k < (cellFirst[cell + 1] ?? 0); k++) {
            const e = cellEdge[k] ?? 0;
            const i = cellSegment[k] ?? 0;
            const count = pointCount(e);
            const ax = pointLon(e, i, count) * kx;
            const ay = pointLat(e, i, count) * ky;
            const dx = pointLon(e, i + 1, count) * kx - ax;
            const dy = pointLat(e, i + 1, count) * ky - ay;
            const length2 = dx * dx + dy * dy;
            const t =
              length2 === 0
                ? 0
                : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
            const distance = Math.hypot(px - ax - t * dx, py - ay - t * dy);
            if (distance < best.distance) best = { edge: e, segment: i, t, distance };
          }
        }
      }
    }
    if (best.edge < 0 || best.distance > maxSnapMeters) return undefined;
    return {
      edge: best.edge,
      along: alongAt(best.edge, best.segment, best.t),
      offset: best.distance,
    };
  };
  const snaps = new Map<string, Snap | undefined>();
  const snap = (lat: number, lon: number) => {
    const key = `${lat},${lon}`;
    if (snaps.has(key)) return snaps.get(key);
    if (snaps.size > 20_000) snaps.clear();
    const found = snapUncached(lat, lon);
    snaps.set(key, found);
    return found;
  };

  /** The part of edge `e` between two distances from its `a` end, in travel order. */
  const cut = (e: number, from: number, to: number): Array<LatLon> => {
    const count = pointCount(e);
    const total = edgeMeters(e);
    const cumulative: Array<number> = [0];
    for (let i = 0; i < count - 1; i++) {
      const length = Math.hypot(
        (pointLon(e, i + 1, count) - pointLon(e, i, count)) * kx,
        (pointLat(e, i + 1, count) - pointLat(e, i, count)) * ky,
      );
      cumulative.push((cumulative[i] ?? 0) + length);
    }
    const scale = (cumulative[count - 1] ?? 0) === 0 ? 0 : total / (cumulative[count - 1] ?? 1);
    const at = (meters: number): LatLon => {
      for (let i = 0; i < count - 1; i++) {
        const start = (cumulative[i] ?? 0) * scale;
        const end = (cumulative[i + 1] ?? 0) * scale;
        if (meters <= end || i === count - 2) {
          const t = end === start ? 0 : Math.max(0, Math.min(1, (meters - start) / (end - start)));
          const lat0 = pointLat(e, i, count);
          const lon0 = pointLon(e, i, count);
          return {
            lat: (lat0 + (pointLat(e, i + 1, count) - lat0) * t) / 1e6,
            lon: (lon0 + (pointLon(e, i + 1, count) - lon0) * t) / 1e6,
          };
        }
      }
      return { lat: pointLat(e, 0, count) / 1e6, lon: pointLon(e, 0, count) / 1e6 };
    };
    const path = [at(from)];
    const inner = (i: number) => (cumulative[i] ?? 0) * scale;
    if (from <= to) {
      for (let i = 1; i < count - 1; i++) {
        if (inner(i) > from && inner(i) < to) {
          path.push({ lat: pointLat(e, i, count) / 1e6, lon: pointLon(e, i, count) / 1e6 });
        }
      }
    } else {
      for (let i = count - 2; i >= 1; i--) {
        if (inner(i) < from && inner(i) > to) {
          path.push({ lat: pointLat(e, i, count) / 1e6, lon: pointLon(e, i, count) / 1e6 });
        }
      }
    }
    path.push(at(to));
    return path;
  };

  // Dijkstra scratch, reused across searches; `seen[i] === generation` marks this search's labels.
  const dist = new Float64Array(n);
  const pred = new Int32Array(n);
  const seen = new Uint32Array(n);
  let generation = 0;
  const heapNode: Array<number> = [];
  const heapDist: Array<number> = [];
  const heapPush = (node: number, d: number) => {
    let i = heapNode.length;
    heapNode.push(node);
    heapDist.push(d);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((heapDist[parent] ?? 0) <= d) break;
      heapNode[i] = heapNode[parent] ?? 0;
      heapDist[i] = heapDist[parent] ?? 0;
      i = parent;
    }
    heapNode[i] = node;
    heapDist[i] = d;
  };
  const heapPop = () => {
    const top = heapNode[0] ?? 0;
    const lastNode = heapNode.pop() ?? 0;
    const lastDist = heapDist.pop() ?? 0;
    const size = heapNode.length;
    if (size > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= size) break;
        const right = left + 1;
        const child = right < size && (heapDist[right] ?? 0) < (heapDist[left] ?? 0) ? right : left;
        if ((heapDist[child] ?? 0) >= lastDist) break;
        heapNode[i] = heapNode[child] ?? 0;
        heapDist[i] = heapDist[child] ?? 0;
        i = child;
      }
      heapNode[i] = lastNode;
      heapDist[i] = lastDist;
    }
    return top;
  };

  const from = (lat: number, lon: number, maxMeters: number): Reach | undefined => {
    const source = snap(lat, lon);
    if (source === undefined) return undefined;
    generation++;
    if (generation === 0xffffffff) {
      seen.fill(0);
      generation = 1;
    }
    const touched: Array<number> = [];
    const relax = (node: number, d: number, edge: number) => {
      if (d > maxMeters) return;
      if (seen[node] === generation && d >= (dist[node] ?? 0)) return;
      if (seen[node] !== generation) touched.push(node);
      seen[node] = generation;
      dist[node] = d;
      pred[node] = edge;
      heapPush(node, d);
    };
    const sa = edges.a[source.edge] ?? 0;
    const sb = edges.b[source.edge] ?? 0;
    const sLength = edgeMeters(source.edge);
    relax(sa, source.offset + source.along, -1);
    relax(sb, source.offset + sLength - source.along, -1);
    while (heapNode.length > 0) {
      const d = heapDist[0] ?? 0;
      const u = heapPop();
      if (d > (dist[u] ?? 0)) continue;
      for (let k = adjFirst[u] ?? 0; k < (adjFirst[u + 1] ?? 0); k++) {
        const e = adjEdge[k] ?? 0;
        relax(other(e, u), d + edgeMeters(e), e);
      }
    }

    // Keep this search's labels: the scratch arrays belong to the next one.
    const label = new Map<number, readonly [meters: number, edge: number]>();
    for (const node of touched) label.set(node, [dist[node] ?? 0, pred[node] ?? -1]);

    /** Best way to the target's snap: via either end of its edge, or along the source edge. */
    const best = (target: Snap) => {
      const ta = edges.a[target.edge] ?? 0;
      const tb = edges.b[target.edge] ?? 0;
      const tLength = edgeMeters(target.edge);
      let meters = Number.POSITIVE_INFINITY;
      let via: number | undefined;
      const viaA = label.get(ta);
      if (viaA !== undefined && viaA[0] + target.along < meters) {
        meters = viaA[0] + target.along;
        via = ta;
      }
      const viaB = label.get(tb);
      if (viaB !== undefined && viaB[0] + tLength - target.along < meters) {
        meters = viaB[0] + tLength - target.along;
        via = tb;
      }
      if (target.edge === source.edge) {
        const direct = source.offset + Math.abs(target.along - source.along);
        if (direct <= meters) {
          meters = direct;
          via = undefined;
        }
      }
      meters += target.offset;
      return meters > maxMeters ? undefined : { meters, via };
    };

    return {
      meters: (toLat, toLon) => {
        const target = snap(toLat, toLon);
        return target === undefined ? undefined : best(target)?.meters;
      },
      route: (toLat, toLon) => {
        const target = snap(toLat, toLon);
        if (target === undefined) return undefined;
        const found = best(target);
        if (found === undefined) return undefined;
        let path: Array<LatLon>;
        if (found.via === undefined) {
          path = cut(source.edge, source.along, target.along);
        } else {
          // Back from the target's end node to an end of the source edge.
          const chain: Array<Array<LatLon>> = [];
          let node = found.via;
          for (;;) {
            const edge = label.get(node)?.[1] ?? -1;
            if (edge < 0) break;
            const previous = other(edge, node);
            const forward = edges.a[edge] === previous;
            chain.push(cut(edge, forward ? 0 : edgeMeters(edge), forward ? edgeMeters(edge) : 0));
            node = previous;
          }
          chain.reverse();
          path = [
            ...cut(source.edge, source.along, node === sa ? 0 : sLength),
            ...chain.flat(),
            ...cut(
              target.edge,
              found.via === edges.a[target.edge] ? 0 : edgeMeters(target.edge),
              target.along,
            ),
          ];
        }
        const full = [{ lat, lon }, ...path, { lat: toLat, lon: toLon }];
        const deduped: Array<LatLon> = [];
        for (const p of full) {
          const last = deduped[deduped.length - 1];
          if (
            last === undefined ||
            Math.abs(last.lat - p.lat) > 1e-7 ||
            Math.abs(last.lon - p.lon) > 1e-7
          ) {
            deduped.push(p);
          }
        }
        return { meters: found.meters, path: deduped };
      },
    };
  };

  return { graph, snap, from };
};
