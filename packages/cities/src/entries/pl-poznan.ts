import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. The static feed is republished near-daily (yesterday's
// file went up around 10:30), each archive covering roughly two weeks ahead.
// RT refreshes on a ~25 s grid. Trams are route_type 0, buses 3; every
// route_short_name is unique across the feed's 13 operators. RT trip_ids carry
// a trailing "+" variant marker (e.g. `1_3898264^+`) matching trips.txt
// verbatim; night-bus trips past midnight may reference the previous day's
// archive, so some live trips resolve by line label only.

// Reuse is free with attribution of the source, last update and processing,
// per the developer portal's terms (no SPDX identifier stated).
const license = {
  spdx: "custom",
  url: "https://www.ztm.poznan.pl/otwarte-dane/dla-deweloperow/",
  attribution: "Dane: ZTM w Poznaniu",
  sourceUrl: "https://www.ztm.poznan.pl/otwarte-dane/gtfsfiles/",
};

const portal = "https://www.ztm.poznan.pl/pl/dla-deweloperow";

export const plPoznan: typeof CatalogEntry.Encoded = {
  id: "pl-poznan",
  name: { pl: "Poznań", en: "Poznań" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-15 feed, padded slightly.
  bbox: { south: 52.13, west: 16.43, north: 52.61, east: 17.31 },
  center: { lat: 52.4064, lon: 16.9252 },
  status: "enabled",
  streets: geofabrik("europe/poland/wielkopolskie"),
  feeds: {
    static: [
      {
        id: "ztm",
        url: `${portal}/getGTFSFile`,
        agencies: [
          { slug: "mpk-poznan", feedAgencyId: "2", name: "MPK Poznań" },
          { slug: "kombus", feedAgencyId: "4", name: "KOMBUS Kórnik" },
          { slug: "transkom", feedAgencyId: "5", name: "TRANSKOM" },
          { slug: "translub", feedAgencyId: "6", name: "Translub" },
          { slug: "puk-komorniki", feedAgencyId: "7", name: "PUK Komorniki" },
          { slug: "rokbus", feedAgencyId: "8", name: "ROKBUS" },
          { slug: "zkp-suchy-las", feedAgencyId: "9", name: "ZKP Suchy Las" },
          { slug: "tpbus", feedAgencyId: "10", name: "TPBUS Tarnowo Podgórne" },
          { slug: "spk-swarzedz", feedAgencyId: "11", name: "SPK Swarzędz" },
          { slug: "zk-kleszczewo", feedAgencyId: "12", name: "ZK Kleszczewo" },
          { slug: "ug-dopiewo", feedAgencyId: "14", name: "UG Dopiewo" },
          { slug: "puk-mosina", feedAgencyId: "15", name: "PUK Mosina" },
          { slug: "pks-poznan", feedAgencyId: "16", name: "PKS Poznań" },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [
      {
        id: "ztm-trip-updates",
        type: "trip_updates",
        url: `${portal}/getGtfsRtFile/?file=trip_updates.pb`,
        staticFeed: "ztm",
        pollIntervalSeconds: 25,
        license,
      },
      {
        id: "ztm-vehicle-positions",
        type: "vehicle_positions",
        url: `${portal}/getGtfsRtFile/?file=vehicle_positions.pb`,
        staticFeed: "ztm",
        pollIntervalSeconds: 25,
        license,
      },
    ],
  },
};
