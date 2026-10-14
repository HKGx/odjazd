import type { CitySummary } from "@odjazd/api";
import { InterchangeArea } from "@odjazd/model";
import type { AreaRecord, Place, PlaceKind } from "@odjazd/user-data";
import { Effect, Schema } from "effect";
import { createMemo, createSignal, For, Show } from "solid-js";
import { href } from "../route.ts";
import { kindIcon, useCity, withStore } from "../user.ts";

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const PlaceRow = (props: { place: Place }) => (
  <li class="record">
    <span class="record-icon" aria-hidden="true">
      {kindIcon[props.place.kind]}
    </span>
    <input
      aria-label="Place name"
      value={props.place.name}
      onChange={(e) => {
        const trimmed = e.currentTarget.value.trim();
        if (trimmed !== "") withStore((s) => s.savePlace({ ...props.place, name: trimmed }));
      }}
    />
    <select
      aria-label="Kind"
      onChange={(e) => {
        const kind = e.currentTarget.value as PlaceKind;
        withStore((s) => s.savePlace({ ...props.place, kind }));
      }}
    >
      <For each={Object.keys(kindIcon) as Array<PlaceKind>}>
        {(kind) => (
          <option value={kind} selected={kind === props.place.kind}>
            {kind}
          </option>
        )}
      </For>
    </select>
    <a class="small" href={href({ page: "point", ...props.place.point })}>
      Map
    </a>
    <button
      type="button"
      class="ghost small"
      onClick={() => withStore((s) => s.remove(props.place.id))}
    >
      Delete
    </button>
  </li>
);

const AreaRow = (props: { record: AreaRecord; usedBy: number }) => {
  const area = () => props.record.area;
  const save = (patch: Partial<InterchangeArea>) => {
    const next = Schema.decodeOption(InterchangeArea)({ ...area(), ...patch });
    if (next._tag === "Some") withStore((s) => s.saveArea({ ...props.record, area: next.value }));
  };
  return (
    <li class="record">
      <input
        aria-label="Area name"
        value={area().name}
        onChange={(e) => save({ name: e.currentTarget.value.trim() })}
      />
      <label class="inline">
        <input
          type="number"
          min="30"
          max="1000"
          step="10"
          aria-label="Radius in meters"
          value={String(area().radiusMeters)}
          onChange={(e) => save({ radiusMeters: Math.round(Number(e.currentTarget.value)) })}
        />
        m
      </label>
      <Show when={props.record.origin === "seed"}>
        <span class="badge">starter</span>
      </Show>
      <a class="small" href={href({ page: "point", ...area().center })}>
        Map
      </a>
      <button
        type="button"
        class="ghost small"
        disabled={props.usedBy > 0}
        title={props.usedBy > 0 ? `Used by ${props.usedBy} route(s)` : undefined}
        onClick={() => withStore((s) => s.remove(props.record.id))}
      >
        Delete
      </button>
    </li>
  );
};

export const PlacesView = (props: { city: CitySummary }) => {
  const records = useCity(() => props.city.id);
  const [message, setMessage] = createSignal<string>();
  const areaName = createMemo(
    () => new Map(records().areas.map((r) => [r.area.slug, r.area.name] as const)),
  );
  const usage = (slug: string) =>
    records().corridors.filter((r) =>
      r.corridor.legs.some((leg) => leg.from === slug || leg.to === slug),
    ).length;

  const exportData = () =>
    withStore((s) =>
      Effect.map(s.exportJson, (json) =>
        download(`odjazd-${new Date().toISOString().slice(0, 10)}.json`, json),
      ),
    );
  const importData = (file: File) =>
    withStore((s) =>
      Effect.tryPromise(() => file.text()).pipe(
        Effect.flatMap((text) => s.importJson(text)),
        Effect.match({
          onSuccess: (count) =>
            setMessage(`Imported: ${count} record${count === 1 ? "" : "s"} added or updated.`),
          onFailure: (error) =>
            setMessage(`Import failed: ${"message" in error ? error.message : String(error)}`),
        }),
      ),
    );

  return (
    <section class="places">
      <div class="card">
        <div class="card-head">
          <h2>Places</h2>
        </div>
        <p class="subtitle">
          Your own points, like home or work. They never leave this device unless you export them.
          Add one by long-pressing (or right-clicking) the map.
        </p>
        <ul class="records">
          <For
            each={records().places}
            keyed={(p) => p.id}
            fallback={<li class="muted">No places yet.</li>}
          >
            {(place) => <PlaceRow place={place()} />}
          </For>
        </ul>
      </div>

      <div class="card">
        <h2>Interchange areas</h2>
        <p class="subtitle">
          Groups of nearby stops where you change. Create one from a stop's panel on the map, or by
          long-pressing the map.
        </p>
        <ul class="records">
          <For
            each={records().areas}
            keyed={(a) => a.id}
            fallback={<li class="muted">No areas yet.</li>}
          >
            {(record) => <AreaRow record={record()} usedBy={usage(record().area.slug)} />}
          </For>
        </ul>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Routes</h2>
          <a class="button" href={href({ page: "route", id: undefined })}>
            New route
          </a>
        </div>
        <p class="subtitle">
          Chains of interchange areas you travel through, with the lines you'd take between them.
          Trip planning suggests a route whenever it fits, and Compare times them side by side.
        </p>
        <ul class="records">
          <For
            each={records().corridors}
            keyed={(c) => c.id}
            fallback={<li class="muted">No routes yet.</li>}
          >
            {(record) => (
              <li class="record route-record">
                <span class="hit-main">
                  <strong>{record().corridor.name}</strong>
                  <span class="muted small">
                    {[
                      record().corridor.legs[0]?.from ?? "",
                      ...record().corridor.legs.map((l) => l.to),
                    ]
                      .map((slug) => areaName().get(slug) ?? `${slug} (missing)`)
                      .join(" → ")}
                  </span>
                </span>
                <Show when={record().origin === "seed"}>
                  <span class="badge">starter</span>
                </Show>
                <a class="button ghost small" href={href({ page: "route", id: record().id })}>
                  Edit on map
                </a>
                <button
                  type="button"
                  class="ghost small"
                  onClick={() => withStore((s) => s.remove(record().id))}
                >
                  Delete
                </button>
              </li>
            )}
          </For>
        </ul>
      </div>

      <div class="card">
        <h2>Backup</h2>
        <p class="subtitle">
          Everything above plus your settings, as one JSON file. Importing merges: for each record,
          the newer version wins.
        </p>
        <div class="actions">
          <button type="button" onClick={exportData}>
            Export
          </button>
          <label class="button">
            Import…
            <input
              type="file"
              accept="application/json,.json"
              class="sr-only"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file !== undefined) importData(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        <Show when={message()}>{(text) => <p role="status">{text()}</p>}</Show>
      </div>
    </section>
  );
};
