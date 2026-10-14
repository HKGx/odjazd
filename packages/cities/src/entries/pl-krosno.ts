import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3). All three RT feeds answered
// 200 with fresh headers but were empty (15 B header-only) — plausible at
// 01:37 local when no service runs, so the trip linkage is unverified but the
// feed shape matches the working Kielce vendor setup.
//
// TODO(license): the operator states no reuse terms anywhere (GTFS announced
// only via a Google Maps news post, ODT lists no license). Added on the
// assumption of statutory PSI reuse; replace with the real grant if MKS
// publishes one.

const license = {
  spdx: "unknown",
  url: "https://odt.org.pl/pl/data/feeds/34",
  attribution: "Dane: MKS Krosno",
  sourceUrl: "https://odt.org.pl/pl/data/feeds/34",
};

const endpoint = "https://mks.ekrosno.pl";

export const plKrosno: typeof CatalogEntry.Encoded = {
  id: "pl-krosno",
  name: { pl: "Krosno", en: "Krosno" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-09-29 feed, padded slightly.
  bbox: { south: 49.6, west: 21.58, north: 49.85, east: 21.9 },
  center: { lat: 49.688, lon: 21.77 },
  status: "enabled",
  streets: geofabrik("europe/poland/podkarpackie"),
  feeds: {
    static: [
      {
        id: "mks",
        url: `${endpoint}/GTFS-ST/GTFS.zip`,
        agencies: [
          {
            slug: "mks-krosno",
            feedAgencyId: "MKS",
            name: "Miejska Komunikacja Samochodowa w Krośnie",
          },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [
      {
        id: "mks-trip-updates",
        type: "trip_updates",
        url: `${endpoint}/GTFS-RT/trip_updates.bin`,
        staticFeed: "mks",
        pollIntervalSeconds: 20,
        license,
      },
      {
        id: "mks-vehicle-positions",
        type: "vehicle_positions",
        url: `${endpoint}/GTFS-RT/vehicle_positions.bin`,
        staticFeed: "mks",
        pollIntervalSeconds: 20,
        license,
      },
      {
        id: "mks-alerts",
        type: "alerts",
        url: `${endpoint}/GTFS-RT/alerts.bin`,
        staticFeed: "mks",
        pollIntervalSeconds: 60,
        license,
      },
    ],
  },
};
