import type { CatalogEntry } from "../schema.ts";

type Streets = NonNullable<(typeof CatalogEntry.Encoded)["streets"]>;

/** Geofabrik's daily regional extract; a week between checks is plenty for walking. */
export const geofabrik = (region: string): Streets => ({
  url: `https://download.geofabrik.de/${region}-latest.osm.pbf`,
  checkIntervalSeconds: 7 * 86_400,
  license: {
    spdx: "ODbL-1.0",
    url: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "© OpenStreetMap contributors",
    sourceUrl: "https://www.openstreetmap.org/copyright",
  },
});
