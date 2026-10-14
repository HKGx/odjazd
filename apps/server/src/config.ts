import type { CityId } from "@odjazd/model";
import { Config } from "effect";

export const port = Config.Port("PORT").pipe(Config.withDefault(8787));

/** Where compiled feeds and manifests live; survives restarts. */
export const dataDir = Config.String("ODJAZD_DATA_DIR").pipe(Config.withDefault("data"));

/**
 * Local GTFS archive for a city instead of its catalog URL, e.g.
 * `ODJAZD_GTFS_PL_LODZ=/path/GTFS.zip`. Useful offline and in development.
 */
export const gtfsOverride = (city: CityId) =>
  Config.String(`ODJAZD_GTFS_${city.toUpperCase().replaceAll("-", "_")}`).pipe(Config.option);

/** Local OpenStreetMap extract for a city instead of its catalog URL, e.g. `ODJAZD_OSM_PL_LODZ`. */
export const streetsOverride = (city: CityId) =>
  Config.String(`ODJAZD_OSM_${city.toUpperCase().replaceAll("-", "_")}`).pipe(Config.option);

/**
 * Alternate URL for a realtime feed when the publisher blocks the server's
 * network, e.g. `ODJAZD_RT_PL_GLIWICE_ZTM_VEHICLE_POSITIONS=https://...`.
 */
export const realtimeOverride = (city: CityId, feedId: string) =>
  Config.String(
    `ODJAZD_RT_${city.toUpperCase().replaceAll("-", "_")}_${feedId.toUpperCase().replaceAll("-", "_")}`,
  ).pipe(Config.option);

/**
 * The built web app (`apps/web/dist`) to serve next to the API, in production
 * one origin for both. Unset in development, where Vite serves it.
 */
export const webDir = Config.String("ODJAZD_WEB_DIR").pipe(Config.option);
