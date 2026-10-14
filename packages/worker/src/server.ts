import { CityManifest, OdjazdApi } from "@odjazd/api";
import type { CityId } from "@odjazd/model";
import { decodeTimetable } from "@odjazd/timetable";
import { decodeWalkGraph, makeWalkNetwork } from "@odjazd/walk";
import type { Vehicle } from "@odjazd/api";
import { Clock, Effect, Option, Ref, Schedule, Schema, Stream, SubscriptionRef } from "effect";
import { HttpApiClient } from "effect/http-api";
import { makeHost, type Host } from "./host.ts";
import { TimetableRpcs } from "./rpc.ts";
import {
  type LiveDto,
  type LoadResult,
  TimetableNotLoaded,
  TimetableUnavailable,
} from "./schema.ts";
import { TimetableStore } from "./store.ts";

const lastDate = (first: string, count: number) =>
  new Date(Date.parse(`${first}T00:00:00Z`) + (count - 1) * 86_400_000).toISOString().slice(0, 10);

const unavailable = (message: string) => TimetableUnavailable.make({ message });

/** Worker-side handlers: owns the decoded timetables, one per city. */
export const handlersLayer = (options: { readonly baseUrl?: string | undefined }) =>
  TimetableRpcs.toLayer(
    Effect.gen(function* () {
      const api = yield* HttpApiClient.make(
        OdjazdApi,
        options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl },
      );
      const store = yield* TimetableStore;
      const loaded = yield* Ref.make(new Map<CityId, { hash: string; host: Host }>());
      const lives = new Map<CityId, SubscriptionRef.SubscriptionRef<LiveDto>>();

      const manifestFor = Effect.fn("Timetable.manifest")(function* (city: CityId) {
        // A 404 is definitive; a 503 means the server is still compiling the city's first
        // timetable (wait for it, unless the device has one); anything else (offline, server
        // down) falls back to the device copy.
        const ask = api.cities.manifest({ params: { city } }).pipe(
          Effect.map((manifest) => ({ _tag: "Found" as const, manifest })),
          Effect.catchTags({
            NotFound: () => Effect.succeed({ _tag: "Missing" as const }),
            ServiceUnavailable: () => Effect.succeed({ _tag: "Preparing" as const }),
          }),
          Effect.catch((error) =>
            Effect.logWarning("manifest: network unavailable, trying the device copy", error).pipe(
              Effect.as({ _tag: "Offline" as const }),
            ),
          ),
        );
        let fresh = yield* ask;
        for (let attempt = 0; fresh._tag === "Preparing"; attempt++) {
          if (Option.isSome(yield* store.manifest(city))) {
            fresh = { _tag: "Offline" as const };
            break;
          }
          if (attempt >= 120) {
            return yield* unavailable("The server is still preparing this city; try again later.");
          }
          yield* Effect.sleep("5 seconds");
          fresh = yield* ask;
        }
        if (fresh._tag === "Missing") {
          return yield* unavailable(`No timetable is published for ${city} yet.`);
        }
        if (fresh._tag === "Found") {
          const encoded = yield* Schema.encodeEffect(CityManifest)(fresh.manifest).pipe(
            Effect.orDie,
          );
          yield* store.saveManifest(city, encoded);
          return { manifest: fresh.manifest, source: "network" as const };
        }
        const saved = yield* store.manifest(city);
        if (Option.isNone(saved)) {
          return yield* unavailable("Offline, and no timetable is saved on this device yet.");
        }
        const manifest = yield* Schema.decodeUnknownEffect(CityManifest)(saved.value).pipe(
          Effect.mapError(() => unavailable("The saved timetable is unreadable; go online once.")),
        );
        return { manifest, source: "cache" as const };
      });

      const feedFor = Effect.fn("Timetable.feed")(function* (city: CityId, manifest: CityManifest) {
        const { hash } = manifest.timetable;
        const saved = yield* store.feed(city, hash);
        if (Option.isSome(saved)) return saved.value;
        const bytes = yield* api.feeds
          .timetable({ params: { file: `${hash}.bin` } })
          .pipe(Effect.mapError(() => unavailable("Couldn't download the timetable.")));
        yield* store.saveFeed(city, hash, bytes);
        return bytes;
      });

      const scope = yield* Effect.scope;

      /** The street network, from the device or the network, into `host`; walks are estimated until then. */
      const streetsFor = Effect.fn("Timetable.streets")(function* (
        city: CityId,
        manifest: CityManifest,
        host: Host,
      ) {
        const file = manifest.streets;
        if (file === undefined) return;
        const saved = yield* store.streets(city, file.hash);
        let bytes: Uint8Array;
        if (Option.isSome(saved)) bytes = saved.value;
        else {
          bytes = yield* api.feeds.timetable({ params: { file: `${file.hash}.walk` } });
          yield* store.saveStreets(city, file.hash, bytes);
        }
        const graph = yield* Effect.try(() => decodeWalkGraph(bytes));
        host.setStreets(makeWalkNetwork(graph));
      });
      const streetsLoading = new WeakSet<Host>();

      const load = Effect.fn("Timetable.load")(function* (city: CityId) {
        const { manifest, source } = yield* manifestFor(city);
        const current = (yield* Ref.get(loaded)).get(city);
        let host = current?.hash === manifest.timetable.hash ? current.host : undefined;
        if (host === undefined) {
          const bytes = yield* feedFor(city, manifest);
          const timetable = yield* Effect.try({
            try: () => decodeTimetable(bytes),
            catch: (error) => unavailable(`The timetable file is unreadable: ${String(error)}`),
          });
          host = makeHost(timetable);
          const made = host;
          const live = lives.get(city);
          if (live !== undefined) {
            const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
            made.setLive((yield* SubscriptionRef.get(live)).vehicles, now);
          }
          yield* Ref.update(loaded, (map) =>
            new Map(map).set(city, { hash: manifest.timetable.hash, host: made }),
          );
        }
        if (!host.hasStreets() && !streetsLoading.has(host)) {
          const target = host;
          streetsLoading.add(target);
          yield* streetsFor(city, manifest, target).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("streets: unavailable, walks stay estimated", cause).pipe(
                Effect.andThen(Effect.sync(() => streetsLoading.delete(target))),
              ),
            ),
            Effect.forkIn(scope),
          );
        }
        const { timetable } = host;
        const result: LoadResult = {
          manifest,
          source,
          timeZone: timetable.timeZone,
          stats: {
            lines: timetable.lines.length,
            stops: timetable.stops.count,
            trips: timetable.trips.count,
          },
          firstDate: timetable.days.first,
          lastDate: lastDate(timetable.days.first, timetable.days.count) as LoadResult["lastDate"],
        };
        return result;
      });

      const hostFor = (hash: string) =>
        Effect.flatMap(Ref.get(loaded), (map) => {
          for (const entry of map.values())
            if (entry.hash === hash) return Effect.succeed(entry.host);
          return Effect.fail(TimetableNotLoaded.make({ hash }));
        });

      // One upstream SSE connection per city, shared by every Live subscriber.
      const liveFor = Effect.fn("Timetable.live")(function* (city: CityId) {
        const existing = lives.get(city);
        if (existing !== undefined) return existing;
        const state = yield* SubscriptionRef.make<LiveDto>({
          status: "connecting",
          fetchedAt: 0,
          vehicles: [],
        });
        lives.set(city, state);
        const vehicles = new Map<string, Vehicle>();

        const publish = (fetchedAt: number) =>
          Effect.gen(function* () {
            const list = [...vehicles.values()];
            const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
            (yield* Ref.get(loaded)).get(city)?.host.setLive(list, now);
            yield* SubscriptionRef.set(state, { status: "live", fetchedAt, vehicles: list });
          });

        const connect = api.realtime.stream({ params: { city } }).pipe(
          Effect.flatMap(
            Stream.runForEach((event) => {
              if (event._tag === "Snapshot") {
                vehicles.clear();
                for (const v of event.snapshot.vehicles) vehicles.set(v.id, v);
                return publish(event.snapshot.fetchedAt);
              }
              for (const id of event.removed) vehicles.delete(id);
              for (const v of event.upserts) vehicles.set(v.id, v);
              return publish(event.fetchedAt);
            }),
          ),
          Effect.catchCause((cause) => Effect.logWarning("live: connection lost", cause)),
          Effect.andThen(
            SubscriptionRef.update(state, (live) => ({ ...live, status: "offline" as const })),
          ),
        );
        yield* connect.pipe(
          Effect.repeat({ schedule: Schedule.spaced("5 seconds") }),
          Effect.forkIn(scope),
        );
        return state;
      });

      const withHost = <A>(hash: string, f: (host: Host) => A) => Effect.map(hostFor(hash), f);

      return TimetableRpcs.of({
        Load: ({ city }) => load(city),
        Compare: (query) => withHost(query.hash, (host) => host.compare(query)),
        Board: (query) => withHost(query.hash, (host) => host.board(query)),
        Search: (query) => withHost(query.hash, (host) => host.searchStops(query)),
        Stops: ({ hash }) => withHost(hash, (host) => host.allStops()),
        Nearby: (query) => withHost(query.hash, (host) => host.nearby(query)),
        Plan: (query) => withHost(query.hash, (host) => host.plan(query)),
        Section: (query) => withHost(query.hash, (host) => host.section(query)),
        SectionLines: (query) => withHost(query.hash, (host) => host.sectionLines(query)),
        RouteNow: (query) => withHost(query.hash, (host) => host.routeNow(query)),
        StopBoard: (query) => withHost(query.hash, (host) => host.stopBoard(query)),
        LineRoute: (query) =>
          withHost(query.hash, (host) => Option.fromUndefinedOr(host.lineRoute(query))),
        Trip: (query) => withHost(query.hash, (host) => Option.fromUndefinedOr(host.trip(query))),
        Live: ({ city }) => Stream.unwrap(Effect.map(liveFor(city), SubscriptionRef.changes)),
      });
    }),
  );
