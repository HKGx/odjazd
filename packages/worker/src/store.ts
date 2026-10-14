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
    readonly streets: (city: CityId, hash: string) => Effect.Effect<Option.Option<Uint8Array>>;
    /** Stores `bytes` and drops the city's other street networks. */
    readonly saveStreets: (city: CityId, hash: string, bytes: Uint8Array) => Effect.Effect<void>;
  }
>()("@odjazd/worker/store/TimetableStore") {
  /** Cache Storage, one cache per city (`odjazd-<city>`). */
  static readonly cacheStorage = Layer.sync(TimetableStore, () => {
    const open = (city: CityId) => Effect.tryPromise(() => caches.open(`odjazd-${city}`));
    const manifestKey = "/odjazd/manifest.json";
    const feedKey = (hash: string) => `/odjazd/feeds/${hash}.bin`;
    const streetsKey = (hash: string) => `/odjazd/streets/${hash}.walk`;
    const quietly =
      <A>(label: string, fallback: A) =>
      <E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`timetable store: ${label} failed`, cause).pipe(Effect.as(fallback)),
          ),
        );

    const read = (city: CityId, key: string, label: string) =>
      open(city).pipe(
        Effect.flatMap((cache) => Effect.tryPromise(() => cache.match(key))),
        Effect.flatMap((response) =>
          response === undefined
            ? Effect.succeedNone
            : Effect.tryPromise(() => response.arrayBuffer()).pipe(
                Effect.map((buffer) => Option.some(new Uint8Array(buffer))),
              ),
        ),
        quietly(label, Option.none()),
      );
    /** Puts `bytes` at `key` and drops the city's other files under `prefix`. */
    const save = (city: CityId, prefix: string, key: string, bytes: Uint8Array, label: string) =>
      open(city).pipe(
        Effect.flatMap((cache) =>
          Effect.tryPromise(async () => {
            await cache.put(key, new Response(bytes.slice()));
            for (const request of await cache.keys()) {
              const path = new URL(request.url).pathname;
              if (path.startsWith(prefix) && path !== key) await cache.delete(request);
            }
          }),
        ),
        quietly<void>(label, undefined),
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
      feed: (city, hash) => read(city, feedKey(hash), "reading a timetable"),
      saveFeed: (city, hash, bytes) =>
        save(city, "/odjazd/feeds/", feedKey(hash), bytes, "saving a timetable"),
      streets: (city, hash) => read(city, streetsKey(hash), "reading the street network"),
      saveStreets: (city, hash, bytes) =>
        save(city, "/odjazd/streets/", streetsKey(hash), bytes, "saving the street network"),
    });
  });

  /** In-memory store, for tests and environments without Cache Storage. */
  static readonly memory = Layer.sync(TimetableStore, () => {
    const manifests = new Map<CityId, unknown>();
    const feeds = new Map<CityId, { hash: string; bytes: Uint8Array }>();
    const streets = new Map<CityId, { hash: string; bytes: Uint8Array }>();
    return TimetableStore.of({
      manifest: (city) => Effect.sync(() => Option.fromNullishOr(manifests.get(city))),
      saveManifest: (city, encoded) => Effect.sync(() => void manifests.set(city, encoded)),
      feed: (city, hash) =>
        Effect.sync(() => {
          const stored = feeds.get(city);
          return stored?.hash === hash ? Option.some(stored.bytes) : Option.none();
        }),
      saveFeed: (city, hash, bytes) => Effect.sync(() => void feeds.set(city, { hash, bytes })),
      streets: (city, hash) =>
        Effect.sync(() => {
          const stored = streets.get(city);
          return stored?.hash === hash ? Option.some(stored.bytes) : Option.none();
        }),
      saveStreets: (city, hash, bytes) =>
        Effect.sync(() => void streets.set(city, { hash, bytes })),
    });
  });
}
