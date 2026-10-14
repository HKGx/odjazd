import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3), no duplicate public
// numbers. feed_info carries no validity dates and the calendar ends
// 2026-10-30, so the mirror must refresh promptly. Served from the ODT
// mirror; realtime is explicitly not shared as open API.

// Reuse under the 2021 Open Data Act per ZIM's open-data page; attribution
// recommended (not mandatory).
const license = {
  spdx: "custom",
  url: "https://zimslupsk.pl/otwarte-dane.html",
  attribution: "Zarząd Infrastruktury Miejskiej w Słupsku",
  sourceUrl: "https://zimslupsk.pl/otwarte-dane.html",
};

export const plSlupsk: typeof CatalogEntry.Encoded = {
  id: "pl-slupsk",
  name: { pl: "Słupsk", en: "Słupsk" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the feed, padded slightly.
  bbox: { south: 54.39, west: 16.92, north: 54.54, east: 17.17 },
  center: { lat: 54.4641, lon: 17.0287 },
  status: "enabled",
  streets: geofabrik("europe/poland/pomorskie"),
  feeds: {
    static: [
      {
        id: "zim",
        url: "https://data.odt.org.pl/gtfs/slupsk-gtfs.zip",
        agencies: [
          {
            slug: "zim-slupsk",
            feedAgencyId: "ZIM",
            name: "Zarząd Infrastruktury Miejskiej w Słupsku",
          },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
