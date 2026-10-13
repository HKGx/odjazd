import { type CitySummary, OdjazdApi } from "@odjazd/api";
import type { CatalogEntry } from "@odjazd/cities";
import { Effect, FileSystem, Option } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";
import { Publisher } from "./publisher.ts";

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
              const bytes = Option.flatMapNullishOr(
                manifest,
                (m) => m.timetable.compressedBytes ?? m.timetable.bytes,
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
                attribution: entry.feeds.static.map((feed) => feed.license),
              });
            }
            return { cities };
          }),
        )
        .handle("manifest", ({ params }) =>
          publisher.manifest(params.city).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(new HttpApiError.NotFound({})),
                onSome: Effect.succeed,
              }),
            ),
          ),
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
        if (Option.isNone(file)) return yield* new HttpApiError.NotFound({});
        const body = yield* fs
          .readFile(file.value)
          .pipe(Effect.mapError(() => new HttpApiError.NotFound({})));
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
