import type { CitySummary } from "@odjazd/api";
import { Corridor, InterchangeArea, LineRef, type Mode } from "@odjazd/model";
import type { AreaRecord, CorridorRecord, Place, PlaceKind } from "@odjazd/user-data";
import { Effect, Schema } from "effect";
import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import { href } from "../route.ts";
import { slugify } from "../slug.ts";
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

const parseLines = (text: string): ReadonlyArray<LineRef> | string => {
  const parts = text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const refs: Array<LineRef> = [];
  for (const part of parts) {
    const ref = Schema.decodeOption(LineRef)(part);
    if (ref._tag === "None") return `“${part}” isn't a line like tram:10 or bus:58A`;
    refs.push(ref.value);
  }
  return refs;
};

interface LegDraft {
  readonly to: string;
  readonly modes: ReadonlyArray<Mode>;
  readonly prefer: string;
  readonly avoid: string;
}

/** Create or edit a route: a chain of areas with per-leg line rules. */
const RouteEditor = (props: {
  city: CitySummary;
  areas: ReadonlyArray<AreaRecord>;
  routes: ReadonlyArray<CorridorRecord>;
  editing: CorridorRecord | undefined;
  onDone: () => void;
}) => {
  // The editor starts from a snapshot; later store changes don't reset the form.
  const initial = untrack(() => props.editing?.corridor);
  const firstArea = untrack(() => props.areas[0]?.area.slug ?? "");
  const secondArea = untrack(() => props.areas[1]?.area.slug ?? "");
  const [name, setName] = createSignal(initial?.name ?? "");
  const [start, setStart] = createSignal<string>(initial?.legs[0]?.from ?? firstArea);
  const [legs, setLegs] = createSignal<ReadonlyArray<LegDraft>>(
    initial?.legs.map((leg) => ({
      to: leg.to,
      modes: leg.allow.modes ?? [],
      prefer: (leg.prefer ?? []).join(", "),
      avoid: (leg.avoid ?? []).join(", "),
    })) ?? [{ to: secondArea, modes: [], prefer: "", avoid: "" }],
  );
  const [error, setError] = createSignal<string>();

  const update = (i: number, patch: Partial<LegDraft>) =>
    setLegs((list) => list.map((leg, j) => (j === i ? { ...leg, ...patch } : leg)));

  const save = () => {
    const built = [];
    let from = start();
    for (const leg of legs()) {
      const prefer = parseLines(leg.prefer);
      const avoid = parseLines(leg.avoid);
      if (typeof prefer === "string") return setError(prefer);
      if (typeof avoid === "string") return setError(avoid);
      built.push({
        from,
        to: leg.to,
        allow: leg.modes.length === 0 ? {} : { modes: leg.modes },
        ...(prefer.length === 0 ? {} : { prefer }),
        ...(avoid.length === 0 ? {} : { avoid }),
      });
      from = leg.to;
    }
    const taken = new Set(
      props.routes.filter((r) => r.id !== props.editing?.id).map((r) => r.corridor.slug),
    );
    const corridor = Schema.decodeUnknownExit(Corridor)({
      slug: initial?.slug ?? slugify(name(), taken),
      cityId: props.city.id,
      name: name().trim(),
      legs: built,
    });
    if (corridor._tag === "Failure") {
      return setError(
        name().trim() === ""
          ? "Give the route a name."
          : "Each hop needs two different areas, continuing from the previous one.",
      );
    }
    setError(undefined);
    withStore((s) =>
      s.saveCorridor({
        _tag: "Corridor",
        ...(props.editing === undefined ? {} : { id: props.editing.id }),
        corridor: corridor.value,
      }),
    );
    props.onDone();
  };

  const AreaSelect = (p: { value: string; onChange: (slug: string) => void; label: string }) => (
    <select aria-label={p.label} onChange={(e) => p.onChange(e.currentTarget.value)}>
      <For each={props.areas}>
        {(r) => (
          <option value={r.area.slug} selected={r.area.slug === p.value}>
            {r.area.name}
          </option>
        )}
      </For>
    </select>
  );

  return (
    <form
      class="card route-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3>{props.editing === undefined ? "New route" : "Edit route"}</h3>
      <label class="stack">
        Name
        <input value={name()} onInput={(e) => setName(e.currentTarget.value)} required />
      </label>
      <label class="stack">
        Start at
        <AreaSelect value={start()} onChange={setStart} label="First area" />
      </label>
      <ol class="legs-editor">
        <For each={legs()}>
          {(leg, i) => (
            <li>
              <label class="stack">
                Then to
                <AreaSelect
                  value={leg.to}
                  onChange={(to) => update(i(), { to })}
                  label={`Area ${i() + 2}`}
                />
              </label>
              <fieldset class="modes">
                <legend class="sr-only">Modes</legend>
                <For each={["tram", "bus"] as const}>
                  {(mode) => (
                    <label class="check">
                      <input
                        type="checkbox"
                        checked={leg.modes.length === 0 || leg.modes.includes(mode)}
                        onChange={(e) => {
                          const all = leg.modes.length === 0 ? ["tram", "bus"] : leg.modes;
                          const next = e.currentTarget.checked
                            ? [...new Set([...all, mode])]
                            : all.filter((m) => m !== mode);
                          update(i(), { modes: next.length === 2 ? [] : (next as Array<Mode>) });
                        }}
                      />
                      {mode}
                    </label>
                  )}
                </For>
              </fieldset>
              <label class="stack">
                Prefer lines
                <input
                  placeholder="tram:10, tram:14"
                  value={leg.prefer}
                  onInput={(e) => update(i(), { prefer: e.currentTarget.value })}
                />
              </label>
              <label class="stack">
                Avoid lines
                <input
                  placeholder="bus:58A"
                  value={leg.avoid}
                  onInput={(e) => update(i(), { avoid: e.currentTarget.value })}
                />
              </label>
              <Show when={legs().length > 1}>
                <button
                  type="button"
                  class="ghost small"
                  onClick={() => setLegs((list) => list.filter((_, j) => j !== i()))}
                >
                  Remove hop
                </button>
              </Show>
            </li>
          )}
        </For>
      </ol>
      <div class="actions">
        <button
          type="button"
          onClick={() =>
            setLegs((list) => [...list, { to: start(), modes: [], prefer: "", avoid: "" }])
          }
        >
          Add hop
        </button>
        <span class="spacer" />
        <button type="button" class="ghost" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" class="primary">
          Save route
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
  );
};

export const PlacesView = (props: { city: CitySummary }) => {
  const records = useCity(() => props.city.id);
  const [editing, setEditing] = createSignal<CorridorRecord | "new">();
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
          <button
            type="button"
            disabled={records().areas.length < 2}
            onClick={() => setEditing("new")}
          >
            New route
          </button>
        </div>
        <p class="subtitle">
          Chains of interchange areas you travel through. The comparison and trip views time them
          against the live timetable.
        </p>
        <Show when={editing()}>
          {(current) => (
            <RouteEditor
              city={props.city}
              areas={records().areas}
              routes={records().corridors}
              editing={current() === "new" ? undefined : (current() as CorridorRecord)}
              onDone={() => setEditing(undefined)}
            />
          )}
        </Show>
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
                <button type="button" class="ghost small" onClick={() => setEditing(record())}>
                  Edit
                </button>
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
