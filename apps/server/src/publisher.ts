import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { CityManifest, type ContentHash, StreetsFile } from "@odjazd/api";
import type { CatalogEntry } from "@odjazd/cities";
import { ingestGtfsZip, walkGraphFromPbf } from "@odjazd/ingest";
import type { CityId } from "@odjazd/model";
import {
  decodeTimetable,
  encodeTimetable,
  TIMETABLE_FORMAT_VERSION,
  type Timetable,
} from "@odjazd/timetable";
import {
  computeFootpaths,
  decodeWalkGraph,
  encodeWalkGraph,
  makeWalkNetwork,
  WALK_FORMAT_VERSION,
  type WalkGraph,
} from "@odjazd/walk";
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
  Semaphore,
  Stream,
} from "effect";
import { HttpClient } from "effect/http";
import { dataDir, gtfsOverride, streetsOverride } from "./config.ts";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex") as ContentHash;

const ManifestJson = Schema.fromJsonString(CityManifest);
const StreetsJson = Schema.fromJsonString(StreetsFile);

/** The graph covers the city's box plus a margin, so walks near its edge still have streets. */
const marginDegrees = 0.015;
/** After a failed street build, wait this long before downloading the extract again. */
const streetsRetrySeconds = 6 * 3600;

interface Streets {
  readonly file: StreetsFile;
  readonly graph: WalkGraph;
}

/**
 * Compiles each ingested city's static feed into a content-addressed binary
 * timetable under `<data>/feeds/<hash>.bin.gz` and keeps the current manifest
 * per city in memory (and in `<data>/manifests/<city>.json` across restarts).
 * Cities with a street source also get a walk graph (`<hash>.walk.gz`), which
 * the timetable's footpaths are measured on.
 */
export class Publisher extends Context.Service<
  Publisher,
  {
    readonly manifest: (city: CityId) => Effect.Effect<Option.Option<CityManifest>>;
    /** The decoded timetable the current manifest names; realtime is resolved against it. */
    readonly timetable: (
      city: CityId,
    ) => Effect.Effect<Option.Option<{ readonly hash: string; readonly timetable: Timetable }>>;
    /** Path of a published `.bin.gz` or `.walk.gz`, if `file` names one. */
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
        const osmDir = path.join(root, "osm");
        yield* fs.makeDirectory(feedsDir, { recursive: true });
        yield* fs.makeDirectory(manifestsDir, { recursive: true });
        yield* fs.makeDirectory(osmDir, { recursive: true });

        const manifests = yield* Ref.make(new Map<CityId, CityManifest>());
        const timetables = yield* Ref.make(
          new Map<CityId, { readonly hash: string; readonly timetable: Timetable }>(),
        );
        const streets = yield* Ref.make(new Map<CityId, Streets>());
        const streetsFailedAt = new Map<CityId, number>();
        // One extract at a time: building a graph holds a region's nodes in memory.
        const oneBuild = yield* Semaphore.make(1);
        const store = (manifest: CityManifest, timetable: Timetable) =>
          Effect.andThen(
            Ref.update(manifests, (map) => new Map(map).set(manifest.cityId, manifest)),
            Ref.update(timetables, (map) =>
              new Map(map).set(manifest.cityId, { hash: manifest.timetable.hash, timetable }),
            ),
          );
        const streetsJsonFile = (city: CityId) => path.join(manifestsDir, `${city}.streets.json`);

        /** Writes `bytes` gzipped under its hash (once); returns hash and sizes. */
        const publish = (bytes: Uint8Array, extension: "bin" | "walk") =>
          Effect.gen(function* () {
            const hash = sha256(bytes);
            const target = path.join(feedsDir, `${hash}.${extension}.gz`);
            let compressedBytes: number;
            if (yield* fs.exists(target)) {
              compressedBytes = Number((yield* fs.stat(target)).size);
            } else {
              const compressed = gzipSync(bytes, { level: 9 });
              compressedBytes = compressed.length;
              yield* fs.writeFile(`${target}.tmp`, compressed);
              yield* fs.rename(`${target}.tmp`, target);
            }
            return { hash, bytes: bytes.length, compressedBytes };
          });

        // Last good state first, so a restart serves immediately.
        for (const entry of entries) {
          const savedStreets = yield* fs
            .readFileString(streetsJsonFile(entry.id))
            .pipe(Effect.flatMap(Schema.decodeEffect(StreetsJson)), Effect.option);
          if (Option.isSome(savedStreets)) {
            const graph = yield* fs
              .readFile(path.join(feedsDir, `${savedStreets.value.hash}.walk.gz`))
              .pipe(
                Effect.flatMap((gz) => Effect.try(() => decodeWalkGraph(gunzipSync(gz)))),
                Effect.option,
              );
            if (Option.isSome(graph)) {
              yield* Ref.update(streets, (map) =>
                new Map(map).set(entry.id, { file: savedStreets.value, graph: graph.value }),
              );
            }
          }

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

        /** The extract on disk (downloaded, or the local override) and its hash. */
        const fetchExtract = Effect.fn("Publisher.fetchExtract")(function* (
          entry: CatalogEntry,
          url: string,
        ) {
          const local = yield* streetsOverride(entry.id);
          const hash = createHash("sha256");
          if (Option.isSome(local)) {
            yield* fs
              .stream(local.value)
              .pipe(Stream.runForEach((chunk) => Effect.sync(() => hash.update(chunk))));
            return { file: local.value, temporary: false, hash: hash.digest("hex") as ContentHash };
          }
          // Geofabrik redirects `-latest` to the dated file.
          const response = yield* HttpClient.followRedirects(http).get(url);
          if (response.status !== 200)
            return yield* Effect.fail(`${url} answered ${response.status}`);
          const file = path.join(osmDir, `${entry.id}.osm.pbf.tmp`);
          yield* response.stream.pipe(
            Stream.tap((chunk) => Effect.sync(() => hash.update(chunk))),
            Stream.run(fs.sink(file)),
          );
          return { file, temporary: true, hash: hash.digest("hex") as ContentHash };
        });

        /** The city's walk graph, rebuilt when its extract changed (checked at the source's interval). */
        const refreshStreets = Effect.fn("Publisher.refreshStreets")(function* (
          entry: CatalogEntry,
        ) {
          const source = entry.streets;
          if (source === undefined) return undefined;
          const current = (yield* Ref.get(streets)).get(entry.id);
          const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
          if (
            current !== undefined &&
            current.file.formatVersion === WALK_FORMAT_VERSION &&
            now - current.file.checkedAt < source.checkIntervalSeconds
          ) {
            return current;
          }
          const failed = streetsFailedAt.get(entry.id);
          if (failed !== undefined && now - failed < streetsRetrySeconds) return current;

          const build = Effect.gen(function* () {
            const started = yield* Clock.currentTimeMillis;
            const extract = yield* fetchExtract(entry, source.url);
            const cleanup = extract.temporary
              ? fs.remove(extract.file).pipe(Effect.ignore)
              : Effect.void;
            if (
              current !== undefined &&
              current.file.sourceHash === extract.hash &&
              current.file.formatVersion === WALK_FORMAT_VERSION
            ) {
              yield* cleanup;
              const file = { ...current.file, checkedAt: now };
              yield* fs.writeFileString(
                streetsJsonFile(entry.id),
                yield* Schema.encodeEffect(StreetsJson)(file),
              );
              const next = { file, graph: current.graph };
              yield* Ref.update(streets, (map) => new Map(map).set(entry.id, next));
              yield* Effect.logDebug(`${entry.id}: street extract unchanged`);
              return next;
            }
            const { bbox } = entry;
            const graph = yield* Effect.tryPromise(() =>
              walkGraphFromPbf(
                createReadStream(extract.file, { highWaterMark: 1 << 20 }),
                entry.id,
                {
                  south: bbox.south - marginDegrees,
                  west: bbox.west - marginDegrees,
                  north: bbox.north + marginDegrees,
                  east: bbox.east + marginDegrees,
                },
              ),
            ).pipe(Effect.ensuring(cleanup));
            const published = yield* publish(encodeWalkGraph(graph), "walk");
            const file: StreetsFile = {
              ...published,
              path: `/api/feeds/${published.hash}.walk`,
              formatVersion: WALK_FORMAT_VERSION,
              ...(graph.osmTimestamp === undefined ? {} : { osmTimestamp: graph.osmTimestamp }),
              sourceHash: extract.hash,
              checkedAt: now,
            };
            yield* fs.writeFileString(
              streetsJsonFile(entry.id),
              yield* Schema.encodeEffect(StreetsJson)(file),
            );
            const next = { file, graph };
            yield* Ref.update(streets, (map) => new Map(map).set(entry.id, next));
            yield* Effect.logInfo(
              `${entry.id}: streets ${published.hash.slice(0, 12)} (${graph.nodes.count} nodes, ` +
                `${graph.edges.count} edges, ${(published.compressedBytes / 1e6).toFixed(1)} MB gz, ` +
                `${(yield* Clock.currentTimeMillis) - started} ms)`,
            );
            return next;
          });
          return yield* oneBuild.withPermit(build).pipe(
            Effect.tap(() => Effect.sync(() => streetsFailedAt.delete(entry.id))),
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                streetsFailedAt.set(entry.id, now);
                yield* Effect.logError(
                  `${entry.id}: street network failed; walks stay estimated`,
                  cause,
                );
                return current;
              }),
            ),
          );
        });

        const compile = Effect.fn("Publisher.compile")(function* (entry: CatalogEntry) {
          const feed = entry.feeds.static[0];
          if (feed === undefined) return;
          const network = yield* refreshStreets(entry);
          const zip = yield* download(entry);
          const sourceHash = sha256(zip);
          const current = (yield* Ref.get(manifests)).get(entry.id);
          if (
            current?.sourceHash === sourceHash &&
            current.timetable.formatVersion === TIMETABLE_FORMAT_VERSION &&
            current.timetable.streetsHash === network?.file.hash &&
            current.streets?.checkedAt === network?.file.checkedAt &&
            (yield* Ref.get(timetables)).get(entry.id)?.hash === current.timetable.hash
          ) {
            yield* Effect.logDebug(`${entry.id}: feed unchanged`);
            return;
          }

          const started = yield* Clock.currentTimeMillis;
          let timetable: Timetable;
          const reuse = (yield* Ref.get(timetables)).get(entry.id);
          if (
            current?.sourceHash === sourceHash &&
            current.timetable.formatVersion === TIMETABLE_FORMAT_VERSION &&
            current.timetable.streetsHash === network?.file.hash &&
            reuse !== undefined
          ) {
            // Only the streets check moved: same timetable, fresh manifest.
            timetable = reuse.timetable;
          } else {
            const ingested = (yield* ingestGtfsZip(zip, entry, feed)).timetable;
            timetable =
              network === undefined
                ? ingested
                : {
                    ...ingested,
                    footpaths: computeFootpaths(makeWalkNetwork(network.graph), ingested.stops),
                  };
          }
          const published = yield* publish(encodeTimetable(timetable), "bin");

          const manifest: CityManifest = {
            cityId: entry.id,
            timetable: {
              ...published,
              path: `/api/feeds/${published.hash}.bin`,
              formatVersion: TIMETABLE_FORMAT_VERSION,
              ...(timetable.feedVersion === undefined
                ? {}
                : { feedVersion: timetable.feedVersion }),
              firstDate: timetable.days.first,
              dayCount: timetable.days.count,
              ...(network === undefined ? {} : { streetsHash: network.file.hash }),
            },
            ...(network === undefined ? {} : { streets: network.file }),
            compiledAt: Math.floor((yield* Clock.currentTimeMillis) / 1000),
            sourceHash,
            attribution: [
              ...entry.feeds.static.map((f) => f.license),
              ...(network === undefined || entry.streets === undefined
                ? []
                : [entry.streets.license]),
            ],
          };
          const json = yield* Schema.encodeEffect(ManifestJson)(manifest);
          yield* fs.writeFileString(path.join(manifestsDir, `${entry.id}.json`), json);
          yield* store(manifest, timetable);
          yield* Effect.logInfo(
            `${entry.id}: published ${published.hash.slice(0, 12)} (${(published.compressedBytes / 1e6).toFixed(1)} MB gz, ` +
              `feed ${timetable.feedVersion ?? "?"}, ` +
              `${timetable.footpaths === undefined ? "no" : timetable.footpaths.to.length} footpaths, ` +
              `${(yield* Clock.currentTimeMillis) - started} ms)`,
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
            const match = /^([0-9a-f]{64})\.(bin|walk)$/.exec(file);
            return match === null
              ? Option.none()
              : Option.some(path.join(feedsDir, `${match[1]}.${match[2]}.gz`));
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
