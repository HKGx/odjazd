import { distanceMeters } from "@odjazd/model";
import type { WalkNetwork } from "./network.ts";

/** Stop-to-stop walks, per stop: `to[first[s] .. first[s + 1])` with their `meters`. */
export interface Footpaths {
  readonly first: Uint32Array;
  readonly to: Uint32Array;
  readonly meters: Uint32Array;
}

/** Transfers walk at most this far along the streets. */
export const maxFootpathMeters = 600;
/** Off the network, the old rule: this far in a straight line, × 1.3. */
const fallbackStraightMeters = 400;
const detourFactor = 1.3;

/**
 * Walking distances between stops close enough to change between, measured
 * along the streets. A pair with a stop off the streets (no street within
 * snapping distance) falls back to a straight-line estimate, so such stops keep
 * their transfers, the same in both directions.
 */
export const computeFootpaths = (
  network: WalkNetwork,
  stops: {
    readonly count: number;
    readonly lat: ArrayLike<number>;
    readonly lon: ArrayLike<number>;
  },
  maxMeters = maxFootpathMeters,
): Footpaths => {
  const { count, lat, lon } = stops;
  // Grid of stops, cells of maxMeters, so neighbors are in the 3×3 around a stop.
  const cellLat = maxMeters / 111_320;
  const cellLon = cellLat / Math.cos(((lat[0] ?? 0) * Math.PI) / 180);
  const key = (y: number, x: number) => `${y},${x}`;
  const grid = new Map<string, Array<number>>();
  for (let s = 0; s < count; s++) {
    const k = key(Math.floor((lat[s] ?? 0) / cellLat), Math.floor((lon[s] ?? 0) / cellLon));
    const list = grid.get(k);
    if (list === undefined) grid.set(k, [s]);
    else list.push(s);
  }

  const first = new Uint32Array(count + 1);
  const to: Array<number> = [];
  const meters: Array<number> = [];
  for (let s = 0; s < count; s++) {
    const sLat = lat[s] ?? 0;
    const sLon = lon[s] ?? 0;
    const near: Array<readonly [stop: number, straight: number]> = [];
    const cy = Math.floor(sLat / cellLat);
    const cx = Math.floor(sLon / cellLon);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const t of grid.get(key(cy + dy, cx + dx)) ?? []) {
          if (t === s) continue;
          const straight = distanceMeters(sLat, sLon, lat[t] ?? 0, lon[t] ?? 0);
          if (straight <= maxMeters) near.push([t, straight]);
        }
      }
    }
    near.sort((a, b) => a[0] - b[0]);

    const reach = network.from(sLat, sLon, maxMeters);
    const chosen: Array<readonly [number, number]> = [];
    for (const [t, straight] of near) {
      const tLat = lat[t] ?? 0;
      const tLon = lon[t] ?? 0;
      if (reach !== undefined && network.snap(tLat, tLon) !== undefined) {
        const m = reach.meters(tLat, tLon);
        if (m !== undefined) chosen.push([t, Math.max(straight, m)]);
      } else if (straight <= fallbackStraightMeters) {
        // Either end off the streets: the network can't say, so estimate (both ways alike).
        chosen.push([t, straight * detourFactor]);
      }
    }
    for (const [t, m] of chosen) {
      to.push(t);
      meters.push(Math.round(m));
    }
    first[s + 1] = to.length;
  }
  return { first, to: Uint32Array.from(to), meters: Uint32Array.from(meters) };
};
