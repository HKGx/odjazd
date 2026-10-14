import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3). RT trip_ids match static
// verbatim (1/1 on the night line N1 at verification time); the alerts feed
// was published but empty (15 B header only). feed_info carries no validity
// dates; service comes from calendar.txt plus calendar_dates.txt.

// Reuse under UM Kielce's statutory PSI terms: name Urząd Miasta Kielce,
// give creation/download date, note processing, state UM Kielce is not
// responsible for reuse.
const license = {
  spdx: "custom",
  url: "https://bipum.kielce.eu/udostepnianie-informacji-publicznych/ponowne-wykorzystywanie-informacji-sektora-publicznego.html",
  attribution: "Dane: Urząd Miasta Kielce",
  sourceUrl:
    "https://bipum.kielce.eu/udostepnianie-informacji-publicznych/ponowne-wykorzystywanie-informacji-sektora-publicznego.html",
};

const portal = "https://ztm.kielce.pl";

export const plKielce: typeof CatalogEntry.Encoded = {
  id: "pl-kielce",
  name: { pl: "Kielce", en: "Kielce" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-13 feed, padded slightly.
  bbox: { south: 50.66, west: 20.33, north: 51.02, east: 20.92 },
  center: { lat: 50.8661, lon: 20.6286 },
  status: "enabled",
  streets: geofabrik("europe/poland/swietokrzyskie"),
  feeds: {
    static: [
      {
        id: "ztm",
        url: `${portal}/GTFS/GTFS.zip`,
        agencies: [
          {
            slug: "ztm-kielce",
            feedAgencyId: "ZTM",
            name: "Zarząd Transportu Miejskiego w Kielcach",
          },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [
      {
        id: "ztm-trip-updates",
        type: "trip_updates",
        url: `${portal}/GTFS-RT/trip_updates.bin`,
        staticFeed: "ztm",
        pollIntervalSeconds: 40,
        license,
      },
      {
        id: "ztm-vehicle-positions",
        type: "vehicle_positions",
        url: `${portal}/GTFS-RT/vehicle_positions.bin`,
        staticFeed: "ztm",
        pollIntervalSeconds: 40,
        license,
      },
      {
        id: "ztm-alerts",
        type: "alerts",
        url: `${portal}/GTFS-RT/alerts.bin`,
        staticFeed: "ztm",
        pollIntervalSeconds: 40,
        license,
      },
    ],
  },
};
