import { type CitySummary, OdjazdApi } from "@odjazd/api";
import type { CatalogEntry } from "@odjazd/cities";
import { Effect, FileSystem, Option } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";
import { Publisher } from "./publisher.ts";
import { Realtime } from "./realtime/service.ts";

export const citiesHandlers = (entries: ReadonlyArray<CatalogEntry>) =>
  HttpApiBuilder.group(
    OdjazdApi,
    "cities",
    Effect.fn(function* (handlers) {
      const publisher = yield* Publisher;
      return handlers
        .handle("list", () =>
          Effect.gen(function* () {
            const cities: Array<CitySummary> = [];
            for (const entry of entries) {
              const manifest = yield* publisher.manifest(entry.id);
              const bytes = Option.map(
                manifest,
                (m) =>
                  (m.timetable.compressedBytes ?? m.timetable.bytes) +
                  (m.streets === undefined ? 0 : (m.streets.compressedBytes ?? m.streets.bytes)),
              );
              cities.push({
                id: entry.id,
                name: entry.name,
                country: entry.country,
                status: entry.status,
                timezone: entry.timezone,
                bbox: entry.bbox,
                center: entry.center,
                ...(Option.isSome(bytes) ? { downloadBytes: bytes.value } : {}),
                realtime: entry.feeds.realtime.map((feed) => feed.type),
                attribution: [
                  ...entry.feeds.static.map((feed) => feed.license),
                  ...(entry.streets === undefined ? [] : [entry.streets.license]),
                ],
              });
            }
            return { cities };
          }),
        )
        .handle("manifest", ({ params }) =>
          Effect.gen(function* () {
            const manifest = yield* publisher.manifest(params.city);
            if (Option.isSome(manifest)) return manifest.value;
            // A city we serve but haven't compiled yet (a fresh server): ask to come back.
            return yield* entries.some((entry) => entry.id === params.city)
              ? HttpApiError.ServiceUnavailable.make({})
              : HttpApiError.NotFound.make({});
          }),
        );
    }),
  );

export const feedsHandlers = HttpApiBuilder.group(
  OdjazdApi,
  "feeds",
  Effect.fn(function* (handlers) {
    const publisher = yield* Publisher;
    const fs = yield* FileSystem.FileSystem;
    return handlers.handle("timetable", ({ params }) =>
      Effect.gen(function* () {
        const file = publisher.feedFile(params.file);
        if (Option.isNone(file)) return yield* HttpApiError.NotFound.make({});
        const body = yield* fs
          .readFile(file.value)
          .pipe(Effect.mapError(() => HttpApiError.NotFound.make({})));
        return HttpServerResponse.uint8Array(body, {
          contentType: "application/octet-stream",
          headers: {
            "content-encoding": "gzip",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }),
    );
  }),
);

export const realtimeHandlers = HttpApiBuilder.group(
  OdjazdApi,
  "realtime",
  Effect.fn(function* (handlers) {
    const realtime = yield* Realtime;
    return handlers
      .handle("snapshot", ({ params }) =>
        realtime.snapshot(params.city).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(HttpApiError.NotFound.make({})),
              onSome: Effect.succeed,
            }),
          ),
        ),
      )
      .handle("stream", ({ params }) =>
        Effect.fromOption(realtime.events(params.city)).pipe(
          Effect.mapError(() => HttpApiError.NotFound.make({})),
        ),
      );
  }),
);
