import type { CityId } from "@odjazd/model";
import { InterchangeArea } from "@odjazd/model";
import type { PlaceKind } from "@odjazd/user-data";
import { TimetableClient } from "@odjazd/worker";
import { Effect, Schema } from "effect";
import { type Accessor, createEffect, createSignal, For, Loading, Show, untrack } from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import type { LiveMap } from "../../map/live-map.ts";
import { href } from "../../route.ts";
import { slugify } from "../../slug.ts";
import { useCity, withStore } from "../../user.ts";
import { draftOf } from "./endpoints.ts";
import { LineBadge } from "./parts.tsx";

const kinds: ReadonlyArray<{ kind: PlaceKind; label: string }> = [
  { kind: "home", label: "Home" },
  { kind: "work", label: "Work" },
  { kind: "school", label: "School" },
  { kind: "star", label: "Other" },
];

/** A tapped point: nearby stops, and saving it as a place or an interchange area. */
export const PointPanel = (props: {
  hash: string;
  city: CityId;
  lat: number;
  lon: number;
  map: Accessor<LiveMap | undefined>;
}) => {
  const records = useCity(() => props.city);
  const [mode, setMode] = createSignal<"place" | "area">();
  const [name, setName] = createSignal("");
  const [kind, setKind] = createSignal<PlaceKind>("star");
  const [radius, setRadius] = createSignal(150);
  const [saved, setSaved] = createSignal<string>();
  const [error, setError] = createSignal<string>();

  const nearby = createEffectMemo(() => {
    const query = { hash: props.hash, lat: props.lat, lon: props.lon, radiusMeters: 600, limit: 8 };
    return TimetableClient.use((worker) => worker.Nearby(query));
  });

  createEffect(
    () => [props.map(), props.lat, props.lon] as const,
    ([map, lat, lon]) => {
      if (map === undefined) return;
      untrack(() => map.flyTo(lat, lon, 16));
    },
  );
  createEffect(
    () => [props.map(), props.lat, props.lon, mode() === "area" ? radius() : undefined] as const,
    ([map, lat, lon, radiusMeters]) => {
      map?.setPin({ lat, lon, radiusMeters });
      return () => map?.setPin(undefined);
    },
  );

  const save = () => {
    const trimmed = name().trim();
    if (trimmed === "") return setError("Give it a name.");
    setError(undefined);
    const point = { lat: props.lat, lon: props.lon };
    const done = (what: string) => Effect.sync(() => (setSaved(what), setMode(undefined)));
    if (mode() === "place") {
      withStore((store) =>
        store
          .savePlace({ _tag: "Place", cityId: props.city, name: trimmed, kind: kind(), point })
          .pipe(Effect.andThen(done(`Saved “${trimmed}”.`))),
      );
      return;
    }
    const taken = new Set(records().areas.map((r) => r.area.slug));
    const area = Schema.decodeExit(InterchangeArea)({
      slug: slugify(trimmed, taken),
      cityId: props.city,
      name: trimmed,
      center: point,
      radiusMeters: radius(),
    });
    if (area._tag === "Failure") return setError("That area isn't valid.");
    withStore((store) =>
      store
        .saveArea({ _tag: "Area", area: area.value })
        .pipe(Effect.andThen(done(`Area “${trimmed}” saved; use it in a route.`))),
    );
  };

  return (
    <article class="panel-body">
      <h2>Here</h2>
      <p class="muted small">
        {props.lat.toFixed(5)}, {props.lon.toFixed(5)} · saved only on this device
      </p>
      <Show when={saved()}>
        {(text) => (
          <p class="notice" role="status">
            {text()} <a href={href({ page: "places" })}>Places</a>
          </p>
        )}
      </Show>
      <Show
        when={mode()}
        fallback={
          <div class="actions">
            <a
              class="button"
              href={href({
                page: "trip",
                from: draftOf(props.city).from,
                to: { kind: "at", lat: props.lat, lon: props.lon },
              })}
            >
              Directions here
            </a>
            <a
              class="button"
              href={href({
                page: "trip",
                from: { kind: "at", lat: props.lat, lon: props.lon },
                to: draftOf(props.city).to,
              })}
            >
              From here
            </a>
            <button type="button" onClick={() => setMode("place")}>
              Save as place
            </button>
            <button
              type="button"
              onClick={() => {
                setName(nearby()[0]?.stop.name ?? "");
                setMode("area");
              }}
            >
              New interchange area
            </button>
          </div>
        }
      >
        <form
          class="point-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label class="stack">
            Name
            <input value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
          </label>
          <Show
            when={mode() === "area"}
            fallback={
              <fieldset class="kinds">
                <legend class="sr-only">Kind</legend>
                <For each={kinds}>
                  {(k) => (
                    <label class="check">
                      <input
                        type="radio"
                        name="kind"
                        checked={kind() === k.kind}
                        onChange={() => setKind(k.kind)}
                      />
                      {k.label}
                    </label>
                  )}
                </For>
              </fieldset>
            }
          >
            <label class="stack">
              Radius: {radius()} m
              <input
                type="range"
                min="50"
                max="600"
                step="10"
                value={String(radius())}
                onInput={(e) => setRadius(Number(e.currentTarget.value))}
              />
            </label>
            <p class="muted small">Stops inside the circle count as one place to change at.</p>
          </Show>
          <div class="actions">
            <button type="button" class="ghost" onClick={() => setMode(undefined)}>
              Cancel
            </button>
            <button type="submit" class="primary">
              Save
            </button>
          </div>
          <Show when={error()}>
            {(message) => (
              <p class="form-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </form>
      </Show>
      <h3>Stops nearby</h3>
      <Loading fallback={<p class="loading">Finding stops…</p>}>
        <Show when={nearby().length > 0} fallback={<p class="empty">No stops within 600 m.</p>}>
          <ul class="results nearby">
            <For each={nearby()}>
              {(hit) => (
                <li>
                  <a class="hit" href={href({ page: "stop", group: hit.stop.group })}>
                    <span class="stop-icon" aria-hidden="true" />
                    <span class="hit-main" style={{ flex: "1" }}>
                      <span>{hit.stop.name}</span>
                      <span class="hit-lines">
                        <For each={hit.stop.lines.slice(0, 8)}>
                          {(line) => <LineBadge line={line} small />}
                        </For>
                      </span>
                    </span>
                    <span class="muted small">{Math.round(hit.distanceMeters / 10) * 10} m</span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Loading>
    </article>
  );
};
