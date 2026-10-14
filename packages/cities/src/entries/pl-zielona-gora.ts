import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3), no duplicate public
// numbers. Served from the ODT mirror; the archived file was ~7 weeks old at
// verification time, so freshness relies on the mirror refreshing.

// Free reuse with no formalities per MZK's developer page: name the source,
// give the last-update date, mark modifications. Do not tag CC-BY — it is not
// a CC license.
const license = {
  spdx: "custom",
  url: "https://www.mzk.zgora.pl/dla-deweloperow",
  attribution: "Dane: MZK Zielona Góra",
  sourceUrl: "https://www.mzk.zgora.pl/dla-deweloperow",
};

export const plZielonaGora: typeof CatalogEntry.Encoded = {
  id: "pl-zielona-gora",
  name: { pl: "Zielona Góra", en: "Zielona Góra" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the feed, padded slightly.
  bbox: { south: 51.81, west: 15.42, north: 52.03, east: 15.69 },
  center: { lat: 51.9356, lon: 15.5064 },
  status: "enabled",
  streets: geofabrik("europe/poland/lubuskie"),
  feeds: {
    static: [
      {
        id: "mzk",
        url: "https://data.odt.org.pl/gtfs/zielona-gora-gtfs.zip",
        agencies: [
          {
            slug: "mzk-zielona-gora",
            feedAgencyId: "MZK",
            name: "Miejski Zakład Komunikacji w Zielonej Górze",
          },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
