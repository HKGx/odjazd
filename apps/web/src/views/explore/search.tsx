import type { CityId } from "@odjazd/model";
import { type SearchHitDto, TimetableClient } from "@odjazd/worker";
import { Effect } from "effect";
import { createMemo, createSignal, For, Loading, Match, Show, Switch } from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import { navigate } from "../../route.ts";
import type { Place as PlaceRecord } from "@odjazd/user-data";
import { kindIcon, useCity } from "../../user.ts";
import { LineBadge } from "./parts.tsx";

/** A row: one of your places, or a stop or line from the timetable. */
type Row = SearchHitDto | { readonly _tag: "Place"; readonly place: PlaceRecord };

const rowKey = (row: Row) =>
  row._tag === "Stop"
    ? `s${row.stop.group}`
    : row._tag === "Line"
      ? `l${row.line.id}`
      : `p${row.place.id}`;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

type LineHit = Extract<SearchHitDto, { _tag: "Line" }>;
type StopHit = Extract<SearchHitDto, { _tag: "Stop" }>;

type PlaceRow = Extract<Row, { _tag: "Place" }>;

const HitRow = (props: { hit: Row }) => (
  <Switch>
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
        </>
      )}
    </Match>
  </Switch>
);

/**
 * "Where to?": your places, stops and lines. A place or stop plans a trip there from
 * where you are; a line opens it on the map.
 */
export const SearchBox = (props: {
  hash: string;
  city: CityId;
  near?: { lat: number; lon: number } | undefined;
}) => {
  const [text, setText] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
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
    const request = {
      hash: props.hash,
      text: q,
      limit: 12,
      ...(props.near === undefined ? {} : { near: props.near }),
    };
    return TimetableClient.use((worker) => worker.Search(request));
  });
  const records = useCity(() => props.city);
  const places = createMemo((): ReadonlyArray<Row> => {
    const q = fold(query());
    return records()
      .places.filter((place) => q === "" || fold(place.name).includes(q))
      .map((place) => ({ _tag: "Place", place }));
  });
  // Focused and empty: your places, ready to go.
  const list = createMemo((): ReadonlyArray<Row> =>
    !open() ? [] : query() === "" ? places() : [...places(), ...hits()],
  );
  const shown = () => open() && list().length + (query() === "" ? 0 : 1) > 0;

  const choose = (hit: Row | undefined) => {
    if (hit === undefined) return;
    setOpen(false);
    setText("");
    setQuery("");
    (document.activeElement as HTMLElement | null)?.blur();
    const from = { kind: "here" } as const;
    if (hit._tag === "Place")
      navigate({ page: "trip", from, to: { kind: "place", id: hit.place.id } });
    else if (hit._tag === "Stop")
      navigate({ page: "trip", from, to: { kind: "stop", group: hit.stop.group } });
    else navigate({ page: "line", line: hit.line.id, direction: 0 });
  };

  return (
    <div class="search" role="search">
      <label class="sr-only" for="search-input">
        Where to? Search your places, stops and lines
      </label>
      <input
        id="search-input"
        type="search"
        placeholder="Where to?"
        autocomplete="off"
        role="combobox"
        aria-expanded={shown() ? "true" : "false"}
        aria-controls="search-results"
        value={text()}
        onInput={(e) => type(e.currentTarget.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
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
            setOpen(false);
          }
        }}
      />
      <Show when={shown()}>
        <Loading fallback={null}>
          <ul class="search-results" id="search-results" role="listbox">
            <For
              each={list()}
              keyed={rowKey}
              fallback={<li class="muted search-empty">No places, stops or lines match.</li>}
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
                  <HitRow hit={hit()} />
                </li>
              )}
            </For>
          </ul>
        </Loading>
      </Show>
    </div>
  );
};
