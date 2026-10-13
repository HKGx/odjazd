import { CityManifest } from "@odjazd/api";
import type { CityId } from "@odjazd/model";
import { decodeTimetable, type Timetable } from "@odjazd/timetable";
import { Schema } from "effect";

const decodeManifest = Schema.decodeUnknownSync(CityManifest);

export interface Loaded {
  readonly manifest: CityManifest;
  readonly timetable: Timetable;
  readonly source: "network" | "cache";
}

/**
 * Fetches the city's manifest and the timetable it names. Both are kept in
 * Cache Storage (one cache per city), so the app works offline with the last
 * timetable it saw. Timetables are content-addressed, so a cached one is never
 * stale for its hash; older hashes are dropped once a newer one is stored.
 */
export const loadCity = async (apiBase: string, city: CityId): Promise<Loaded> => {
  const cache = await caches.open(`odjazd-${city}`);
  const manifestUrl = new URL(`/api/cities/${city}/manifest`, apiBase).href;

  let manifestResponse: Response | undefined;
  let source: Loaded["source"] = "network";
  try {
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`manifest: HTTP ${response.status}`);
    manifestResponse = response;
  } catch (error) {
    manifestResponse = await cache.match(manifestUrl);
    if (manifestResponse === undefined) throw error;
    source = "cache";
  }
  const manifestJson: unknown = await manifestResponse.clone().json();
  const manifest = decodeManifest(manifestJson);

  const feedUrl = new URL(manifest.timetable.path, apiBase).href;
  let feed = await cache.match(feedUrl);
  if (feed === undefined) {
    const response = await fetch(feedUrl);
    if (!response.ok) throw new Error(`timetable: HTTP ${response.status}`);
    await cache.put(feedUrl, response.clone());
    feed = response;
  }
  const timetable = decodeTimetable(new Uint8Array(await feed.arrayBuffer()));

  if (source === "network") {
    await cache.put(manifestUrl, manifestResponse);
    for (const request of await cache.keys()) {
      if (request.url.includes("/api/feeds/") && request.url !== feedUrl) {
        await cache.delete(request);
      }
    }
  }
  return { manifest, timetable, source };
};
