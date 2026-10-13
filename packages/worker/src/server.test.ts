// @effect-diagnostics strictEffectProvide:off -- each test body is its own entry point.
import { CityManifest } from "@odjazd/api";
import { area, at, buildTimetable } from "@odjazd/engine/testing";
import { CityId, InterchangeArea } from "@odjazd/model";
import { encodeTimetable } from "@odjazd/timetable";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { RpcTest } from "effect/rpc";
import { handlersLayer } from "./server.ts";
import { CompareQuery, TimetableNotLoaded, TimetableUnavailable } from "./schema.ts";
import { TimetableRpcs } from "./rpc.ts";
import { TimetableStore } from "./store.ts";

const stops = [
  ["a1", 51.7, 19.46],
  ["b1", 51.71, 19.46],
  ["c1", 51.72, 19.46],
] as const;

const timetable = buildTimetable(stops, [
  {
    line: "tram:1",
    id: "direct",
    stops: [
      ["a1", "08:10"],
      ["c1", "08:30"],
    ],
  },
  {
    line: "tram:2",
    id: "first",
    stops: [
      ["a1", "08:02"],
      ["b1", "08:08"],
    ],
  },
  {
    line: "bus:3",
    id: "second",
    stops: [
      ["b1", "08:12"],
      ["c1", "08:18"],
    ],
  },
]);

const bytes = encodeTimetable(timetable);
// The server names feeds by hash but never re-hashes the bytes, so a fixed
// 64-hex value keeps this test free of node:crypto (the base tsconfig has no types).
const hash = "ab".repeat(32);

const manifest = Schema.encodeSync(CityManifest)(
  Schema.decodeSync(CityManifest)({
    cityId: "pl-test",
    timetable: {
      hash,
      path: `/api/feeds/${hash}.bin`,
      bytes: bytes.length,
      formatVersion: 1,
      firstDate: "2026-10-14",
      dayCount: 1,
    },
    compiledAt: 1_790_000_000,
    sourceHash: hash,
    attribution: [],
  }),
);

/** Mutable network switches, read on every request. */
interface Network {
  offline: boolean;
  /** `missing` answers the manifest with 404. */
  manifest: "ok" | "missing";
}

const offlineError = (request: Parameters<HttpClient.HttpClient["execute"]>[0]) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description: "offline" }),
  });

/** Fake `HttpClient` serving `GET /api/cities/pl-test/manifest` and `/api/feeds/<hash>.bin`. */
const fakeHttp = (network: Network) =>
  HttpClient.make((request, url) => {
    if (network.offline) return Effect.fail(offlineError(request));
    const respond = (status: number, body: BodyInit, type: string) =>
      HttpClientResponse.fromWeb(
        request,
        new Response(body, { status, headers: { "content-type": type } }),
      );
    if (url.pathname === "/api/cities/pl-test/manifest") {
      return network.manifest === "missing"
        ? Effect.succeed(respond(404, JSON.stringify({ _tag: "NotFound" }), "application/json"))
        : Effect.succeed(respond(200, JSON.stringify(manifest), "application/json"));
    }
    if (url.pathname === `/api/feeds/${hash}.bin`) {
      return Effect.succeed(respond(200, bytes, "application/octet-stream"));
    }
    return Effect.succeed(respond(404, JSON.stringify({ _tag: "NotFound" }), "application/json"));
  });

const layerFor = (network: Network) =>
  handlersLayer({ baseUrl: "http://test" }).pipe(
    Layer.provide(
      Layer.mergeAll(
        TimetableStore.memory,
        Layer.succeed(HttpClient.HttpClient)(fakeHttp(network)),
      ),
    ),
  );

const areas = [area("a", 51.7, 19.46), area("b", 51.71, 19.46), area("c", 51.72, 19.46)];
// Encoded form, as a client sends it on the wire.
const corridors: (typeof CompareQuery.Encoded)["corridors"] = [
  { slug: "direct", cityId: "pl-test", name: "Direct", legs: [{ from: "a", to: "c", allow: {} }] },
];

const compareQuery = (hashValue: string) =>
  Schema.decodeSync(CompareQuery)({
    hash: hashValue,
    areas: areas.map((a) => Schema.encodeSync(InterchangeArea)(a)),
    corridors,
    date: "2026-10-14",
    from: "08:00",
    to: "08:00",
    stepMinutes: 5,
    transferBufferSec: 60,
  });

describe("worker RPC handlers", () => {
  it.effect("loads a timetable from the network", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TimetableRpcs);
      const result = yield* client.Load({ city: CityId.make("pl-test") });

      expect(result.source).toBe("network");
      expect(result.manifest.timetable.hash).toBe(hash);
      expect(result.timeZone).toBe("Europe/Warsaw");
      expect(result.stats).toEqual({ lines: 3, stops: 3, trips: 3 });
      expect(result.firstDate).toBe("2026-10-14");
      expect(result.lastDate).toBe("2026-10-14");
    }).pipe(Effect.scoped, Effect.provide(layerFor({ offline: false, manifest: "ok" }))),
  );

  it.effect("falls back to the device copy when offline after a successful load", () => {
    const network: Network = { offline: false, manifest: "ok" };
    return Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TimetableRpcs);
      const first = yield* client.Load({ city: CityId.make("pl-test") });
      expect(first.source).toBe("network");

      network.offline = true;
      const second = yield* client.Load({ city: CityId.make("pl-test") });
      expect(second.source).toBe("cache");
      expect(second.manifest.timetable.hash).toBe(hash);
      expect(second.stats).toEqual(first.stats);
    }).pipe(Effect.scoped, Effect.provide(layerFor(network)));
  });

  it.effect("fails with TimetableUnavailable when offline with nothing saved", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TimetableRpcs);
      const error = yield* client.Load({ city: CityId.make("pl-test") }).pipe(Effect.flip);
      expect(error).toBeInstanceOf(TimetableUnavailable);
      expect(error._tag).toBe("TimetableUnavailable");
    }).pipe(Effect.scoped, Effect.provide(layerFor({ offline: true, manifest: "ok" }))),
  );

  it.effect("fails with TimetableUnavailable when the manifest is 404", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TimetableRpcs);
      const error = yield* client.Load({ city: CityId.make("pl-test") }).pipe(Effect.flip);
      expect(error._tag).toBe("TimetableUnavailable");
    }).pipe(Effect.scoped, Effect.provide(layerFor({ offline: false, manifest: "missing" }))),
  );

  // Bug probe: a 404 is a definitive answer, so a saved copy should not be served.
  // server.ts maps NotFound to TimetableUnavailable and then a catch-all that falls
  // back to the cache also catches that failure, so this currently resolves with "cache".
  it.effect("does not serve the saved copy when the manifest is 404", () => {
    const network: Network = { offline: false, manifest: "ok" };
    return Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TimetableRpcs);
      yield* client.Load({ city: CityId.make("pl-test") });

      network.manifest = "missing";
      const error = yield* client.Load({ city: CityId.make("pl-test") }).pipe(Effect.flip);
      expect(error._tag).toBe("TimetableUnavailable");
    }).pipe(Effect.scoped, Effect.provide(layerFor(network)));
  });

  it.effect("compares corridors for a loaded hash", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TimetableRpcs);
      const loaded = yield* client.Load({ city: CityId.make("pl-test") });
      const result = yield* client.Compare(compareQuery(loaded.manifest.timetable.hash));

      expect(result.inRange).toBe(true);
      expect(result.corridors.map((c) => c.slug)).toEqual(["direct"]);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.summaries).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(layerFor({ offline: false, manifest: "ok" }))),
  );

  it.effect("rejects compare and board for a hash that was never loaded", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TimetableRpcs);
      yield* client.Load({ city: CityId.make("pl-test") });

      const compareError = yield* client.Compare(compareQuery("cd".repeat(32))).pipe(Effect.flip);
      expect(compareError).toBeInstanceOf(TimetableNotLoaded);
      expect(compareError._tag).toBe("TimetableNotLoaded");

      const boardError = yield* client
        .Board({
          hash: "cd".repeat(32),
          area: areas[0]!,
          at: at("08:00"),
          horizonMinutes: 60,
          limit: 10,
        })
        .pipe(Effect.flip);
      expect(boardError._tag).toBe("TimetableNotLoaded");
    }).pipe(Effect.scoped, Effect.provide(layerFor({ offline: false, manifest: "ok" }))),
  );
});
