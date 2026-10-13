import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { CityManifest, type ContentHash } from "@odjazd/api";
import type { CatalogEntry } from "@odjazd/cities";
import { ingestGtfsZip } from "@odjazd/ingest";
import type { CityId } from "@odjazd/model";
import {
  decodeTimetable,
  encodeTimetable,
  TIMETABLE_FORMAT_VERSION,
  type Timetable,
} from "@odjazd/timetable";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Schedule,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { dataDir, gtfsOverride } from "./config.ts";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex") as ContentHash;

const ManifestJson = Schema.fromJsonString(CityManifest);

/**
 * Compiles each ingested city's static feed into a content-addressed binary
 * timetable under `<data>/feeds/<hash>.bin.gz` and keeps the current manifest
 * per city in memory (and in `<data>/manifests/<city>.json` across restarts).
 */
export class Publisher extends Context.Service<
  Publisher,
  {
    readonly manifest: (city: CityId) => Effect.Effect<Option.Option<CityManifest>>;
    /** The decoded timetable the current manifest names; realtime is resolved against it. */
    readonly timetable: (
      city: CityId,
    ) => Effect.Effect<Option.Option<{ readonly hash: string; readonly timetable: Timetable }>>;
    /** Path of a published `.bin.gz`, if `file` names one. */
    readonly feedFile: (file: string) => Option.Option<string>;
    readonly refresh: (entry: CatalogEntry) => Effect.Effect<void>;
  }
>()("@odjazd/server/publisher") {
  static readonly layer = (entries: ReadonlyArray<CatalogEntry>) =>
    Layer.effect(
      Publisher,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const http = yield* HttpClient.HttpClient;
        const root = path.resolve(yield* dataDir);
        const feedsDir = path.join(root, "feeds");
        const manifestsDir = path.join(root, "manifests");
        yield* fs.makeDirectory(feedsDir, { recursive: true });
        yield* fs.makeDirectory(manifestsDir, { recursive: true });

        const manifests = yield* Ref.make(new Map<CityId, CityManifest>());
        const timetables = yield* Ref.make(
          new Map<CityId, { readonly hash: string; readonly timetable: Timetable }>(),
        );
        const store = (manifest: CityManifest, timetable: Timetable) =>
          Effect.andThen(
            Ref.update(manifests, (map) => new Map(map).set(manifest.cityId, manifest)),
            Ref.update(timetables, (map) =>
              new Map(map).set(manifest.cityId, { hash: manifest.timetable.hash, timetable }),
            ),
          );

        // Last good manifests first, so a restart serves immediately.
        for (const entry of entries) {
          const file = path.join(manifestsDir, `${entry.id}.json`);
          const saved = yield* fs
            .readFileString(file)
            .pipe(Effect.flatMap(Schema.decodeEffect(ManifestJson)), Effect.option);
          if (Option.isNone(saved)) continue;
          const restored = yield* fs
            .readFile(path.join(feedsDir, `${saved.value.timetable.hash}.bin.gz`))
            .pipe(
              Effect.flatMap((gz) => Effect.try(() => decodeTimetable(gunzipSync(gz)))),
              Effect.option,
            );
          if (Option.isSome(restored)) yield* store(saved.value, restored.value);
        }

        const download = Effect.fn("Publisher.download")(function* (entry: CatalogEntry) {
          const local = yield* gtfsOverride(entry.id);
          if (Option.isSome(local)) return yield* fs.readFile(local.value);
          const feed = entry.feeds.static[0];
          if (feed === undefined) return yield* Effect.fail(`${entry.id} has no static feed`);
          const response = yield* http.get(feed.url);
          if (response.status !== 200) {
            return yield* Effect.fail(`${feed.url} answered ${response.status}`);
          }
          return new Uint8Array(yield* response.arrayBuffer);
        });

        const compile = Effect.fn("Publisher.compile")(function* (entry: CatalogEntry) {
          const feed = entry.feeds.static[0];
          if (feed === undefined) return;
          const zip = yield* download(entry);
          const sourceHash = sha256(zip);
          const current = (yield* Ref.get(manifests)).get(entry.id);
          if (
            current?.sourceHash === sourceHash &&
            current.timetable.formatVersion === TIMETABLE_FORMAT_VERSION &&
            (yield* Ref.get(timetables)).get(entry.id)?.hash === current.timetable.hash
          ) {
            yield* Effect.logDebug(`${entry.id}: feed unchanged`);
            return;
          }

          const started = yield* Clock.currentTimeMillis;
          const { timetable } = yield* ingestGtfsZip(zip, entry, feed);
          const bytes = encodeTimetable(timetable);
          const hash = sha256(bytes);
          const compressed = gzipSync(bytes, { level: 9 });
          const target = path.join(feedsDir, `${hash}.bin.gz`);
          if (!(yield* fs.exists(target))) {
            yield* fs.writeFile(`${target}.tmp`, compressed);
            yield* fs.rename(`${target}.tmp`, target);
          }

          const manifest: CityManifest = {
            cityId: entry.id,
            timetable: {
              hash,
              path: `/api/feeds/${hash}.bin`,
              bytes: bytes.length,
              compressedBytes: compressed.length,
              formatVersion: TIMETABLE_FORMAT_VERSION,
              ...(timetable.feedVersion === undefined
                ? {}
                : { feedVersion: timetable.feedVersion }),
              firstDate: timetable.days.first,
              dayCount: timetable.days.count,
            },
            compiledAt: Math.floor((yield* Clock.currentTimeMillis) / 1000),
            sourceHash,
            attribution: entry.feeds.static.map((f) => f.license),
          };
          const json = yield* Schema.encodeEffect(ManifestJson)(manifest);
          yield* fs.writeFileString(path.join(manifestsDir, `${entry.id}.json`), json);
          yield* store(manifest, timetable);
          yield* Effect.logInfo(
            `${entry.id}: published ${hash.slice(0, 12)} (${(compressed.length / 1e6).toFixed(1)} MB gz, ` +
              `feed ${timetable.feedVersion ?? "?"}, ${(yield* Clock.currentTimeMillis) - started} ms)`,
          );
        });

        const refresh = (entry: CatalogEntry) =>
          compile(entry).pipe(
            Effect.catchCause((cause) => Effect.logError(`${entry.id}: refresh failed`, cause)),
          );

        return Publisher.of({
          timetable: (city) =>
            Effect.map(Ref.get(timetables), (map) => Option.fromNullishOr(map.get(city))),
          manifest: (city) =>
            Effect.map(Ref.get(manifests), (map) => Option.fromNullishOr(map.get(city))),
          feedFile: (file) => {
            const match = /^([0-9a-f]{64})\.bin$/.exec(file);
            return match === null
              ? Option.none()
              : Option.some(path.join(feedsDir, `${match[1]}.bin.gz`));
          },
          refresh,
        });
      }),
    );

  /** Refreshes every city now, then on each city's check interval. */
  static readonly schedule = (entries: ReadonlyArray<CatalogEntry>) =>
    Layer.effectDiscard(
      Effect.gen(function* () {
        const publisher = yield* Publisher;
        for (const entry of entries) {
          const interval = entry.feeds.static[0]?.checkIntervalSeconds ?? 3600;
          yield* publisher
            .refresh(entry)
            .pipe(
              Effect.repeat({ schedule: Schedule.spaced(`${interval} seconds`) }),
              Effect.forkScoped,
            );
        }
      }),
    );
}
