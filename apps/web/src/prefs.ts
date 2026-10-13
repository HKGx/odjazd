import { BrowserKeyValueStore } from "@effect/platform-browser";
import { Effect, ManagedRuntime, Option, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { createSignal } from "solid-js";

// localStorage is synchronous, so preferences get their own runtime and are
// read synchronously when a component is created.
const prefs = ManagedRuntime.make(BrowserKeyValueStore.layerLocalStorage);

/**
 * A signal persisted in localStorage under `odjazd:<key>`, validated by
 * `schema` on read. Unreadable or invalid stored values fall back to `fallback`.
 */
export const persisted = <S extends Schema.Codec<unknown, unknown>>(
  key: string,
  schema: S,
  fallback: S["Type"],
) => {
  const store = Effect.gen(function* () {
    const kv = yield* KeyValueStore.KeyValueStore;
    return KeyValueStore.toSchemaStore(kv, Schema.fromJsonString(schema));
  });
  const storageKey = `odjazd:${key}`;
  const initial = prefs.runSync(
    store.pipe(
      Effect.flatMap((s) => s.get(storageKey)),
      Effect.map(Option.getOrElse(() => fallback)),
      Effect.orElseSucceed(() => fallback),
    ),
  );
  // Values are plain data, never functions, so the value form of createSignal applies.
  const [get, set] = createSignal<S["Type"]>(initial as Exclude<S["Type"], Function>);
  const save = (value: S["Type"]) => {
    set(() => value);
    prefs.runFork(
      store.pipe(
        Effect.flatMap((s) => s.set(storageKey, value)),
        Effect.catchCause((cause) => Effect.logWarning(`couldn't save ${key}`, cause)),
      ),
    );
  };
  return [get, save] as const;
};
