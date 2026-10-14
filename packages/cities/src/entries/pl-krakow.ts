import type { CatalogEntry } from "../schema.ts";
import { geofabrik } from "./osm.ts";

// Verified 2026-10-15. Trams are route_type 0, buses 3; trip_ids are
// `<trip>_<service>` (e.g. `53629911_256159`) and match RT verbatim (28/28
// vehicles, 41/41 trip updates). The ServiceAlerts feed was published but
// empty (233 B header only).
//
// TODO(license): ZTP states no reuse terms anywhere — the GTFS host is a bare
// file listing, ztp.krakow.pl/dane-otwarte links only map apps, and ODT lists
// no license. Added on the assumption of statutory PSI reuse; replace with
// the real grant if ZTP publishes one.

const license = {
  spdx: "unknown",
  url: "https://odt.org.pl/pl/data/feeds/9",
  attribution: "Dane: ZTP Kraków",
  sourceUrl: "https://odt.org.pl/pl/data/feeds/9",
};

const endpoint = "https://gtfs.ztp.krakow.pl";

export const plKrakow: typeof CatalogEntry.Encoded = {
  id: "pl-krakow",
  name: { pl: "Kraków", en: "Kraków" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-12 feed, padded slightly.
  bbox: { south: 49.88, west: 19.56, north: 50.27, east: 20.38 },
  center: { lat: 50.0647, lon: 19.945 },
  status: "enabled",
  streets: geofabrik("europe/poland/malopolskie"),
  feeds: {
    static: [
      {
        id: "ztp",
        url: `${endpoint}/GTFS_KRK.zip`,
        agencies: [
          {
            slug: "ztp-krakow",
            feedAgencyId: "302",
            name: "Zarząd Transportu Publicznego w Krakowie",
          },
        ],
        checkIntervalSeconds: 6 * 3600,
        license,
      },
    ],
    realtime: [
      {
        id: "ztp-trip-updates",
        type: "trip_updates",
        url: `${endpoint}/TripUpdates.pb`,
        staticFeed: "ztp",
        pollIntervalSeconds: 20,
        license,
      },
      {
        id: "ztp-vehicle-positions",
        type: "vehicle_positions",
        url: `${endpoint}/VehiclePositions.pb`,
        staticFeed: "ztp",
        pollIntervalSeconds: 20,
        license,
      },
      {
        id: "ztp-alerts",
        type: "alerts",
        url: `${endpoint}/ServiceAlerts.pb`,
        staticFeed: "ztp",
        pollIntervalSeconds: 20,
        license,
      },
    ],
  },
};
