import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-14. ZTM GZM splits its schedule across dated archives on
// the open-data portal; the mirror merges and recompresses them once a day
// (09:00 UTC). RT covers the whole metropolis on :5443 without Last-Modified,
// so both static and live checks run on a slower cadence.

const license = {
  spdx: "CC-BY-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Dane: ZTM GZM, CC BY 4.0",
  sourceUrl:
    "https://otwartedane.metropoliagzm.pl/dataset/rozklady-jazdy-i-lokalizacja-przystankow-gtfs-wersja-rozszerzona",
};

const staticUrl =
  "https://github.com/TransportGZM-GTFS-mirror/TransportGZM-GTFS-extended-ver/releases/latest/download/TransportGZM-GTFS.zip";
const realtime = "https://gtfsrt.transportgzm.pl:5443/gtfsrt/gzm";

export const plGliwice: typeof CatalogEntry.Encoded = {
  id: "pl-gliwice",
  name: { pl: "Gliwice", en: "Gliwice" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-14 GZM feed, padded slightly.
  bbox: { south: 49.95, west: 18.38, north: 50.6, east: 19.5 },
  center: { lat: 50.2945, lon: 18.6714 },
  status: "enabled",
  streets: geofabrik("europe/poland/slaskie"),
  feeds: {
    static: [
      {
        id: "ztm",
        url: staticUrl,
        agencies: [
          { slug: "ztm-gzm", feedAgencyId: "1", name: "Zarząd Transportu Metropolitalnego" },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [
      {
        id: "ztm-trip-updates",
        type: "trip_updates",
        url: `${realtime}/tripUpdates`,
        staticFeed: "ztm",
        pollIntervalSeconds: 30,
        license,
      },
      {
        id: "ztm-vehicle-positions",
        type: "vehicle_positions",
        url: `${realtime}/vehiclePositions`,
        staticFeed: "ztm",
        pollIntervalSeconds: 30,
        license,
      },
    ],
  },
};
