import { distanceMeters } from "@odjazd/model";

/** Walking time between two points. Everything that walks asks this. */
export interface WalkingModel {
  readonly seconds: (fromLat: number, fromLon: number, toLat: number, toLon: number) => number;
  /** Walking time over a distance already measured along the ground (e.g. a footpath). */
  readonly secondsAlong: (meters: number) => number;
}

/** Without a street network: straight-line distance × detour factor at a constant speed. */
export const straightLineWalking = (
  options: { readonly detourFactor?: number; readonly speedKmh?: number } = {},
): WalkingModel => {
  const factor = options.detourFactor ?? 1.3;
  const metersPerSecond = ((options.speedKmh ?? 4.5) * 1000) / 3600;
  return {
    seconds: (fromLat, fromLon, toLat, toLon) =>
      (distanceMeters(fromLat, fromLon, toLat, toLon) * factor) / metersPerSecond,
    secondsAlong: (meters) => meters / metersPerSecond,
  };
};
