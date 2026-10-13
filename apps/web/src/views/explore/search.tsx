import { type SearchHitDto, TimetableClient } from "@odjazd/worker";
import { Effect } from "effect";
import { createMemo, createSignal, For, Loading, Match, Show, Switch } from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import { navigate } from "../../route.ts";
import { LineBadge } from "./parts.tsx";

const hitKey = (hit: SearchHitDto) =>
  hit._tag === "Stop" ? `s${hit.stop.group}` : `l${hit.line.id}`;

type LineHit = Extract<SearchHitDto, { _tag: "Line" }>;
type StopHit = Extract<SearchHitDto, { _tag: "Stop" }>;

const HitRow = (props: { hit: SearchHitDto }) => (
  <Switch>
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
        </>
      )}
    </Match>
  </Switch>
);

/** Stop and line search over the on-device timetable. */
export const SearchBox = (props: {
  hash: string;
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
  const list = createMemo(() => (open() && query() !== "" ? hits() : []));

  const choose = (hit: SearchHitDto | undefined) => {
    if (hit === undefined) return;
    setOpen(false);
    setText(hit._tag === "Stop" ? hit.stop.name : `Line ${hit.line.label}`);
    if (hit._tag === "Stop") navigate({ page: "stop", group: hit.stop.group });
    else navigate({ page: "line", line: hit.line.id, direction: 0 });
  };

  return (
    <div class="search" role="search">
      <label class="sr-only" for="search-input">
        Search stops and lines
      </label>
      <input
        id="search-input"
        type="search"
        placeholder="Search a stop or line"
        autocomplete="off"
        role="combobox"
        aria-expanded={open() && query() !== "" ? "true" : "false"}
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
      <Show when={open() && query() !== ""}>
        <Loading fallback={null}>
          <ul class="search-results" id="search-results" role="listbox">
            <For
              each={list()}
              keyed={hitKey}
              fallback={<li class="muted search-empty">No stops or lines match.</li>}
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
