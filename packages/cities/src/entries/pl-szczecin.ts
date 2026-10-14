import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Single-operator feed where agency.txt has no
// agency_id column and routes leave it empty (mapped as ""). Trams are
// route_type 0, buses 3; RT trip_ids match static verbatim (8/8 vehicles,
// 27/27 trip updates). feed_info carries no validity dates; service comes
// from calendar.txt plus calendar_dates.txt.

const license = {
  spdx: "CC0-1.0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution: "Dane: ZDiTM Szczecin",
  sourceUrl: "https://www.zditm.szczecin.pl/pl/zditm/dla-programistow/gtfs",
};

const endpoint = "https://www.zditm.szczecin.pl/storage/gtfs";

export const plSzczecin: typeof CatalogEntry.Encoded = {
  id: "pl-szczecin",
  name: { pl: "Szczecin", en: "Szczecin" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-09-28 feed, padded slightly.
  bbox: { south: 53.26, west: 14.29, north: 53.62, east: 14.8 },
  center: { lat: 53.4285, lon: 14.5528 },
  status: "enabled",
  streets: geofabrik("europe/poland/zachodniopomorskie"),
  feeds: {
    static: [
      {
        id: "zditm",
        url: `${endpoint}/gtfs.zip`,
        agencies: [{ slug: "zditm-szczecin", feedAgencyId: "", name: "ZDiTM Szczecin" }],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [
      {
        id: "zditm-trip-updates",
        type: "trip_updates",
        url: `${endpoint}/gtfs-rt-trips.pb`,
        staticFeed: "zditm",
        pollIntervalSeconds: 10,
        license,
      },
      {
        id: "zditm-vehicle-positions",
        type: "vehicle_positions",
        url: `${endpoint}/gtfs-rt-vehicles.pb`,
        staticFeed: "zditm",
        pollIntervalSeconds: 10,
        license,
      },
      {
        id: "zditm-alerts",
        type: "alerts",
        url: `${endpoint}/gtfs-rt-alerts.pb`,
        staticFeed: "zditm",
        pollIntervalSeconds: 60,
        license,
      },
    ],
  },
};
