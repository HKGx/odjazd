import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Static covers ZTM Warszawa plus Mazovian regional rail
// (WKD, Koleje Mazowieckie) as route_type 2 under agency 5; route_ids carry a
// day-variant prefix (`0_L10`), so identical public numbers across variants
// merge into one line by design. The feed window is short (~9 days) and the
// server sends no Last-Modified/ETag, so every check downloads the full
// ~66 MB archive. Realtime comes from the mkuran.pl mirror (no official ZTM
// GTFS-RT): its vehicle trip_ids (`2026-10-14:N25:PcS:191:2527`) don't match
// static trips, carry no route/stop info, and there is no trip_updates feed —
// live vehicles resolve position-only. Zbiorkom's trip_updates mirror states
// no license and is not used.

const staticLicense = {
  spdx: "custom",
  url: "https://www.ztm.waw.pl/pliki-do-pobrania/dane-rozkladowe/",
  attribution: "Dane: ZTM Warszawa",
  sourceUrl: "https://www.ztm.waw.pl/pliki-do-pobrania/dane-rozkladowe/",
};

// Warsaw Open Data Project terms (api.um.warszawa.pl): name the city, give the
// data download date and link the portal.
const realtimeLicense = {
  spdx: "custom",
  url: "https://api.um.warszawa.pl/",
  attribution: "Miasto Stołeczne Warszawa (api.um.warszawa.pl)",
  sourceUrl: "https://mkuran.pl/gtfs/",
};

const realtime = "https://mkuran.pl/gtfs/warsaw";

export const plWarszawa: typeof CatalogEntry.Encoded = {
  id: "pl-warszawa",
  name: { pl: "Warszawa", en: "Warszawa" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-14 feed, padded slightly.
  bbox: { south: 51.9, west: 20.56, north: 52.52, east: 21.49 },
  center: { lat: 52.2297, lon: 21.0122 },
  status: "enabled",
  streets: geofabrik("europe/poland/mazowieckie"),
  feeds: {
    static: [
      {
        id: "ztm",
        url: "https://gtfs.ztm.waw.pl/last",
        agencies: [
          { slug: "ztm-warszawa", feedAgencyId: "2", name: "ZTM Warszawa" },
          {
            slug: "mazowieckie",
            feedAgencyId: "5",
            name: "Marszałek Województwa Mazowieckiego",
          },
        ],
        checkIntervalSeconds: 6 * 3600,
        license: staticLicense,
      },
    ],
    realtime: [
      {
        id: "mkuran-vehicle-positions",
        type: "vehicle_positions",
        url: `${realtime}/vehicles.pb`,
        staticFeed: "ztm",
        pollIntervalSeconds: 30,
        license: realtimeLicense,
      },
      {
        id: "mkuran-alerts",
        type: "alerts",
        url: `${realtime}/alerts.pb`,
        staticFeed: "ztm",
        pollIntervalSeconds: 60,
        license: realtimeLicense,
      },
    ],
  },
};
