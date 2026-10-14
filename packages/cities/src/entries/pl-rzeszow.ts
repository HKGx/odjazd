import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3). Service is defined purely
// by calendar_dates.txt (no calendar.txt). The only realtime feed is
// trip_updates without vehicle positions, which the server cannot resolve to
// map vehicles, so the city is static-only for now. The PKS regional feed is
// omitted: only the first static feed per city is ingested. The feed ships
// GTFS-Fares v2 files, currently unused by the compiler.

// Reuse is free under Gmina Miasto Rzeszów's statutory PSI terms (2021 Open
// Data Act): name the source, give source link and acquisition time, note
// processing, reproduce the non-liability disclaimer.
const license = {
  spdx: "custom",
  url: "https://bip.erzeszow.pl/pl/319-informacja-publiczna-ponowne-wykorzystywanie-informacji-sektora-publicznego/4570-zasady-dostepu-do-informacji-publicznej.html",
  attribution: "Dane: ZTM Rzeszów",
  sourceUrl:
    "https://bip.erzeszow.pl/pl/319-informacja-publiczna-ponowne-wykorzystywanie-informacji-sektora-publicznego/4570-zasady-dostepu-do-informacji-publicznej.html",
};

export const plRzeszow: typeof CatalogEntry.Encoded = {
  id: "pl-rzeszow",
  name: { pl: "Rzeszów", en: "Rzeszów" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-01 feed, padded slightly.
  bbox: { south: 49.89, west: 21.78, north: 50.15, east: 22.26 },
  center: { lat: 50.0412, lon: 21.9991 },
  status: "enabled",
  streets: geofabrik("europe/poland/podkarpackie"),
  feeds: {
    static: [
      {
        id: "rtm",
        url: "https://www.mpkrzeszow.pl/gtfs/latest.zip",
        agencies: [
          { slug: "rtm-rzeszow", feedAgencyId: "1", name: "Rzeszowski Transport Miejski" },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
