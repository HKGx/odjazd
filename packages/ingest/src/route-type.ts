import type { Mode } from "@odjazd/model";

const basic: ReadonlyMap<number, Mode> = new Map<number, Mode>([
  [0, "tram"],
  [1, "metro"],
  [2, "rail"],
  [3, "bus"],
  [4, "ferry"],
  [5, "cable_tram"],
  [6, "aerial_lift"],
  [7, "funicular"],
  [11, "trolleybus"],
  [12, "monorail"],
]);

/**
 * Mode for a GTFS `route_type`, including the extended (Google / HVT) codes.
 * `undefined` for types we don't route on (taxi, misc).
 */
export const modeFromRouteType = (routeType: number): Mode | undefined => {
  const mode = basic.get(routeType);
  if (mode !== undefined) return mode;
  if (routeType === 405) return "monorail";
  if (routeType === 800) return "trolleybus";
  if (routeType === 1400) return "funicular";
  const family = Math.floor(routeType / 100);
  switch (family) {
    case 1: // railway
    case 3: // suburban railway
      return "rail";
    case 2: // coach
    case 7: // bus
      return "bus";
    case 4: // urban railway / metro
      return "metro";
    case 9: // tram
      return "tram";
    case 10: // water
    case 12: // ferry
      return "ferry";
    case 13: // aerial lift
      return "aerial_lift";
    default:
      return undefined;
  }
};
