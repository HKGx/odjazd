import type { CityId } from "@odjazd/model";
import {
  cityRecords,
  emptyUserData,
  type PlaceKind,
  type Preferences,
  type UserData,
  UserDataStore,
} from "@odjazd/user-data";
import { Effect, Stream } from "effect";
import { type Accessor, createMemo, createRoot } from "solid-js";
import { createEffectStream, runFork } from "./effect-solid.ts";

/*
 * The user's data as one app-wide signal, fed by the store's change stream.
 * Writes go through the store (an Effect); the signal follows.
 */
const userData: Accessor<UserData> = createRoot(() =>
  createEffectStream(
    () => Stream.unwrap(UserDataStore.use((store) => Effect.succeed(store.changes))),
    emptyUserData,
  ),
);

export { userData };

export const preferences: Accessor<Preferences> = createRoot(() =>
  createMemo(() => userData().preferences),
);

export const useCity = (city: Accessor<CityId>) =>
  createMemo(() => cityRecords(userData(), city()));

export const updatePreferences = (
  patch: Parameters<UserDataStore["Service"]["setPreferences"]>[0],
) => runFork(UserDataStore.use((store) => store.setPreferences(patch)));

/** Runs a store operation from an event handler. */
export const withStore = <A, E>(f: (store: UserDataStore["Service"]) => Effect.Effect<A, E>) =>
  runFork(UserDataStore.use(f));

export const kindIcon: Record<PlaceKind, string> = { home: "⌂", work: "▣", school: "✎", star: "★" };
