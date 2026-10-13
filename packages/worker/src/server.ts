import { CityManifest, OdjazdApi } from "@odjazd/api";
import type { CityId } from "@odjazd/model";
import { decodeTimetable } from "@odjazd/timetable";
import { Effect, Option, Ref, Schema } from "effect";
import { HttpApiClient } from "effect/http-api";
import { makeHost, type Host } from "./host.ts";
import { TimetableRpcs } from "./rpc.ts";
import { type LoadResult, TimetableNotLoaded, TimetableUnavailable } from "./schema.ts";
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

      const manifestFor = Effect.fn("Timetable.manifest")(function* (city: CityId) {
        // A 404 is definitive; anything else (offline, server down) falls back to the device copy.
        const fresh = yield* api.cities.manifest({ params: { city } }).pipe(
          Effect.map((manifest) => ({ _tag: "Found" as const, manifest })),
          Effect.catchTag("NotFound", () => Effect.succeed({ _tag: "Missing" as const })),
          Effect.catch((error) =>
            Effect.logWarning("manifest: network unavailable, trying the device copy", error).pipe(
              Effect.as({ _tag: "Offline" as const }),
            ),
          ),
        );
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
          yield* Ref.update(loaded, (map) =>
            new Map(map).set(city, { hash: manifest.timetable.hash, host: made }),
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

      return TimetableRpcs.of({
        Load: ({ city }) => load(city),
        Compare: (query) => Effect.map(hostFor(query.hash), (host) => host.compare(query)),
        Board: (query) => Effect.map(hostFor(query.hash), (host) => host.board(query)),
      });
    }),
  );
