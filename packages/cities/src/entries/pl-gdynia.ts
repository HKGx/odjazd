import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Extended route types: 700-family buses, 800
// trolleybuses (both supported by the compiler). Eight ZKM agency rows share
// one name; two (10, 11) back no routes but are mapped anyway. A few public
// numbers repeat across agencies and stay separate lines via the agency
// qualifier. Service is defined purely by ~277k calendar_dates rows (no
// calendar.txt, no feed_info.txt). The plain-http URL 301-redirects to https.

const license = {
  spdx: "CC-BY-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Dane: ZKM Gdynia",
  sourceUrl:
    "https://otwartedane.gdynia.pl/pl/dataset/informacje-o-rozkladach-jazdy-i-lokalizacji-przystankow",
};

export const plGdynia: typeof CatalogEntry.Encoded = {
  id: "pl-gdynia",
  name: { pl: "Gdynia", en: "Gdynia" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-14 feed, padded slightly.
  bbox: { south: 54.32, west: 18.19, north: 54.66, east: 18.61 },
  center: { lat: 54.5189, lon: 18.5305 },
  status: "enabled",
  streets: geofabrik("europe/poland/pomorskie"),
  feeds: {
    static: [
      {
        id: "zkm",
        url: "http://api.zdiz.gdynia.pl/pt/gtfs.zip",
        agencies: [
          { slug: "zkm-gdynia-5", feedAgencyId: "5", name: "ZKM Gdynia" },
          { slug: "zkm-gdynia-6", feedAgencyId: "6", name: "ZKM Gdynia" },
          { slug: "zkm-gdynia-7", feedAgencyId: "7", name: "ZKM Gdynia" },
          { slug: "zkm-gdynia-8", feedAgencyId: "8", name: "ZKM Gdynia" },
          { slug: "zkm-gdynia-9", feedAgencyId: "9", name: "ZKM Gdynia" },
          { slug: "zkm-gdynia-10", feedAgencyId: "10", name: "ZKM Gdynia" },
          { slug: "zkm-gdynia-11", feedAgencyId: "11", name: "ZKM Gdynia" },
          { slug: "zkm-gdynia-17", feedAgencyId: "17", name: "ZKM Gdynia" },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
