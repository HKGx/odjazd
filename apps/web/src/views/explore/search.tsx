import type { CityId } from "@odjazd/model";
import type { Place as PlaceRecord } from "@odjazd/user-data";
import { type SearchHitDto, type StopsDto, TimetableClient } from "@odjazd/worker";
import { Effect } from "effect";
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  Loading,
  Match,
  Show,
  Switch,
} from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import { navigate, type Place, route } from "../../route.ts";
import { kindIcon, useCity } from "../../user.ts";
import { chooseStart, resolver, startOf } from "./endpoints.ts";
import { LineBadge } from "./parts.tsx";

/** A row: your location, one of your places, or a stop or line from the timetable. */
type Row =
  | SearchHitDto
  | { readonly _tag: "Here" }
  | { readonly _tag: "Place"; readonly place: PlaceRecord };

const rowKey = (row: Row) =>
  row._tag === "Stop"
    ? `s${row.stop.group}`
    : row._tag === "Line"
      ? `l${row.line.id}`
      : row._tag === "Place"
        ? `p${row.place.id}`
        : "here";

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

type PlaceRow = Extract<Row, { _tag: "Place" }>;
type LineHit = Extract<SearchHitDto, { _tag: "Line" }>;
type StopHit = Extract<SearchHitDto, { _tag: "Stop" }>;

const HitRow = (props: { hit: Row; departures: boolean }) => (
  <Switch>
    <Match when={props.hit._tag === "Here"}>
      <span class="place-icon" aria-hidden="true">
        ◎
      </span>
      <span class="hit-main">
        <span>My location</span>
      </span>
    </Match>
    <Match when={props.hit._tag === "Place" ? (props.hit as PlaceRow) : undefined}>
      {(hit) => (
        <>
          <span class="place-icon" aria-hidden="true">
            {kindIcon[hit().place.kind]}
          </span>
          <span class="hit-main">
            <span>{hit().place.name}</span>
          </span>
        </>
      )}
    </Match>
    <Match when={props.hit._tag === "Line" ? (props.hit as LineHit) : undefined}>
      {(hit) => (
        <>
          <LineBadge line={hit().line} />
          <span class="hit-main">
            <span>Line {hit().line.label}</span>
            <span class="muted small">{hit().headsigns.join(" ↔ ")}</span>
          </span>
        </>
      )}
    </Match>
    <Match when={props.hit._tag === "Stop" ? (props.hit as StopHit) : undefined}>
      {(hit) => (
        <>
          <span class="stop-icon" aria-hidden="true" />
          <span class="hit-main">
            <span>{hit().stop.name}</span>
            <span class="hit-lines">
              <For each={hit().stop.lines.slice(0, 12)}>
                {(line) => <LineBadge line={line} small />}
              </For>
            </span>
          </span>
          <Show when={props.departures}>
            {/* Choosing the row plans a trip there; the stop itself is one tap away. */}
            <button
              type="button"
              class="ghost small hit-aside"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate({ page: "stop", group: hit().stop.group });
              }}
            >
              Departures
            </button>
          </Show>
        </>
      )}
    </Match>
  </Switch>
);

/**
 * One trip end. Shows its current value; focused, it searches your places and
 * the timetable's stops (and lines, for the destination).
 */
const EndField = (props: {
  id: string;
  label: string;
  placeholder: string;
  value: string | undefined;
  note: string | undefined;
  hash: string;
  city: CityId;
  end: "from" | "to";
  onPick: (place: Place) => void;
}) => {
  const [text, setText] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let input: HTMLInputElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const type = (value: string) => {
    setText(value);
    setOpen(true);
    setActive(0);
    clearTimeout(timer);
    timer = setTimeout(() => setQuery(value.trim()), 90);
  };

  const hits = createEffectMemo(() => {
    const q = query();
    if (q === "") return Effect.succeed<ReadonlyArray<SearchHitDto>>([]);
    const request = { hash: props.hash, text: q, limit: 12 };
    return TimetableClient.use((worker) => worker.Search(request));
  });
  const records = useCity(() => props.city);
  const mine = createMemo((): ReadonlyArray<Row> => {
    const q = fold(query());
    const places = records()
      .places.filter((place) => q === "" || fold(place.name).includes(q))
      .map((place): Row => ({ _tag: "Place", place }));
    const here = props.end === "from" && (q === "" || fold("my location").includes(q));
    return here ? [{ _tag: "Here" }, ...places] : places;
  });
  // Only the destination opens lines; a start is a place to be.
  const found = createMemo(() =>
    props.end === "to" ? hits() : hits().filter((hit) => hit._tag === "Stop"),
  );
  // Focused and empty: your location and places, ready to go.
  const list = createMemo((): ReadonlyArray<Row> =>
    !open() ? [] : query() === "" ? mine() : [...mine(), ...found()],
  );
  const shown = () => open() && list().length + (query() === "" ? 0 : 1) > 0;

  const close = () => {
    setOpen(false);
    setText("");
    setQuery("");
  };
  const choose = (row: Row | undefined) => {
    if (row === undefined) return;
    close();
    input?.blur();
    if (row._tag === "Here") props.onPick({ kind: "here" });
    else if (row._tag === "Place") props.onPick({ kind: "place", id: row.place.id });
    else if (row._tag === "Stop") props.onPick({ kind: "stop", group: row.stop.group });
    else navigate({ page: "line", line: row.line.id, direction: 0 });
  };

  return (
    <div class="end-field">
      <label class="sr-only" for={props.id}>
        {props.label}
      </label>
      <input
        ref={(element) => (input = element)}
        id={props.id}
        type="search"
        placeholder={open() ? "Search places and stops" : props.placeholder}
        autocomplete="off"
        role="combobox"
        aria-expanded={shown() ? "true" : "false"}
        aria-controls={`${props.id}-results`}
        // Editing starts empty; otherwise the field shows what's chosen.
        value={open() ? text() : (props.value ?? "")}
        onInput={(e) => type(e.currentTarget.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={(e) => {
          const count = list().length;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(count - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            choose(list()[active()]);
          } else if (e.key === "Escape") {
            close();
            input?.blur();
          }
        }}
      />
      <Show when={!open() && props.note}>
        {(note) => <span class="end-note muted small">{note()}</span>}
      </Show>
      <Show when={shown()}>
        <Loading fallback={null}>
          <ul class="search-results" id={`${props.id}-results`} role="listbox">
            <For
              each={list()}
              keyed={rowKey}
              fallback={<li class="muted search-empty">No places or stops match.</li>}
            >
              {(hit, index) => (
                <li
                  role="option"
                  aria-selected={index() === active() ? "true" : "false"}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(hit());
                  }}
                >
                  <HitRow hit={hit()} departures={props.end === "to"} />
                </li>
              )}
            </For>
          </ul>
        </Loading>
      </Show>
    </div>
  );
};

/**
 * The trip question, always at the top of the map: from (your location, or
 * what you last picked) and where to. On a trip it is that trip's two ends.
 */
export const PlanBar = (props: {
  hash: string;
  city: CityId;
  stops: Accessor<StopsDto | undefined>;
}) => {
  const records = useCity(() => props.city);
  const resolve = resolver(() => records().places, props.stops);
  const trip = createMemo(() => {
    const r = route();
    return r.page === "trip" ? r : undefined;
  });
  const fromPlace = createMemo(() => trip()?.from ?? startOf(props.city));
  const toPlace = createMemo(() => trip()?.to);
  const from = createMemo(() => resolve(fromPlace()));
  const to = createMemo(() => resolve(toPlace()));

  const pickFrom = (place: Place) => {
    chooseStart(props.city, place);
    if (trip() !== undefined) navigate({ page: "trip", from: place, to: toPlace() });
  };
  const pickTo = (place: Place) => navigate({ page: "trip", from: fromPlace(), to: place });
  const swap = () => {
    const next = toPlace();
    if (next === undefined) return;
    chooseStart(props.city, next);
    navigate({ page: "trip", from: next, to: fromPlace() });
  };

  return (
    <div class="plan-bar" role="search">
      <div class="ends">
        <EndField
          id="trip-from"
          label="From"
          placeholder="From"
          value={from()?.label}
          note={from()?.pending}
          hash={props.hash}
          city={props.city}
          end="from"
          onPick={pickFrom}
        />
        <EndField
          id="trip-to"
          label="Where to?"
          placeholder="Where to?"
          value={to()?.label}
          note={to()?.pending}
          hash={props.hash}
          city={props.city}
          end="to"
          onPick={pickTo}
        />
      </div>
      <button
        type="button"
        class="ghost swap"
        aria-label="Swap start and destination"
        disabled={toPlace() === undefined}
        onClick={swap}
      >
        ⇅
      </button>
    </div>
  );
};
