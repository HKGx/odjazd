import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3), no duplicate public
// numbers. Served directly by the operator (not a mirror).

// Reuse under the 2021 Open Data Act, free public access with cyclical
// fetching allowed; reusers must keep the presented data current.
const license = {
  spdx: "custom",
  url: "https://komunikacjapabianice.pl/dokumenty/otwarte-dane-rozkladowe-gtfs/",
  attribution: "Dane: MZK Pabianice",
  sourceUrl: "https://komunikacjapabianice.pl/dokumenty/otwarte-dane-rozkladowe-gtfs/",
};

export const plPabianice: typeof CatalogEntry.Encoded = {
  id: "pl-pabianice",
  name: { pl: "Pabianice", en: "Pabianice" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-09-23 feed, padded slightly.
  bbox: { south: 51.53, west: 19.27, north: 51.73, east: 19.52 },
  center: { lat: 51.6607, lon: 19.3541 },
  status: "enabled",
  streets: geofabrik("europe/poland/lodzkie"),
  feeds: {
    static: [
      {
        id: "mzk",
        url: "https://gtfs.mzkpabianice.pl/GTFS.zip",
        agencies: [{ slug: "mzk-pabianice", feedAgencyId: "MZK", name: "MZK Pabianice" }],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
