import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Trams are route_type 0, buses 3; identical public
// numbers across variant route_ids merge into one line by design. Service
// uses per-trip calendar rows plus ~52k calendar_dates removals. The feed
// window ends 2026-10-23, so the mirror must refresh promptly. Served from
// the ODT mirror (group labelled "scraped").
//
// TODO(license): the operator publishes the GTFS as a BIP attachment with no
// reuse terms and ODT lists no license. Added on the assumption of statutory
// PSI reuse.

const license = {
  spdx: "unknown",
  url: "https://odt.org.pl/pl/data/feeds/27",
  attribution: "Dane: MZK Gorzów Wielkopolski",
  sourceUrl: "https://odt.org.pl/pl/data/feeds/27",
};

export const plGorzowWielkopolski: typeof CatalogEntry.Encoded = {
  id: "pl-gorzow-wielkopolski",
  name: { pl: "Gorzów Wielkopolski", en: "Gorzów Wielkopolski" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-01 feed, padded slightly.
  bbox: { south: 52.66, west: 15.02, north: 52.79, east: 15.35 },
  center: { lat: 52.7368, lon: 15.2288 },
  status: "enabled",
  streets: geofabrik("europe/poland/lubuskie"),
  feeds: {
    static: [
      {
        id: "mzk",
        url: "https://data.odt.org.pl/gtfs/gorzow-gtfs.zip",
        agencies: [{ slug: "mzk-gorzow", feedAgencyId: "1", name: "MZK Gorzów Wielkopolski" }],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
