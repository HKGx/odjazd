import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Schedule only, no realtime. The city publishes dated
// archives on its open-data portal; the data.odt.org.pl mirror tracks the
// latest (`today_forward`) and refreshes nightly. Trams are route_type 0,
// buses 3; every route_short_name is unique across the feed's 6 operators.
// The portal's catalog API states licence 7 (CC0 1.0) for this dataset.

const license = {
  spdx: "CC0-1.0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution: "Dane: Otwarty Wrocław (UM Wrocław)",
  sourceUrl: "https://api.open-data.cui.wroclaw.pl/katalog/14/",
};

export const plWroclaw: typeof CatalogEntry.Encoded = {
  id: "pl-wroclaw",
  name: { pl: "Wrocław", en: "Wrocław" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-12 feed, padded slightly.
  bbox: { south: 50.95, west: 16.67, north: 51.27, east: 17.34 },
  center: { lat: 51.1079, lon: 17.0385 },
  status: "enabled",
  streets: geofabrik("europe/poland/dolnoslaskie"),
  feeds: {
    static: [
      {
        id: "wt",
        url: "https://data.odt.org.pl/gtfs/wroclaw-gtfs.zip",
        agencies: [
          { slug: "mpk-autobusy", feedAgencyId: "2", name: "MPK Autobusy" },
          { slug: "mpk-tramwaje", feedAgencyId: "3", name: "MPK Tramwaje" },
          { slug: "mpk-inny", feedAgencyId: "16", name: "MPK Inny" },
          { slug: "nowak-transport", feedAgencyId: "27", name: "Nowak Transport" },
          { slug: "klosok", feedAgencyId: "28", name: "PT Kłosok" },
          { slug: "dla-wroclaw", feedAgencyId: "29", name: "DLA Wrocław" },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
