import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Trams are route_type 0, buses 3; identical public
// numbers across variant route_ids merge into one line by design. Service
// uses per-trip calendar rows plus ~60k calendar_dates removals; the feed
// window is short (16 days).
//
// TODO(license): the operator states no reuse terms; the city BIP's statutory
// reuse page governs city-office publications, not necessarily MPK S.A. Added
// on the assumption of statutory PSI reuse.

const license = {
  spdx: "unknown",
  url: "https://odt.org.pl/pl/data/feeds/32",
  attribution: "Dane: MPK Częstochowa",
  sourceUrl: "https://odt.org.pl/pl/data/feeds/32",
};

export const plCzestochowa: typeof CatalogEntry.Encoded = {
  id: "pl-czestochowa",
  name: { pl: "Częstochowa", en: "Częstochowa" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-15 feed, padded slightly.
  bbox: { south: 50.71, west: 18.93, north: 50.91, east: 19.32 },
  center: { lat: 50.8118, lon: 19.1203 },
  status: "enabled",
  streets: geofabrik("europe/poland/slaskie"),
  feeds: {
    static: [
      {
        id: "mpk",
        url: "https://data.odt.org.pl/gtfs/czestochowa-gtfs.zip",
        agencies: [{ slug: "mpk-czestochowa", feedAgencyId: "1", name: "MPK Częstochowa" }],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [],
  },
};
