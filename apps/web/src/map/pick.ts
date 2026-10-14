/**
 * While a panel wants input from the map (the route editor adding areas),
 * taps on stops and long-presses go to it instead of navigating.
 */
export const mapPick: {
  stop?: ((group: number) => void) | undefined;
  point?: ((lat: number, lon: number) => void) | undefined;
} = {};
