import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Buses only (route_type 3). All three RT feeds answered
// 200 but were empty (15 B header-only) with a ~13 min old header — plausible
// at 01:37 local when no service runs, so the trip linkage is unverified but
// the feed shape matches the working Kielce/Krosno vendor setup.
//
// TODO(license): the operator states no reuse terms anywhere (bare FTP
// listing, no developer page, ODT lists no license). Added on the assumption
// of statutory PSI reuse; replace with the real grant if MPK publishes one.

const license = {
  spdx: "unknown",
  url: "https://odt.org.pl/pl/data/feeds/29",
  attribution: "Dane: MPK Siedlce",
  sourceUrl: "https://odt.org.pl/pl/data/feeds/29",
};

const endpoint = "https://ftp.mpk.siedlce.pl";

export const plSiedlce: typeof CatalogEntry.Encoded = {
  id: "pl-siedlce",
  name: { pl: "Siedlce", en: "Siedlce" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-02 feed, padded slightly.
  bbox: { south: 52.04, west: 22.11, north: 52.29, east: 22.6 },
  center: { lat: 52.1679, lon: 22.2907 },
  status: "enabled",
  streets: geofabrik("europe/poland/mazowieckie"),
  feeds: {
    static: [
      {
        id: "mpk",
        url: `${endpoint}/GTFS-ST/GTFS.zip`,
        agencies: [
          {
            slug: "mpk-siedlce",
            feedAgencyId: "MPK",
            name: "Miejskie Przedsiębiorstwo Komunikacyjne w Siedlcach",
          },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [
      {
        id: "mpk-trip-updates",
        type: "trip_updates",
        url: `${endpoint}/GTFS-RT/trip_updates.bin`,
        staticFeed: "mpk",
        pollIntervalSeconds: 30,
        license,
      },
      {
        id: "mpk-vehicle-positions",
        type: "vehicle_positions",
        url: `${endpoint}/GTFS-RT/vehicle_positions.bin`,
        staticFeed: "mpk",
        pollIntervalSeconds: 30,
        license,
      },
      {
        id: "mpk-alerts",
        type: "alerts",
        url: `${endpoint}/GTFS-RT/alerts.bin`,
        staticFeed: "mpk",
        pollIntervalSeconds: 60,
        license,
      },
    ],
  },
};
