import type { CityId } from "@odjazd/model";
import { makeUlid } from "@odjazd/model";
import { Clock, Context, Effect, Layer, Schema, Semaphore, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/persistence";
import { migrate } from "./migrations.ts";
import {
  type AreaRecord,
  type CorridorRecord,
  emptyUserData,
  type Place,
  type Preferences,
  UserData,
  UserDataInvalid,
  type UserRecord,
} from "./schema.ts";
import { seedIntent } from "./seeds.ts";

const storageKey = "odjazd/user-data";
const UserDataJson = Schema.fromJsonString(UserData);

/** New record fields the store fills in. */
type Draft<R extends UserRecord> = Omit<R, "id" | "updatedAt" | "origin" | "deleted"> & {
  readonly id?: R["id"] | undefined;
};

/** Merge two record sets: per id, the later `updatedAt` wins (tombstones included). */
export const mergeRecords = (
  ours: ReadonlyArray<UserRecord>,
  theirs: ReadonlyArray<UserRecord>,
): ReadonlyArray<UserRecord> => {
  const byId = new Map(ours.map((record) => [record.id, record]));
  for (const record of theirs) {
    const current = byId.get(record.id);
    if (current === undefined || record.updatedAt > current.updatedAt) byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
};

/** Live records of one city (tombstones hidden). */
export const cityRecords = (data: UserData, city: CityId) => ({
  places: data.records.filter(
    (r): r is Place => r._tag === "Place" && r.deleted !== true && r.cityId === city,
  ),
  areas: data.records.filter(
    (r): r is AreaRecord => r._tag === "Area" && r.deleted !== true && r.area.cityId === city,
  ),
  corridors: data.records.filter(
    (r): r is CorridorRecord =>
      r._tag === "Corridor" && r.deleted !== true && r.corridor.cityId === city,
  ),
});

/**
 * The user's data on this device, persisted to a `KeyValueStore` (localStorage
 * in the browser) after every change, and observable as a stream.
 */
export class UserDataStore extends Context.Service<
  UserDataStore,
  {
    readonly get: Effect.Effect<UserData>;
    readonly changes: Stream.Stream<UserData>;
    /** Saves fail with `UserDataInvalid`, changing nothing, when the result isn't valid. */
    readonly savePlace: (draft: Draft<Place>) => Effect.Effect<Place, UserDataInvalid>;
    readonly saveArea: (draft: Draft<AreaRecord>) => Effect.Effect<AreaRecord, UserDataInvalid>;
    readonly saveCorridor: (
      draft: Draft<CorridorRecord>,
    ) => Effect.Effect<CorridorRecord, UserDataInvalid>;
    readonly remove: (id: UserRecord["id"]) => Effect.Effect<void>;
    readonly setPreferences: (
      change: Partial<Omit<Preferences, "updatedAt">>,
    ) => Effect.Effect<Preferences, UserDataInvalid>;
    /** Adds the city's starter areas and routes once; a no-op afterwards. */
    readonly seed: (city: CityId) => Effect.Effect<void>;
    readonly exportJson: Effect.Effect<string>;
    /** Merges an export into what's here; returns how many records changed. */
    readonly importJson: (json: string) => Effect.Effect<number, UserDataInvalid>;
  }
>()("@odjazd/user-data/store/UserDataStore") {
  static readonly layer = Layer.effect(
    UserDataStore,
    Effect.gen(function* () {
      const kv = yield* KeyValueStore.KeyValueStore;

      const stored = yield* kv.get(storageKey).pipe(Effect.orElseSucceed(() => undefined));
      let initial = emptyUserData;
      if (stored !== undefined) {
        const decoded = yield* Effect.try(() => migrate(JSON.parse(stored))).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(UserData)),
          Effect.option,
        );
        if (decoded._tag === "Some") initial = decoded.value;
        else {
          // Keep the unreadable copy for recovery rather than overwriting it silently.
          const at = yield* Clock.currentTimeMillis;
          yield* kv.set(`${storageKey}/unreadable-${at}`, stored).pipe(Effect.ignore);
          yield* Effect.logWarning("user data: stored copy unreadable; starting empty");
        }
      }
      const state = yield* SubscriptionRef.make(initial);

      // Each change is validated (by encoding) before it replaces the state, so an
      // invalid draft fails alone instead of making every later save unpersistable.
      const lock = yield* Semaphore.make(1);
      const change = (f: (data: UserData, now: number) => UserData) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const next = f(yield* SubscriptionRef.get(state), now);
          const json = yield* Schema.encodeEffect(UserDataJson)(next).pipe(
            Effect.mapError((error) => UserDataInvalid.make({ message: error.message })),
          );
          yield* kv
            .set(storageKey, json)
            .pipe(Effect.catchCause((cause) => Effect.logError("user data: save failed", cause)));
          yield* SubscriptionRef.set(state, next);
          return next;
        }).pipe(lock.withPermit);

      const upsert = <R extends UserRecord>(draft: Draft<R>, origin: R["origin"] = "user") =>
        Effect.gen(function* () {
          const id = draft.id ?? (yield* makeUlid);
          const now = yield* Clock.currentTimeMillis;
          let record = undefined as unknown as R;
          yield* change((data) => {
            const existing = data.records.find((r) => r.id === id);
            record = { ...draft, id, updatedAt: now, origin: existing?.origin ?? origin } as R;
            return { ...data, records: mergeRecords(data.records, [record]) };
          });
          return record;
        });

      return UserDataStore.of({
        get: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state),
        savePlace: (draft) => upsert<Place>(draft),
        saveArea: (draft) => upsert<AreaRecord>(draft),
        saveCorridor: (draft) => upsert<CorridorRecord>(draft),
        remove: (id) =>
          change((data, now) => ({
            ...data,
            records: data.records.map((r) =>
              r.id === id ? { ...r, deleted: true as const, updatedAt: now } : r,
            ),
          })).pipe(Effect.asVoid, Effect.orDie),
        setPreferences: (patch) =>
          change((data, now) => ({
            ...data,
            preferences: { ...data.preferences, ...patch, updatedAt: now },
          })).pipe(Effect.map((data) => data.preferences)),
        seed: (city) =>
          Effect.gen(function* () {
            if ((yield* SubscriptionRef.get(state)).seeded.includes(city)) return;
            const intent = seedIntent(city);
            const now = yield* Clock.currentTimeMillis;
            const records: Array<UserRecord> = [];
            for (const area of intent.areas) {
              records.push({
                _tag: "Area",
                id: yield* makeUlid,
                updatedAt: now,
                origin: "seed",
                area,
              });
            }
            for (const corridor of intent.corridors) {
              records.push({
                _tag: "Corridor",
                id: yield* makeUlid,
                updatedAt: now,
                origin: "seed",
                corridor,
              });
            }
            yield* change((data) =>
              data.seeded.includes(city)
                ? data
                : {
                    ...data,
                    records: mergeRecords(data.records, records),
                    seeded: [...data.seeded, city],
                  },
            ).pipe(Effect.orDie);
          }),
        exportJson: Effect.flatMap(SubscriptionRef.get(state), (data) =>
          Schema.encodeEffect(UserDataJson)(data).pipe(Effect.orDie),
        ),
        importJson: (json) =>
          Effect.gen(function* () {
            const incoming = yield* Effect.try({
              try: () => migrate(JSON.parse(json)),
              catch: (error) =>
                UserDataInvalid.make({ message: `Not an odjazd export: ${String(error)}` }),
            }).pipe(
              Effect.flatMap((raw) =>
                Schema.decodeUnknownEffect(UserData)(raw).pipe(
                  Effect.mapError((error) => UserDataInvalid.make({ message: error.message })),
                ),
              ),
            );
            const before = yield* SubscriptionRef.get(state);
            const merged = mergeRecords(before.records, incoming.records);
            const changed = merged.filter(
              (r) => before.records.find((b) => b.id === r.id)?.updatedAt !== r.updatedAt,
            ).length;
            yield* change((data) => ({
              ...data,
              records: mergeRecords(data.records, incoming.records),
              preferences:
                incoming.preferences.updatedAt > data.preferences.updatedAt
                  ? incoming.preferences
                  : data.preferences,
              seeded: [...new Set([...data.seeded, ...incoming.seeded])],
            }));
            return changed;
          }),
      });
    }),
  );
}
