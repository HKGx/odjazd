// @effect-diagnostics strictEffectProvide:off -- each test body is its own entry point.
import { describe, expect, it } from "@effect/vitest";
import { CityId, InterchangeArea, Ulid } from "@odjazd/model";
import { Effect, Layer, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { TestClock } from "effect/testing";
import { mergeRecords, cityRecords, UserDataStore } from "./store.ts";
import { defaultPreferences, emptyUserData, type UserRecord, UserDataInvalid } from "./schema.ts";
import { lodzAreas, lodzCorridors } from "./seeds/pl-lodz.ts";

const storageKey = "odjazd/user-data";
const t0 = Date.parse("2026-10-13T06:00:00Z");

const lodz = Schema.decodeSync(CityId)("pl-lodz");
const nowhere = Schema.decodeSync(CityId)("pl-nowhere");

const area = (slug: string, name = "X") =>
  Schema.decodeSync(InterchangeArea)({
    slug,
    cityId: "pl-lodz",
    name,
    center: { lat: 51.7, lon: 19.4 },
    radiusMeters: 200,
  });

/** A fresh in-memory store per `Effect.provide(memory)`. */
const memory = Layer.fresh(UserDataStore.layer).pipe(
  Layer.provide(Layer.fresh(KeyValueStore.layerMemory)),
);

/** A store over a given kv, so two stores can share one "device". */
const storeOver = (kv: KeyValueStore.KeyValueStore) =>
  Layer.fresh(UserDataStore.layer).pipe(
    Layer.provide(Layer.succeed(KeyValueStore.KeyValueStore, kv)),
  );

const memoryKv = KeyValueStore.KeyValueStore.pipe(
  Effect.provide(Layer.fresh(KeyValueStore.layerMemory)),
);

const ulid = (n: number) => Ulid.make(String(n).padStart(26, "0"));

describe("UserDataStore", () => {
  describe("empty start", () => {
    it.effect("get returns an empty v1 document with default preferences", () =>
      Effect.gen(function* () {
        const store = yield* UserDataStore;
        const data = yield* store.get;
        expect(data.schemaVersion).toBe(1);
        expect(data.records).toEqual([]);
        expect(data.seeded).toEqual([]);
        expect(data.preferences).toEqual(defaultPreferences);
        expect(data).toEqual(emptyUserData);
      }).pipe(Effect.provide(memory)),
    );
  });

  describe("saveArea", () => {
    it.effect("assigns a ULID, the clock's updatedAt and origin user", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(t0);
        const store = yield* UserDataStore;
        const saved = yield* store.saveArea({ _tag: "Area", area: area("x-y") });
        expect(saved._tag).toBe("Area");
        expect(saved.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
        expect(saved.updatedAt).toBe(t0);
        expect(saved.origin).toBe("user");
        expect(saved.area).toEqual(area("x-y"));

        const data = yield* store.get;
        expect(data.records).toEqual([saved]);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("saving with the same id updates in place", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(t0);
        const store = yield* UserDataStore;
        const first = yield* store.saveArea({ _tag: "Area", area: area("x-y", "X") });

        yield* TestClock.setTime(t0 + 5_000);
        const second = yield* store.saveArea({
          _tag: "Area",
          id: first.id,
          area: area("x-y", "Renamed"),
        });

        expect(second.id).toBe(first.id);
        expect(second.updatedAt).toBe(t0 + 5_000);
        const data = yield* store.get;
        expect(data.records).toHaveLength(1);
        expect(data.records[0]).toEqual(second);
        expect(data.records[0]?.origin).toBe("user");
      }).pipe(Effect.provide(memory)),
    );

    it.effect("editing a seeded record keeps its seed origin", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(t0);
        const store = yield* UserDataStore;
        yield* store.seed(lodz);
        const seeded = (yield* store.get).records.find((r) => r._tag === "Area");
        expect(seeded?.origin).toBe("seed");
        if (seeded?._tag !== "Area") return;

        yield* TestClock.setTime(t0 + 1_000);
        yield* store.saveArea({
          _tag: "Area",
          id: seeded.id,
          area: { ...seeded.area, name: "Edited" },
        });
        const after = (yield* store.get).records.find((r) => r.id === seeded.id);
        expect(after?.origin).toBe("seed");
        expect(after?.updatedAt).toBe(t0 + 1_000);
      }).pipe(Effect.provide(memory)),
    );
  });

  describe("invalid drafts", () => {
    it.effect("fail alone and don't block later saves from persisting", () =>
      Effect.gen(function* () {
        const kv = yield* memoryKv;
        yield* Effect.gen(function* () {
          const store = yield* UserDataStore;
          const bad = yield* store
            .saveArea({ _tag: "Area", area: { ...area("too-big"), radiusMeters: 5000 } })
            .pipe(Effect.flip);
          expect(bad).toBeInstanceOf(UserDataInvalid);
          const prefs = yield* store.setPreferences({ walkingSpeedKmh: 100 }).pipe(Effect.flip);
          expect(prefs).toBeInstanceOf(UserDataInvalid);
          yield* store.saveArea({ _tag: "Area", area: area("fine") });
          expect((yield* store.get).records).toHaveLength(1);
          expect((yield* store.get).preferences.walkingSpeedKmh).toBe(4.5);
        }).pipe(Effect.provide(storeOver(kv)));
        const reloaded = yield* UserDataStore.use((s) => s.get).pipe(Effect.provide(storeOver(kv)));
        expect(reloaded.records.map((r) => (r._tag === "Area" ? r.area.slug : ""))).toEqual([
          "fine",
        ]);
      }),
    );
  });

  describe("remove", () => {
    it.effect("tombstones the record and cityRecords hides it", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(t0);
        const store = yield* UserDataStore;
        const saved = yield* store.saveArea({ _tag: "Area", area: area("x-y") });

        yield* TestClock.setTime(t0 + 1_000);
        yield* store.remove(saved.id);

        const data = yield* store.get;
        expect(data.records).toHaveLength(1);
        expect(data.records[0]).toEqual({ ...saved, deleted: true, updatedAt: t0 + 1_000 });
        expect(cityRecords(data, lodz).areas).toEqual([]);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("removing an unknown id changes nothing", () =>
      Effect.gen(function* () {
        const store = yield* UserDataStore;
        yield* store.remove(ulid(42));
        expect((yield* store.get).records).toEqual([]);
      }).pipe(Effect.provide(memory)),
    );
  });

  describe("seed", () => {
    it.effect("adds the Łódź starter areas and corridors with origin seed, once", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(t0);
        const store = yield* UserDataStore;
        yield* store.seed(lodz);

        const data = yield* store.get;
        expect(data.seeded).toEqual([lodz]);
        const areas = data.records.filter((r) => r._tag === "Area");
        const corridors = data.records.filter((r) => r._tag === "Corridor");
        expect(areas).toHaveLength(lodzAreas.length);
        expect(corridors).toHaveLength(lodzCorridors.length);
        expect(data.records.every((r) => r.origin === "seed" && r.updatedAt === t0)).toBe(true);
        expect(new Set(data.records.map((r) => r.id)).size).toBe(data.records.length);
        expect(cityRecords(data, lodz).areas).toHaveLength(lodzAreas.length);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("calling again adds nothing", () =>
      Effect.gen(function* () {
        const store = yield* UserDataStore;
        yield* store.seed(lodz);
        const before = yield* store.get;
        yield* store.seed(lodz);
        expect(yield* store.get).toEqual(before);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("deleting a seeded record and seeding again does not bring it back", () =>
      Effect.gen(function* () {
        const store = yield* UserDataStore;
        yield* store.seed(lodz);
        const [victim] = (yield* store.get).records;
        if (victim === undefined) throw new Error("seed produced no records");
        yield* store.remove(victim.id);
        const afterRemove = yield* store.get;

        yield* store.seed(lodz);
        const data = yield* store.get;
        expect(data.records).toEqual(afterRemove.records);
        expect(cityRecords(data, lodz).areas).toHaveLength(lodzAreas.length - 1);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("is remembered across reloads", () =>
      Effect.gen(function* () {
        const kv = yield* memoryKv;
        const first = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
        yield* first.seed(lodz);
        const count = (yield* first.get).records.length;

        const reloaded = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
        yield* reloaded.seed(lodz);
        expect((yield* reloaded.get).records).toHaveLength(count);
      }),
    );

    it.effect("a city without seeds only records that it was offered", () =>
      Effect.gen(function* () {
        const store = yield* UserDataStore;
        yield* store.seed(nowhere);
        const data = yield* store.get;
        expect(data.records).toEqual([]);
        expect(data.seeded).toEqual([nowhere]);
      }).pipe(Effect.provide(memory)),
    );
  });

  describe("persistence", () => {
    it.effect("writes every change under the storage key", () =>
      Effect.gen(function* () {
        const kv = yield* memoryKv;
        const store = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
        yield* TestClock.setTime(t0);
        const saved = yield* store.saveArea({ _tag: "Area", area: area("x-y") });

        const stored = yield* kv.get(storageKey);
        expect(stored).toBeTypeOf("string");
        const parsed = JSON.parse(stored ?? "null");
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.records).toEqual([JSON.parse(JSON.stringify(saved))]);
      }),
    );

    it.effect("a new store over the same kv loads the saved data", () =>
      Effect.gen(function* () {
        const kv = yield* memoryKv;
        const first = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
        yield* first.saveArea({ _tag: "Area", area: area("x-y") });
        yield* first.setPreferences({ theme: "dark" });
        const before = yield* first.get;

        const reloaded = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
        expect(yield* reloaded.get).toEqual(before);
      }),
    );

    for (const [label, stored] of [
      ["not JSON", "{not json"],
      ["the wrong shape", '{"schemaVersion":1,"records":"nope"}'],
      ["a newer format", '{"schemaVersion":99,"records":[],"preferences":{},"seeded":[]}'],
    ] as const) {
      it.effect(`unreadable stored copy (${label}) starts empty and is kept aside`, () =>
        Effect.gen(function* () {
          const kv = yield* memoryKv;
          yield* kv.set(storageKey, stored);
          yield* TestClock.setTime(1234);

          const store = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
          expect(yield* store.get).toEqual(emptyUserData);
          expect(yield* kv.get(`${storageKey}/unreadable-1234`)).toBe(stored);
        }),
      );
    }
  });

  describe("exportJson and importJson", () => {
    it.effect("export then import into a fresh store reproduces the records", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(t0);
        const source = yield* UserDataStore;
        yield* source.seed(lodz);
        yield* source.saveArea({ _tag: "Area", area: area("x-y") });
        yield* source.setPreferences({ walkingSpeedKmh: 5, theme: "dark" });
        const json = yield* source.exportJson;

        const kv = yield* memoryKv;
        const target = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
        const changed = yield* target.importJson(json);
        const sourceData = yield* source.get;
        const targetData = yield* target.get;

        expect(changed).toBe(sourceData.records.length);
        expect(targetData.records).toEqual(sourceData.records);
        expect(targetData.preferences).toEqual(sourceData.preferences);
        expect(targetData.seeded).toEqual(sourceData.seeded);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("importing the same export again changes nothing", () =>
      Effect.gen(function* () {
        const store = yield* UserDataStore;
        yield* store.saveArea({ _tag: "Area", area: area("x-y") });
        const json = yield* store.exportJson;
        expect(yield* store.importJson(json)).toBe(0);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("a newer local edit is not overwritten by an older import", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(t0);
        const old = yield* UserDataStore;
        const saved = yield* old.saveArea({ _tag: "Area", area: area("x-y", "Old") });
        const oldJson = yield* old.exportJson;

        yield* TestClock.setTime(t0 + 10_000);
        const local = yield* old.saveArea({ _tag: "Area", id: saved.id, area: area("x-y", "New") });

        expect(yield* old.importJson(oldJson)).toBe(0);
        expect((yield* old.get).records).toEqual([local]);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("an older local version is overwritten by a newer import", () =>
      Effect.gen(function* () {
        const id = ulid(7);
        yield* TestClock.setTime(t0);
        const local = yield* UserDataStore;
        yield* local.saveArea({ _tag: "Area", id, area: area("x-y", "Local") });

        const kv = yield* memoryKv;
        const remote = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
        yield* TestClock.setTime(t0 + 10_000);
        const newer = yield* remote.saveArea({ _tag: "Area", id, area: area("x-y", "Remote") });
        const json = yield* remote.exportJson;

        expect(yield* local.importJson(json)).toBe(1);
        expect((yield* local.get).records).toEqual([newer]);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("an imported tombstone deletes a local record when it is newer", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(t0);
        const source = yield* UserDataStore;
        const saved = yield* source.saveArea({ _tag: "Area", area: area("x-y") });
        const live = yield* source.exportJson;

        const kv = yield* memoryKv;
        const target = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
        yield* target.importJson(live);

        yield* TestClock.setTime(t0 + 1_000);
        yield* source.remove(saved.id);
        const tombstone = yield* source.exportJson;

        expect(yield* target.importJson(tombstone)).toBe(1);
        const data = yield* target.get;
        expect(data.records[0]?.deleted).toBe(true);
        expect(cityRecords(data, lodz).areas).toEqual([]);
      }).pipe(Effect.provide(memory)),
    );

    it.effect("an older imported tombstone does not delete a newer local record", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(t0);
        const source = yield* UserDataStore;
        const saved = yield* source.saveArea({ _tag: "Area", area: area("x-y") });
        yield* source.remove(saved.id);
        const tombstone = yield* source.exportJson;

        // A local edit made after the tombstone was written: it must survive the import.
        yield* TestClock.setTime(t0 + 1_000);
        const kv = yield* memoryKv;
        const target = yield* UserDataStore.pipe(Effect.provide(storeOver(kv)));
        const local = yield* target.saveArea({
          _tag: "Area",
          id: saved.id,
          area: area("x-y", "Kept"),
        });

        expect(yield* target.importJson(tombstone)).toBe(0);
        expect((yield* target.get).records).toEqual([local]);
        expect(cityRecords(yield* target.get, lodz).areas).toEqual([local]);
      }).pipe(Effect.provide(memory)),
    );
  });

  describe("importJson rejects bad documents", () => {
    for (const [label, json] of [
      ["non-JSON text", "not json at all"],
      ["a JSON array", "[]"],
      [
        "a newer schemaVersion",
        '{"schemaVersion": 99, "records": [], "preferences": {}, "seeded": []}',
      ],
    ] as const) {
      it.effect(`fails with UserDataInvalid for ${label}`, () =>
        Effect.gen(function* () {
          const store = yield* UserDataStore;
          yield* store.saveArea({ _tag: "Area", area: area("x-y") });
          const before = yield* store.get;

          const error = yield* store.importJson(json).pipe(Effect.flip);
          expect(error).toBeInstanceOf(UserDataInvalid);
          expect(error._tag).toBe("UserDataInvalid");
          expect(yield* store.get).toEqual(before);
        }).pipe(Effect.provide(memory)),
      );
    }

    it.effect("an empty object migrates to an empty v1 document", () =>
      Effect.gen(function* () {
        const store = yield* UserDataStore;
        expect(yield* store.importJson("{}")).toBe(0);
        const data = yield* store.get;
        expect(data.schemaVersion).toBe(1);
        expect(data.records).toEqual([]);
        expect(data.seeded).toEqual([]);
        expect(data.preferences).toEqual(defaultPreferences);
      }).pipe(Effect.provide(memory)),
    );
  });

  describe("setPreferences", () => {
    it.effect("patches the given fields and bumps updatedAt", () =>
      Effect.gen(function* () {
        const store = yield* UserDataStore;
        yield* TestClock.setTime(t0);
        const first = yield* store.setPreferences({ walkingSpeedKmh: 5 });
        expect(first).toEqual({ ...defaultPreferences, walkingSpeedKmh: 5, updatedAt: t0 });

        yield* TestClock.setTime(t0 + 2_000);
        const second = yield* store.setPreferences({ theme: "dark" });
        expect(second).toEqual({
          ...defaultPreferences,
          walkingSpeedKmh: 5,
          theme: "dark",
          updatedAt: t0 + 2_000,
        });
        expect((yield* store.get).preferences).toEqual(second);
      }).pipe(Effect.provide(memory)),
    );
  });

  describe("mergeRecords", () => {
    const rec = (n: number, updatedAt: number, name: string): UserRecord => ({
      _tag: "Area",
      id: ulid(n),
      updatedAt,
      origin: "user",
      area: area(`area-${name}`, name),
    });

    it("unions by id and sorts by id", () => {
      const merged = mergeRecords(
        [rec(3, 1, "c"), rec(1, 1, "a")],
        [rec(2, 1, "b"), rec(4, 1, "d")],
      );
      expect(merged.map((r) => r.id)).toEqual([ulid(1), ulid(2), ulid(3), ulid(4)]);
    });

    it("keeps the later updatedAt per id, tombstones included", () => {
      const ours = [rec(1, 10, "old"), rec(2, 20, "mine")];
      const theirs = [rec(1, 30, "new"), { ...rec(2, 5, "stale"), deleted: true as const }];
      const merged = mergeRecords(ours, theirs);
      expect(merged).toEqual([theirs[0], ours[1]]);
    });

    it("keeps ours on an exact tie", () => {
      const ours = [rec(1, 10, "ours")];
      const theirs = [rec(1, 10, "theirs")];
      expect(mergeRecords(ours, theirs)).toEqual(ours);
    });

    it("does not mutate its inputs", () => {
      const ours = [rec(2, 1, "b")];
      const theirs = [rec(1, 1, "a")];
      mergeRecords(ours, theirs);
      expect(ours.map((r) => r.id)).toEqual([ulid(2)]);
      expect(theirs.map((r) => r.id)).toEqual([ulid(1)]);
    });
  });
});
