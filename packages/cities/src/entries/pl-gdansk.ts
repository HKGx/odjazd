import type { CatalogEntry } from "../schema.ts";

// Verified 2026-10-14. The static feed is republished daily (around 05:00) and
// covers about two weeks ahead. RT lives on ckan2 (both protocols answer; the
// published links say http). Trams are route_type 900, buses 700.

const license = {
  spdx: "CC-BY-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Dane: ZTM w Gdańsku, CC BY 4.0",
  sourceUrl: "https://ckan.multimediagdansk.pl/dataset/c24aa637-3619-4dc2-a171-a23eec8f2172",
};

const dataset =
  "https://ckan.multimediagdansk.pl/dataset/c24aa637-3619-4dc2-a171-a23eec8f2172/resource";
const realtime = "https://ckan2.multimediagdansk.pl/gtfs-rt";

export const plGdansk: typeof CatalogEntry.Encoded = {
  id: "pl-gdansk",
  name: { pl: "Gdańsk", en: "Gdańsk" },
  country: "PL",
  timezone: "Europe/Warsaw",
  // Stop extent of the 2026-10-14 feed, padded slightly.
  bbox: { south: 54.22, west: 18.33, north: 54.49, east: 18.96 },
  center: { lat: 54.352, lon: 18.6466 },
  status: "enabled",
  feeds: {
    static: [
      {
        id: "ztm",
        url: `${dataset}/30e783e4-2bec-4a7d-bb22-ee3e3b26ca96/download/gtfsgoogle.zip`,
        agencies: [
          { slug: "ztm-gdansk", feedAgencyId: "0", name: "Zarząd Transportu Miejskiego w Gdańsku" },
        ],
        checkIntervalSeconds: 3600,
        license,
      },
    ],
    realtime: [
      {
        id: "ztm-trip-updates",
        type: "trip_updates",
        url: `${realtime}?feed=tripUpdates`,
        staticFeed: "ztm",
        pollIntervalSeconds: 20,
        license,
      },
      {
        id: "ztm-vehicle-positions",
        type: "vehicle_positions",
        url: `${realtime}?feed=vehiclePositions`,
        staticFeed: "ztm",
        pollIntervalSeconds: 20,
        license,
      },
    ],
  },
};
