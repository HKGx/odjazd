import {
  type CityId,
  Corridor,
  type InterchangeArea,
  type LineRef,
  type Mode,
} from "@odjazd/model";
import { type JourneyDto, type StopsDto, TimetableClient } from "@odjazd/worker";
import { Effect, Schema } from "effect";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  isPending,
  Loading,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import { clock } from "../../format.ts";
import type { LiveMap } from "../../map/live-map.ts";
import { mapPick } from "../../map/pick.ts";
import { now } from "../../now.ts";
import { href, navigate } from "../../route.ts";
import {
  appendArea,
  chipState,
  cycleChip,
  draftProblem,
  emptyDraft,
  fromCorridor,
  type HopRule,
  hopsOf,
  lineRef,
  moveArea,
  removeArea,
  type RouteDraft,
  setHop,
  toCorridor,
} from "../../route-draft.ts";
import { slugify } from "../../slug.ts";
import { preferences, useCity, withStore } from "../../user.ts";
import { takeHandoff } from "./handoff.ts";
import { LineBadge } from "./parts.tsx";
import { nearestStop } from "./endpoints.ts";
import { LegChips } from "./trip.tsx";

const stateLabel = { any: "any", preferred: "preferred", avoided: "avoided" } as const;

/**
 * The lines between two neighbouring areas as chips: tap to cycle any →
 * preferred → avoided. Only what actually runs there is offered.
 */
const HopEditor = (props: {
  hash: string;
  from: InterchangeArea;
  to: InterchangeArea;
  rule: HopRule;
  onChange: (rule: HopRule) => void;
}) => {
  const summary = createEffectMemo(() => {
    const query = { hash: props.hash, from: props.from, to: props.to, at: untrack(now) };
    return TimetableClient.use((worker) => worker.SectionLines(query));
  });
  // Lines the rule names but that don't run today still get a chip.
  const chips = createMemo(() => {
    const running = summary().map((entry) => ({ ...entry, ref: lineRef(entry.line) }));
    const known = new Set<string>(running.map((entry) => entry.ref));
    const named = [...props.rule.prefer, ...props.rule.avoid].filter((ref) => !known.has(ref));
    return [
      ...running,
      ...named.map((ref) => {
        const [mode, label] = ref.split(":") as [Mode, string];
        return { line: { id: ref, label, mode }, ref, trips: 0, rideSec: 0 };
      }),
    ];
  });
  const modes = createMemo(() => [...new Set(summary().map((entry) => entry.line.mode))]);
  const describe = () => {
    const rule = props.rule;
    const names = (refs: ReadonlyArray<LineRef>) => refs.map((r) => r.split(":")[1]).join(", ");
    if (rule.only && rule.prefer.length > 0) return `Only ${names(rule.prefer)}.`;
    const parts = [rule.prefer.length > 0 ? `Prefers ${names(rule.prefer)}` : "Any line"];
    if (rule.avoid.length > 0) parts.push(`never ${names(rule.avoid)}`);
    if (rule.modes.length > 0) parts.push(`${rule.modes.join(" or ")} only`);
    return `${parts.join("; ")}.`;
  };
  return (
    <div class="hop" data-pending={isPending(() => summary())}>
      <Loading fallback={<p class="muted small">Finding what runs here…</p>}>
        <Show
          when={chips().length > 0}
          fallback={
            <p class="form-error small">
              Nothing runs directly from {props.from.name} to {props.to.name}. Add an area in
              between, or make one of them bigger.
            </p>
          }
        >
          <div class="line-chips" role="group" aria-label="Lines on this hop">
            <For each={chips()}>
              {(chip) => {
                const state = () => chipState(props.rule, chip.ref);
                return (
                  <button
                    type="button"
                    class={{ "line-chip": true, [state()]: true }}
                    aria-label={`${chip.line.label}: ${stateLabel[state()]}`}
                    title={
                      chip.trips === 0
                        ? "Not running in the next 24 hours"
                        : `${chip.trips} runs in the next 24 h · ~${Math.round(chip.rideSec / 60)} min ride`
                    }
                    onClick={() => props.onChange(cycleChip(props.rule, chip.ref))}
                  >
                    <LineBadge line={chip.line} small />
                    <span class="chip-mark" aria-hidden="true">
                      {state() === "preferred" ? "★" : state() === "avoided" ? "⊘" : ""}
                    </span>
                    <Show when={chip.trips > 0}>
                      <span class="muted chip-ride">{Math.round(chip.rideSec / 60)}′</span>
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
          <div class="hop-options small">
            <label class="check">
              <input
                type="checkbox"
                checked={props.rule.only}
                disabled={props.rule.prefer.length === 0}
                onChange={(e) => props.onChange({ ...props.rule, only: e.currentTarget.checked })}
              />
              Only my preferred lines
            </label>
            <Show when={modes().length > 1}>
              <For each={modes()}>
                {(mode) => (
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={props.rule.modes.includes(mode)}
                      onChange={(e) =>
                        props.onChange({
                          ...props.rule,
                          modes: e.currentTarget.checked
                            ? [...props.rule.modes, mode]
                            : props.rule.modes.filter((m) => m !== mode),
                        })
                      }
                    />
                    {mode === "bus" ? "buses" : `${mode}s`} only
                  </label>
                )}
              </For>
            </Show>
          </div>
          <p class="muted small hop-summary">{describe()}</p>
        </Show>
      </Loading>
    </div>
  );
};

/** Add an area by stop name; tapping the map does the same. */
const AddByName = (props: { hash: string; onStop: (group: number) => void }) => {
  const [text, setText] = createSignal("");
  const hits = createEffectMemo(() => {
    const query = { hash: props.hash, text: text(), limit: 5 };
    if (query.text.trim() === "") return Effect.succeed([]);
    return TimetableClient.use((worker) => worker.Search(query));
  });
  return (
    <div class="add-area">
      <input
        placeholder="Add a stop by name…"
        aria-label="Add a stop by name"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <Loading>
        <ul class="endpoint-options">
          <For each={hits()}>
            {(hit) => (
              <Show when={hit._tag === "Stop" ? hit.stop : undefined}>
                {(stop) => (
                  <li>
                    <button
                      type="button"
                      class="ghost"
                      onClick={() => {
                        setText("");
                        props.onStop(stop().group);
                      }}
                    >
                      <span class="stop-icon" aria-hidden="true" /> {stop().name}
                    </button>
                  </li>
                )}
              </Show>
            )}
          </For>
        </ul>
      </Loading>
    </div>
  );
};

/** Leaving now along the draft, end to end: does it work, and how long is it? */
const Preview = (props: {
  hash: string;
  draft: RouteDraft;
  city: CityId;
  timeZone: string;
  map: Accessor<LiveMap | undefined>;
}) => {
  const [shown, setShown] = createSignal<JourneyDto>();
  const result = createEffectMemo(() => {
    const prefs = untrack(preferences);
    const corridor = Schema.decodeExit(Corridor)(
      toCorridor({ ...props.draft, name: "preview" }, "preview", props.city),
    );
    if (corridor._tag === "Failure") return Effect.succeed([]);
    const query = {
      hash: props.hash,
      areas: props.draft.areas.map((d) => d.area),
      corridor: corridor.value,
      at: untrack(now),
      count: 3,
      transferBufferSec: prefs.transferBufferSec,
      walkingSpeedKmh: prefs.walkingSpeedKmh,
      preferencePenaltySec: prefs.preferencePenaltyMin * 60,
    };
    return TimetableClient.use((worker) => worker.RouteNow(query));
  });
  createEffect(
    () => [props.map(), shown()] as const,
    ([map, journey]) => {
      if (map === undefined || journey === undefined) return;
      map.setJourney({
        legs: journey.legs.map((leg) => ({
          kind: leg._tag === "Ride" ? ("ride" as const) : ("walk" as const),
          mode: leg._tag === "Ride" ? leg.line.mode : undefined,
          path: leg.path,
        })),
      });
      return () => map.setJourney(undefined);
    },
  );
  createEffect(result, () => setShown(undefined));
  return (
    <div class="card preview" data-pending={isPending(() => result())}>
      <h3>If you left now</h3>
      <Loading fallback={<p class="muted small">Timing it…</p>}>
        <Show
          when={result().length > 0}
          fallback={<p class="muted small">Nothing following this route in the next 2 hours.</p>}
        >
          <ul class="preview-list">
            <For each={result()}>
              {(journey) => (
                <li>
                  <button
                    type="button"
                    class={{ ghost: true, open: shown() === journey }}
                    aria-pressed={shown() === journey ? "true" : "false"}
                    onClick={() => setShown(shown() === journey ? undefined : journey)}
                  >
                    <strong>
                      {clock(journey.departAt, props.timeZone)} →{" "}
                      {clock(journey.arriveAt, props.timeZone)}
                    </strong>{" "}
                    <span class="muted small">
                      {Math.round((journey.arriveAt - journey.departAt) / 60)} min
                    </span>
                    <LegChips journey={journey} />
                  </button>
                </li>
              )}
            </For>
          </ul>
          <p class="muted small">From the middle of the first area to the middle of the last.</p>
        </Show>
      </Loading>
    </div>
  );
};

/**
 * Create or edit a route on the map: tap stops (or long-press anywhere) to
 * add interchange areas in order, then pick which lines to use between them.
 */
export const RouteEditorPanel = (props: {
  hash: string;
  city: CityId;
  timeZone: string;
  id: string | undefined;
  stops: Accessor<StopsDto | undefined>;
  map: Accessor<LiveMap | undefined>;
}) => {
  const records = useCity(() => props.city);
  const record = createMemo(() => records().corridors.find((r) => r.id === props.id));
  const saved = () => records().areas.map((r) => r.area);

  // Starts from a snapshot; later store changes don't reset the form.
  const initial = untrack(() => {
    const existing = record();
    if (existing !== undefined) return fromCorridor(existing.corridor, saved());
    return takeHandoff() ?? emptyDraft;
  });
  const [draft, setDraft] = createSignal<RouteDraft>(initial);
  const [error, setError] = createSignal<string>();
  const [notice, setNotice] = createSignal<string>();
  const update = (next: RouteDraft) => {
    setDraft(next);
    setNotice(undefined);
  };

  const addStop = (group: number) => {
    const stops = untrack(props.stops);
    const name = stops?.names[group];
    if (stops === undefined || name === undefined) return;
    const center = { lat: stops.lat[group] ?? 0, lon: stops.lon[group] ?? 0 };
    update(appendArea(untrack(draft), untrack(saved), props.city, name, center));
  };
  const addPoint = (lat: number, lon: number) => {
    const near = nearestStop(untrack(props.stops), lat, lon);
    const name = near === undefined ? "Point" : `Near ${near}`;
    update(appendArea(untrack(draft), untrack(saved), props.city, name, { lat, lon }, 200));
  };
  mapPick.stop = addStop;
  mapPick.point = addPoint;
  onCleanup(() => {
    mapPick.stop = undefined;
    mapPick.point = undefined;
  });

  createEffect(
    () => [props.map(), draft().areas] as const,
    ([map, areas]) => {
      map?.setDraft({ areas: areas.map((d) => d.area) });
      return () => map?.setDraft(undefined);
    },
  );
  // Frame the route when it opens and as areas are added or removed.
  createEffect(
    () => [props.map(), draft().areas.length] as const,
    ([map, count]) => {
      if (map === undefined || count === 0) return;
      untrack(() =>
        map.fitPoints(
          draft().areas.map((d) => d.area.center),
          80,
        ),
      );
    },
  );

  const hops = createMemo(() => hopsOf(draft()));
  const usable = () => {
    const d = draft();
    return d.areas.length >= 2 && draftProblem({ ...d, name: "x" }) === undefined;
  };

  const save = () => {
    const d = draft();
    const problem = draftProblem(d);
    if (problem !== undefined) return setError(problem);
    const existing = record();
    const taken = new Set(
      records()
        .corridors.filter((r) => r.id !== existing?.id)
        .map((r) => r.corridor.slug as string),
    );
    const slug = existing?.corridor.slug ?? slugify(d.name, taken);
    const corridor = Schema.decodeExit(Corridor)(toCorridor(d, slug, props.city));
    if (corridor._tag === "Failure") return setError("This route can't be saved as it is.");
    setError(undefined);
    const fresh = d.areas.filter((a) => !a.saved).map((a) => a.area);
    withStore((store) =>
      Effect.forEach(fresh, (area) => store.saveArea({ _tag: "Area", area }), {
        discard: true,
      }).pipe(
        Effect.andThen(
          store.saveCorridor({
            _tag: "Corridor",
            ...(existing === undefined ? {} : { id: existing.id }),
            corridor: corridor.value,
          }),
        ),
        Effect.andThen((saved) =>
          Effect.sync(() => {
            setDraft({ ...d, areas: d.areas.map((a) => ({ ...a, saved: true })) });
            setNotice(`Saved. Trips that fit “${saved.corridor.name}” will suggest it.`);
            if (existing === undefined) navigate({ page: "route", id: saved.id });
          }),
        ),
        Effect.catch(() => Effect.sync(() => setError("This route can't be saved as it is."))),
      ),
    );
  };

  const remove = () => {
    const existing = record();
    if (existing === undefined) return;
    withStore((store) =>
      store
        .remove(existing.id)
        .pipe(Effect.andThen(Effect.sync(() => navigate({ page: "places" })))),
    );
  };

  return (
    <article class="panel-body route-editor-panel">
      <h2>{props.id === undefined ? "New route" : "Edit route"}</h2>
      <label class="stack">
        Name
        <input
          value={draft().name}
          placeholder="e.g. To work via Mickiewicza"
          onInput={(e) => update({ ...draft(), name: e.currentTarget.value })}
        />
      </label>
      <p class="muted small">
        Tap stops on the map in the order you travel, or long-press anywhere. Each becomes an
        interchange area: any stop inside it will do.
      </p>

      <ol class="draft-areas">
        <For each={draft().areas}>
          {(entry, i) => (
            <>
              <Show when={i() > 0 ? hops()[i() - 1] : undefined}>
                {(hop) => (
                  <li class="draft-hop">
                    <HopEditor
                      hash={props.hash}
                      from={hop().from}
                      to={hop().to}
                      rule={hop().rule}
                      onChange={(rule) =>
                        update(setHop(draft(), hop().from.slug, hop().to.slug, rule))
                      }
                    />
                  </li>
                )}
              </Show>
              <li class="draft-area">
                <span class="area-number" aria-hidden="true">
                  {i() + 1}
                </span>
                <span class="hit-main">
                  <strong>{entry.area.name}</strong>
                  <span class="muted small">
                    {entry.saved ? "saved area" : "new area"} · {entry.area.radiusMeters} m
                  </span>
                  <Show when={!entry.saved}>
                    <input
                      type="range"
                      min="60"
                      max="500"
                      step="20"
                      aria-label={`Size of ${entry.area.name}`}
                      value={String(entry.area.radiusMeters)}
                      onInput={(e) => {
                        const radiusMeters = Number(e.currentTarget.value);
                        update({
                          ...draft(),
                          areas: draft().areas.map((a, j) =>
                            j === i() ? { ...a, area: { ...a.area, radiusMeters } } : a,
                          ),
                        });
                      }}
                    />
                  </Show>
                </span>
                <span class="area-actions">
                  <button
                    type="button"
                    class="ghost small"
                    aria-label={`Move ${entry.area.name} earlier`}
                    disabled={i() === 0}
                    onClick={() => update(moveArea(draft(), i(), -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="ghost small"
                    aria-label={`Move ${entry.area.name} later`}
                    disabled={i() === draft().areas.length - 1}
                    onClick={() => update(moveArea(draft(), i(), 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    class="ghost small"
                    aria-label={`Remove ${entry.area.name}`}
                    onClick={() => update(removeArea(draft(), i()))}
                  >
                    ✕
                  </button>
                </span>
              </li>
            </>
          )}
        </For>
      </ol>

      <AddByName hash={props.hash} onStop={addStop} />
      <Show when={records().areas.length > 0}>
        <select
          aria-label="Add a saved area"
          onChange={(e) => {
            const area = saved().find((a) => a.slug === e.currentTarget.value);
            e.currentTarget.value = "";
            if (area !== undefined) {
              update(appendArea(draft(), saved(), props.city, area.name, area.center));
            }
          }}
        >
          <option value="">Add one of your areas…</option>
          <For each={saved()}>{(area) => <option value={area.slug}>{area.name}</option>}</For>
        </select>
      </Show>

      <Show when={usable()}>
        <Preview
          hash={props.hash}
          draft={draft()}
          city={props.city}
          timeZone={props.timeZone}
          map={props.map}
        />
      </Show>

      <Show when={error()}>{(text) => <p class="form-error">{text()}</p>}</Show>
      <Show when={notice()}>
        {(text) => (
          <p class="notice" role="status">
            {text()}
          </p>
        )}
      </Show>
      <div class="actions">
        <button type="button" onClick={save}>
          Save route
        </button>
        <a class="button ghost" href={href({ page: "places" })}>
          Done
        </a>
        <Show when={record()}>
          <button type="button" class="ghost danger" onClick={remove}>
            Delete
          </button>
        </Show>
      </div>
    </article>
  );
};
