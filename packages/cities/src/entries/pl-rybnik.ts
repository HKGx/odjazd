import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3), no duplicate public
// numbers. Served from the ODT mirror (group labelled "scraped").
//
// TODO(license): the operator publishes the GTFS zip with no reuse terms and
// ODT lists no license. Added on the assumption of statutory PSI reuse;
// replace with the real grant if KM Rybnik publishes one.

const license = {
  spdx: "unknown",
  url: "https://odt.org.pl/pl/data/feeds/25",
  attribution: "Dane: KM Rybnik",
  sourceUrl: "https://odt.org.pl/pl/data/feeds/25",
};

export const plRybnik: typeof CatalogEntry.Encoded = {
  id: "pl-rybnik",
  name: { pl: "Rybnik", en: "Rybnik" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-01 feed, padded slightly.
  bbox: { south: 49.98, west: 18.36, north: 50.22, east: 18.72 },
  center: { lat: 50.0971, lon: 18.5392 },
  status: "enabled",
  streets: geofabrik("europe/poland/slaskie"),
  feeds: {
    static: [
      {
        id: "km",
        url: "https://data.odt.org.pl/gtfs/rybnik-gtfs.zip",
        agencies: [{ slug: "km-rybnik", feedAgencyId: "KM", name: "Komunikacja Miejska Rybnik" }],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
