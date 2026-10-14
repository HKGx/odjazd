import { distanceMeters } from "@odjazd/model";
import type { WalkingModel } from "@odjazd/prediction";
import type { Reach, WalkNetwork } from "./network.ts";

/** Searches reach this far; longer walks are estimated from the straight line. */
const searchMeters = 2500;
const detourFactor = 1.3;

/**
 * Walking along the streets: one search per starting point (kept for reuse,
 * since the planner asks from the same stops over and over), straight line ×
 * 1.3 off the network or beyond the search.
 */
export const networkWalking = (
  network: WalkNetwork,
  options: { readonly speedKmh?: number } = {},
): WalkingModel & {
  /** Meters and the street path; straight when the network can't say. */
  readonly route: (
    from: { readonly lat: number; readonly lon: number },
    to: { readonly lat: number; readonly lon: number },
  ) => {
    readonly meters: number;
    readonly path: ReadonlyArray<{ readonly lat: number; readonly lon: number }>;
  };
} => {
  const metersPerSecond = ((options.speedKmh ?? 4.5) * 1000) / 3600;
  const reaches = new Map<string, Reach | undefined>();
  const reach = (lat: number, lon: number) => {
    const key = `${lat},${lon}`;
    if (reaches.has(key)) {
      // Most recently used last, so the oldest goes first.
      const found = reaches.get(key);
      reaches.delete(key);
      reaches.set(key, found);
      return found;
    }
    const found = network.from(lat, lon, searchMeters);
    reaches.set(key, found);
    if (reaches.size > 256) reaches.delete(reaches.keys().next().value ?? "");
    return found;
  };
  const meters = (fromLat: number, fromLon: number, toLat: number, toLon: number) => {
    const straight = distanceMeters(fromLat, fromLon, toLat, toLon);
    if (straight > searchMeters) return straight * detourFactor;
    const walked = reach(fromLat, fromLon)?.meters(toLat, toLon);
    return walked === undefined ? straight * detourFactor : Math.max(straight, walked);
  };
  return {
    seconds: (fromLat, fromLon, toLat, toLon) =>
      meters(fromLat, fromLon, toLat, toLon) / metersPerSecond,
    secondsAlong: (m) => m / metersPerSecond,
    route: (from, to) => {
      const straight = distanceMeters(from.lat, from.lon, to.lat, to.lon);
      const found =
        straight > searchMeters ? undefined : reach(from.lat, from.lon)?.route(to.lat, to.lon);
      return found === undefined
        ? { meters: straight * detourFactor, path: [from, to] }
        : { meters: Math.max(straight, found.meters), path: found.path };
    },
  };
};
