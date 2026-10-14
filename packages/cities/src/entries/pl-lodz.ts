import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-13. Static versions appear irregularly (every 1-4 days,
// sometimes twice a day), each valid from its publication day. RT refreshes on
// a ~15 s grid and serves no CORS headers. Transitland f-u3jy-lodz tracks a
// third-party mirror, not the city's file. Not listed in Mobility Database.

const license = {
  spdx: "CC-BY-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Dane: Miasto Łódź / ZDiT, CC BY 4.0",
  sourceUrl: "https://dane.gov.pl/en/dataset/34213,otwarte-dane-miasta-lodzi",
};

const portal = "https://otwarte.miasto.lodz.pl/wp-content/uploads/2025/06";

export const plLodz: typeof CatalogEntry.Encoded = {
  id: "pl-lodz",
  name: { pl: "Łódź", en: "Łódź" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-13 feed, padded slightly.
  bbox: { south: 51.63, west: 19.18, north: 51.93, east: 19.79 },
  center: { lat: 51.7769, lon: 19.4547 },
  status: "enabled",
  streets: geofabrik("europe/poland/lodzkie"),
  feeds: {
    static: [
      {
        id: "zdit",
        url: `${portal}/GTFS.zip`,
        agencies: [
          { slug: "zdit-lodz", feedAgencyId: "ZDiT", name: "Zarząd Dróg i Transportu w Łodzi" },
        ],
        checkIntervalSeconds: 3600,
        license,
      },
    ],
    realtime: [
      {
        id: "zdit-trip-updates",
        type: "trip_updates",
        url: `${portal}/trip_updates.bin`,
        staticFeed: "zdit",
        pollIntervalSeconds: 15,
        license,
      },
      {
        id: "zdit-vehicle-positions",
        type: "vehicle_positions",
        url: `${portal}/vehicle_positions.bin`,
        staticFeed: "zdit",
        pollIntervalSeconds: 15,
        license,
      },
      {
        id: "zdit-alerts",
        type: "alerts",
        url: `${portal}/alerts.bin`,
        staticFeed: "zdit",
        pollIntervalSeconds: 60,
        license,
      },
    ],
  },
  external: { transitlandOnestopId: "f-u3jy-lodz" },
};
