import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Wałbrzych publishes two operator feeds (MUZK, SKA)
// with identical calendars; SKA is a strict superset (every MUZK route short
// name and stop_id is contained in SKA, plus SKA-only 10/15/20), so only the
// SKA feed is ingested — only the first static feed per city is compiled.
// Buses only (route_type 3), no duplicate public numbers.
//
// TODO(license): no reuse terms on any operator/city page and ODT lists no
// license. Added on the assumption of statutory PSI reuse.

const license = {
  spdx: "unknown",
  url: "https://odt.org.pl/pl/data/feeds/11",
  attribution: "Dane: MZUK Wałbrzych",
  sourceUrl: "https://odt.org.pl/pl/data/feeds/11",
};

export const plWalbrzych: typeof CatalogEntry.Encoded = {
  id: "pl-walbrzych",
  name: { pl: "Wałbrzych", en: "Wałbrzych" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the SKA feed, padded slightly.
  bbox: { south: 50.6, west: 16.07, north: 50.88, east: 16.41 },
  center: { lat: 50.7714, lon: 16.2843 },
  status: "enabled",
  streets: geofabrik("europe/poland/dolnoslaskie"),
  feeds: {
    static: [
      {
        id: "mzuk",
        url: "https://api.odt.org.pl/feed/20/SKA.zip",
        agencies: [
          {
            slug: "mzuk-walbrzych",
            feedAgencyId: "MZUK",
            name: "Miejski Zakład Usług Komunalnych",
          },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
