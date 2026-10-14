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
const stored: Accessor<UserData | undefined> = createRoot(() =>
  createEffectStream<UserData | undefined, never>(
    () => Stream.unwrap(UserDataStore.use((store) => Effect.succeed(store.changes))),
    undefined,
  ),
);

export const userData = (): UserData => stored() ?? emptyUserData;

/** False until the store has been read: until then "nothing saved" isn't known yet. */
export const userDataLoaded = () => stored() !== undefined;

/**
 * The city the user picked, or for data saved before there was a choice, the
 * one their saved places and routes belong to. `undefined`: never chosen.
 */
export const chosenCity = (): CityId | undefined => {
  const data = userData();
  if (data.preferences.city !== undefined) return data.preferences.city;
  for (const record of data.records) {
    if (record._tag === "Place") return record.cityId;
    if (record._tag === "Area") return record.area.cityId;
    if (record._tag === "Corridor") return record.corridor.cityId;
  }
  return undefined;
};

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
