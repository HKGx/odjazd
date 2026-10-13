import { distanceMeters } from "@odjazd/model";

/** Walking time between two points. Everything that walks asks this. */
export interface WalkingModel {
  readonly seconds: (fromLat: number, fromLon: number, toLat: number, toLon: number) => number;
}

/** v1: straight-line distance × detour factor at a constant speed. */
export const straightLineWalking = (
  options: { readonly detourFactor?: number; readonly speedKmh?: number } = {},
): WalkingModel => {
  const factor = options.detourFactor ?? 1.3;
  const metersPerSecond = ((options.speedKmh ?? 4.5) * 1000) / 3600;
  return {
    seconds: (fromLat, fromLon, toLat, toLon) =>
      (distanceMeters(fromLat, fromLon, toLat, toLon) * factor) / metersPerSecond,
  };
};
