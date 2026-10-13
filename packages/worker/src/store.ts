import type { CityId } from "@odjazd/model";
import { Context, Effect, Layer, Option } from "effect";

/**
 * Device copy of each city's last manifest and timetable, so the app works
 * offline. Storage failures degrade to "nothing stored": they are logged and
 * never fail a load that the network can serve.
 */
export class TimetableStore extends Context.Service<
  TimetableStore,
  {
    readonly manifest: (city: CityId) => Effect.Effect<Option.Option<unknown>>;
    readonly saveManifest: (city: CityId, encoded: unknown) => Effect.Effect<void>;
    readonly feed: (city: CityId, hash: string) => Effect.Effect<Option.Option<Uint8Array>>;
    /** Stores `bytes` and drops the city's other timetables. */
    readonly saveFeed: (city: CityId, hash: string, bytes: Uint8Array) => Effect.Effect<void>;
  }
>()("@odjazd/worker/store/TimetableStore") {
  /** Cache Storage, one cache per city (`odjazd-<city>`). */
  static readonly cacheStorage = Layer.sync(TimetableStore, () => {
    const open = (city: CityId) => Effect.tryPromise(() => caches.open(`odjazd-${city}`));
    const manifestKey = "/odjazd/manifest.json";
    const feedKey = (hash: string) => `/odjazd/feeds/${hash}.bin`;
    const quietly =
      <A>(label: string, fallback: A) =>
      <E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`timetable store: ${label} failed`, cause).pipe(Effect.as(fallback)),
          ),
        );

    return TimetableStore.of({
      manifest: (city) =>
        open(city).pipe(
          Effect.flatMap((cache) => Effect.tryPromise(() => cache.match(manifestKey))),
          Effect.flatMap((response) =>
            response === undefined
              ? Effect.succeedNone
              : Effect.tryPromise(() => response.json() as Promise<unknown>).pipe(Effect.asSome),
          ),
          quietly("reading the manifest", Option.none()),
        ),
      saveManifest: (city, encoded) =>
        open(city).pipe(
          Effect.flatMap((cache) =>
            Effect.tryPromise(() =>
              cache.put(
                manifestKey,
                new Response(JSON.stringify(encoded), {
                  headers: { "content-type": "application/json" },
                }),
              ),
            ),
          ),
          quietly<void>("saving the manifest", undefined),
        ),
      feed: (city, hash) =>
        open(city).pipe(
          Effect.flatMap((cache) => Effect.tryPromise(() => cache.match(feedKey(hash)))),
          Effect.flatMap((response) =>
            response === undefined
              ? Effect.succeedNone
              : Effect.tryPromise(() => response.arrayBuffer()).pipe(
                  Effect.map((buffer) => Option.some(new Uint8Array(buffer))),
                ),
          ),
          quietly("reading a timetable", Option.none()),
        ),
      saveFeed: (city, hash, bytes) =>
        open(city).pipe(
          Effect.flatMap((cache) =>
            Effect.tryPromise(async () => {
              await cache.put(feedKey(hash), new Response(bytes.slice()));
              for (const request of await cache.keys()) {
                const path = new URL(request.url).pathname;
                if (path.startsWith("/odjazd/feeds/") && path !== feedKey(hash)) {
                  await cache.delete(request);
                }
              }
            }),
          ),
          quietly<void>("saving a timetable", undefined),
        ),
    });
  });

  /** In-memory store, for tests and environments without Cache Storage. */
  static readonly memory = Layer.sync(TimetableStore, () => {
    const manifests = new Map<CityId, unknown>();
    const feeds = new Map<CityId, { hash: string; bytes: Uint8Array }>();
    return TimetableStore.of({
      manifest: (city) => Effect.sync(() => Option.fromNullishOr(manifests.get(city))),
      saveManifest: (city, encoded) => Effect.sync(() => void manifests.set(city, encoded)),
      feed: (city, hash) =>
        Effect.sync(() => {
          const stored = feeds.get(city);
          return stored?.hash === hash ? Option.some(stored.bytes) : Option.none();
        }),
      saveFeed: (city, hash, bytes) => Effect.sync(() => void feeds.set(city, { hash, bytes })),
    });
  });
}
