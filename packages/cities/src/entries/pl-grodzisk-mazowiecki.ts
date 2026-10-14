import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3) around Grodzisk Mazowiecki.
// The lean kiedyPrzyjedzie profile: no shapes.txt, minimal columns, and an
// extra service_name column on calendar files (ignored). The only realtime
// feed is trip_updates without vehicle positions (1/1 trip matched), which
// the server cannot resolve to map vehicles, so the city is static-only.
//
// TODO(license): no voluntary grant on record — the data was obtained via an
// access request and litigation, ODT lists no license. Added on the
// assumption of statutory PSI reuse.

const license = {
  spdx: "unknown",
  url: "https://odt.org.pl/pl/data/feeds/21",
  attribution: "Dane: GPA Grodzisk Mazowiecki",
  sourceUrl: "https://odt.org.pl/pl/data/feeds/21",
};

export const plGrodziskMazowiecki: typeof CatalogEntry.Encoded = {
  id: "pl-grodzisk-mazowiecki",
  name: { pl: "Grodzisk Mazowiecki", en: "Grodzisk Mazowiecki" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-14 feed, padded slightly.
  bbox: { south: 51.9, west: 20.21, north: 52.38, east: 20.97 },
  center: { lat: 52.11, lon: 20.63 },
  status: "enabled",
  streets: geofabrik("europe/poland/mazowieckie"),
  feeds: {
    static: [
      {
        id: "gpa",
        url: "https://api.odt.org.pl/feed/55/google_transit.zip",
        agencies: [
          {
            slug: "gpa",
            feedAgencyId: "237",
            name: "Grodziskie Przewozy Autobusowe",
          },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
