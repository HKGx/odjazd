import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3), lean kiedyPrzyjedzie
// profile (no shapes.txt). The only realtime feed is trip_updates without
// vehicle positions (alive but empty at night), which the server cannot
// resolve to map vehicles, so the city is static-only. The ODT mirror file
// 404s; the identical upstream feed is used instead.
//
// TODO(license): no reuse terms anywhere (Google Maps integration announced,
// no GTFS terms, ODT lists no license). Added on the assumption of statutory
// PSI reuse.

const license = {
  spdx: "unknown",
  url: "https://odt.org.pl/pl/data/feeds/7",
  attribution: "Dane: ZKG KM Olkusz",
  sourceUrl: "https://odt.org.pl/pl/data/feeds/7",
};

export const plOlkusz: typeof CatalogEntry.Encoded = {
  id: "pl-olkusz",
  name: { pl: "Olkusz", en: "Olkusz" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-14 feed, padded slightly.
  bbox: { south: 50.18, west: 19.36, north: 50.43, east: 19.71 },
  center: { lat: 50.281, lon: 19.555 },
  status: "enabled",
  streets: geofabrik("europe/poland/malopolskie"),
  feeds: {
    static: [
      {
        id: "zkg",
        url: "https://api.odt.org.pl/feed/9/google_transit.zip",
        agencies: [{ slug: "zkg-olkusz", feedAgencyId: "57", name: "ZKG KM Olkusz" }],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
