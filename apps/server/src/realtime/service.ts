import type { RealtimeEvent, RealtimeSnapshot, Vehicle } from "@odjazd/api";
import type { CatalogEntry, RealtimeFeed } from "@odjazd/cities";
import {
  decodeTripUpdates,
  decodeVehiclePositions,
  type RawFeed,
  type RawTripUpdate,
  type RawVehicle,
} from "@odjazd/ingest";
import type { CityId } from "@odjazd/model";
import { Clock, Context, Effect, Layer, Option, PubSub, Ref, Schedule, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { realtimeOverride } from "../config.ts";
import { Publisher } from "../publisher.ts";
import { diffVehicles, makeResolver, type Resolver, resolveVehicles } from "./resolve.ts";

interface CityFeed {
  readonly state: Ref.Ref<RealtimeSnapshot>;
  readonly events: PubSub.PubSub<RealtimeEvent>;
}

/**
 * Polls each city's GTFS-RT vehicle positions and trip updates, resolves them
 * against the published timetable and fans changes out to SSE subscribers.
 * The feeds send no CORS headers, so browsers can't poll them directly.
 */
export class Realtime extends Context.Service<
  Realtime,
  {
    readonly snapshot: (city: CityId) => Effect.Effect<Option.Option<RealtimeSnapshot>>;
    /** A `Snapshot` event, then a `Delta` per poll. */
    readonly events: (city: CityId) => Option.Option<Stream.Stream<RealtimeEvent>>;
  }
>()("@odjazd/server/realtime/service/Realtime") {
  static readonly layer = (entries: ReadonlyArray<CatalogEntry>) =>
    Layer.effect(
      Realtime,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const publisher = yield* Publisher;
        const cities = new Map<CityId, CityFeed>();

        for (const entry of entries) {
          const feedOf = Effect.fn("Realtime.feedOf")(function* (type: RealtimeFeed["type"]) {
            const feed = entry.feeds.realtime.find((f) => f.type === type);
            if (feed === undefined) return undefined;
            const override = yield* realtimeOverride(entry.id, feed.id);
            if (Option.isSome(override)) {
              yield* Effect.logInfo(`${entry.id}/${feed.id}: realtime URL override active`);
              return { ...feed, url: override.value };
            }
            return feed;
          });
          const positionsFeed = yield* feedOf("vehicle_positions");
          if (positionsFeed === undefined) continue;
          const updatesFeed = yield* feedOf("trip_updates");

          const state = yield* Ref.make<RealtimeSnapshot>({
            city: entry.id,
            feedAt: 0,
            fetchedAt: 0,
            vehicles: [],
          });
          const events = yield* PubSub.sliding<RealtimeEvent>(64);
          cities.set(entry.id, { state, events });

          // Conditional GETs: the portal sends Last-Modified, so unchanged polls cost a 304.
          const lastModified = new Map<string, string>();
          const fetchFeed = Effect.fn("Realtime.fetch")(function* (feed: RealtimeFeed) {
            const since = lastModified.get(feed.id);
            const request = HttpClientRequest.get(feed.url).pipe(
              since === undefined
                ? (r) => r
                : HttpClientRequest.setHeader("if-modified-since", since),
            );
            const response = yield* http.execute(request).pipe(Effect.timeout("10 seconds"));
            if (response.status === 304) return Option.none<Uint8Array>();
            if (response.status !== 200) {
              return yield* Effect.fail(`${feed.url} answered ${response.status}`);
            }
            const modified = response.headers["last-modified"];
            if (modified !== undefined) lastModified.set(feed.id, modified);
            return Option.some(new Uint8Array(yield* response.arrayBuffer));
          });

          let resolver: { readonly hash: string; readonly resolver: Resolver } | undefined;
          let positions: RawFeed<RawVehicle> | undefined;
          let updates: RawFeed<RawTripUpdate> | undefined;

          const poll = Effect.gen(function* () {
            const [freshPositions, freshUpdates] = yield* Effect.all(
              [
                fetchFeed(positionsFeed),
                updatesFeed === undefined
                  ? Effect.succeedNone
                  : fetchFeed(updatesFeed).pipe(
                      Effect.catch((error) =>
                        Effect.logWarning(`${entry.id}: trip updates failed`, error).pipe(
                          Effect.as(Option.none<Uint8Array>()),
                        ),
                      ),
                    ),
              ],
              { concurrency: 2 },
            );
            if (Option.isSome(freshPositions)) {
              positions = yield* Effect.try(() => decodeVehiclePositions(freshPositions.value));
            }
            if (Option.isSome(freshUpdates)) {
              updates = yield* Effect.try(() => decodeTripUpdates(freshUpdates.value));
            }

            const timetable = yield* publisher.timetable(entry.id);
            if (Option.isSome(timetable) && resolver?.hash !== timetable.value.hash) {
              resolver = {
                hash: timetable.value.hash,
                resolver: makeResolver(timetable.value.timetable),
              };
            }

            const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
            const before = yield* Ref.get(state);
            const previous = new Map(before.vehicles.map((v): [string, Vehicle] => [v.id, v]));
            const vehicles =
              positions === undefined
                ? []
                : resolveVehicles(resolver?.resolver, positions, updates, previous, now);
            const feedAt = Math.max(positions?.timestamp ?? 0, updates?.timestamp ?? 0);
            const { upserts, removed } = diffVehicles(previous, vehicles);
            yield* Ref.set(state, {
              city: entry.id,
              ...(resolver === undefined
                ? {}
                : { timetable: resolver.hash as RealtimeSnapshot["timetable"] & string }),
              feedAt,
              fetchedAt: now,
              vehicles,
            });
            // Published every poll, changed or not: doubles as the SSE keep-alive.
            yield* PubSub.publish(events, {
              _tag: "Delta",
              feedAt,
              fetchedAt: now,
              upserts,
              removed,
            });
          });

          yield* poll.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`${entry.id}: realtime poll failed`, cause),
            ),
            Effect.repeat({
              schedule: Schedule.spaced(`${positionsFeed.pollIntervalSeconds} seconds`),
            }),
            Effect.forkScoped,
          );
        }

        return Realtime.of({
          snapshot: (city) => {
            const feed = cities.get(city);
            return feed === undefined ? Effect.succeedNone : Effect.asSome(Ref.get(feed.state));
          },
          events: (city) =>
            Option.map(Option.fromNullishOr(cities.get(city)), (feed) =>
              Stream.unwrap(
                Effect.gen(function* () {
                  // Subscribe before reading the snapshot so no delta falls in between.
                  const subscription = yield* PubSub.subscribe(feed.events);
                  const snapshot = yield* Ref.get(feed.state);
                  return Stream.make<[RealtimeEvent]>({ _tag: "Snapshot", snapshot }).pipe(
                    Stream.concat(Stream.fromSubscription(subscription)),
                  );
                }),
              ),
            ),
        });
      }),
    );
}
