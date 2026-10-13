import type { CityId } from "@odjazd/model";
import {
  type JourneyDto,
  type LiveDto,
  type PlanEndpoint,
  type PlanLegDto,
  type StopsDto,
  TimetableClient,
} from "@odjazd/worker";
import { Effect, Option } from "effect";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  isPending,
  Loading,
  Match,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import { clock, fromClock, nowClock } from "../../format.ts";
import { here, locate } from "../../here.ts";
import type { LiveMap } from "../../map/live-map.ts";
import { now } from "../../now.ts";
import { href, navigate, type Place } from "../../route.ts";
import { kindIcon, preferences, useCity } from "../../user.ts";
import { LineBadge, LiveTag } from "./parts.tsx";

interface Resolved {
  readonly label: string;
  readonly endpoint: PlanEndpoint | undefined;
  /** Why there's no endpoint yet (e.g. waiting for a location fix). */
  readonly pending?: string;
}

/** Name of the closest stop group, for labelling a map point. */
const nearestStop = (stops: StopsDto | undefined, lat: number, lon: number) => {
  if (stops === undefined) return undefined;
  let best: string | undefined;
  let bestD = 0.004 ** 2;
  const k = Math.cos((lat * Math.PI) / 180) ** 2;
  stops.names.forEach((name, i) => {
    const d = ((stops.lat[i] ?? 0) - lat) ** 2 + ((stops.lon[i] ?? 0) - lon) ** 2 * k;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  });
  return best;
};

const walkTime = (seconds: number) => (seconds < 60 ? "<1 min" : duration(seconds));

const duration = (seconds: number) => {
  const minutes = Math.max(0, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

/** Pick an endpoint: this device's location, a saved place, or a stop by name. */
const EndpointField = (props: {
  label: string;
  value: Resolved | undefined;
  hash: string;
  city: CityId;
  onPick: (place: Place) => void;
}) => {
  const [editing, setEditing] = createSignal(false);
  const [text, setText] = createSignal("");
  const records = useCity(() => props.city);
  const hits = createEffectMemo(() => {
    const query = { hash: props.hash, text: text(), limit: 6 };
    if (!editing() || query.text.trim() === "") return Effect.succeed([]);
    return TimetableClient.use((worker) => worker.Search(query));
  });
  const pick = (place: Place) => {
    setEditing(false);
    setText("");
    props.onPick(place);
  };
  return (
    <div class="endpoint">
      <span class="endpoint-label">{props.label}</span>
      <Show
        when={editing()}
        fallback={
          <button type="button" class="endpoint-value" onClick={() => setEditing(true)}>
            <Show when={props.value} fallback={<span class="muted">Choose…</span>}>
              {(value) => (
                <>
                  {value().label}
                  <Show when={value().pending}>
                    {(why) => <span class="muted small"> · {why()}</span>}
                  </Show>
                </>
              )}
            </Show>
          </button>
        }
      >
        <div class="endpoint-edit">
          <input
            placeholder="Stop name, or pick below"
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            ref={(element) => queueMicrotask(() => element.focus())}
          />
          <ul class="endpoint-options" role="listbox" aria-label={`${props.label} options`}>
            <li>
              <button type="button" class="ghost" onClick={() => pick({ kind: "here" })}>
                ◎ My location
              </button>
            </li>
            <For each={records().places}>
              {(place) => (
                <li>
                  <button
                    type="button"
                    class="ghost"
                    onClick={() => pick({ kind: "place", id: place.id })}
                  >
                    {kindIcon[place.kind]} {place.name}
                  </button>
                </li>
              )}
            </For>
            <Loading>
              <For each={hits()}>
                {(hit) => (
                  <Show when={hit._tag === "Stop" ? hit.stop : undefined}>
                    {(stop) => (
                      <li>
                        <button
                          type="button"
                          class="ghost"
                          onClick={() => pick({ kind: "stop", group: stop().group })}
                        >
                          <span class="stop-icon" aria-hidden="true" /> {stop().name}
                        </button>
                      </li>
                    )}
                  </Show>
                )}
              </For>
            </Loading>
          </ul>
          <button type="button" class="ghost small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </Show>
    </div>
  );
};

const LegChips = (props: { journey: JourneyDto }) => (
  <span class="chips">
    <For each={props.journey.legs}>
      {(leg, i) => (
        <>
          <Show when={i() > 0}>
            <span class="chip-sep" aria-hidden="true">
              ›
            </span>
          </Show>
          <Switch>
            <Match when={leg._tag === "Ride" ? leg : undefined}>
              {(ride) => <LineBadge line={ride().line} small />}
            </Match>
            <Match when={leg._tag === "Walk" ? leg : undefined}>
              {(walk) => (
                <span class="walk-chip" title={`Walk ${walk().meters} m`}>
                  walk {Math.max(1, Math.round((walk().arriveAt - walk().departAt) / 60))}′
                </span>
              )}
            </Match>
          </Switch>
        </>
      )}
    </For>
  </span>
);

const LegDetail = (props: {
  leg: PlanLegDto;
  timeZone: string;
  live: Accessor<LiveDto>;
  last: boolean;
}) => (
  <Switch>
    <Match when={props.leg._tag === "Walk" ? props.leg : undefined}>
      {(walk) => (
        <li class="leg walk">
          <span class="leg-time">{clock(walk().departAt, props.timeZone)}</span>
          <span>
            Walk {walkTime(walk().arriveAt - walk().departAt)} ({walk().meters} m)
            {walk().to === undefined
              ? props.last
                ? " to your destination"
                : ""
              : ` to ${walk().to ?? ""}`}
          </span>
        </li>
      )}
    </Match>
    <Match when={props.leg._tag === "Ride" ? props.leg : undefined}>
      {(ride) => {
        const vehicle = () => props.live().vehicles.find((v) => v.trip === ride().trip);
        return (
          <li class="leg ride">
            <span class="leg-time">
              {clock(ride().departAt, props.timeZone)}
              <Show when={Math.abs(ride().departAt - ride().scheduledDepartAt) >= 60}>
                <s class="muted small">{clock(ride().scheduledDepartAt, props.timeZone)}</s>
              </Show>
            </span>
            <span class="leg-body">
              <span>
                <LineBadge line={ride().line} link /> <strong>{ride().headsign}</strong>
                <Show when={ride().preferred}>
                  <span class="badge">preferred</span>
                </Show>
              </span>
              <span>
                <a href={href({ page: "stop", group: ride().fromGroup })}>{ride().from}</a> →{" "}
                {ride().to}
              </span>
              <span class="muted small">
                {ride().stops} stop{ride().stops === 1 ? "" : "s"} · arrive{" "}
                {clock(ride().arriveAt, props.timeZone)} <LiveTag delay={ride().delay} />
                <Show when={vehicle()}>
                  {(v) => (
                    <>
                      {" "}
                      · <a href={href({ page: "vehicle", id: v().id })}>Track vehicle</a>
                    </>
                  )}
                </Show>
              </span>
            </span>
          </li>
        );
      }}
    </Match>
  </Switch>
);

/** From A to B: options leaving soon, with live delays, drawn on the map. */
export const TripPanel = (props: {
  hash: string;
  city: CityId;
  timeZone: string;
  from: Place | undefined;
  to: Place | undefined;
  stops: Accessor<StopsDto | undefined>;
  live: Accessor<LiveDto>;
  map: Accessor<LiveMap | undefined>;
}) => {
  const records = useCity(() => props.city);
  const [departAt, setDepartAt] = createSignal<string>();
  const [selected, setSelected] = createSignal<number>();

  const resolve = (place: Place | undefined): Resolved | undefined => {
    if (place === undefined) return undefined;
    switch (place.kind) {
      case "here": {
        const position = here();
        if (position.status === "ok") {
          return { label: "◎ My location", endpoint: { lat: position.lat, lon: position.lon } };
        }
        const why =
          position.status === "denied"
            ? "location blocked"
            : position.status === "unavailable"
              ? "location unavailable"
              : "locating…";
        return { label: "◎ My location", endpoint: undefined, pending: why };
      }
      case "place": {
        const saved = records().places.find((p) => p.id === place.id);
        return saved === undefined
          ? { label: "Deleted place", endpoint: undefined, pending: "pick another" }
          : { label: `${kindIcon[saved.kind]} ${saved.name}`, endpoint: saved.point };
      }
      case "stop": {
        const stops = props.stops();
        const name = stops?.names[place.group];
        if (stops === undefined || name === undefined) {
          return { label: "Stop", endpoint: undefined, pending: "loading…" };
        }
        return {
          label: name,
          endpoint: {
            lat: stops.lat[place.group] ?? 0,
            lon: stops.lon[place.group] ?? 0,
            group: place.group,
          },
        };
      }
      case "at": {
        const near = nearestStop(props.stops(), place.lat, place.lon);
        return {
          label: near === undefined ? "⌖ Point on the map" : `⌖ Near ${near}`,
          endpoint: { lat: place.lat, lon: place.lon },
        };
      }
    }
  };

  createEffect(
    () => props.from?.kind === "here" || props.to?.kind === "here",
    (wantsHere) => {
      if (wantsHere) locate();
    },
  );

  const from = createMemo(() => resolve(props.from));
  const to = createMemo(() => resolve(props.to));

  const at = createMemo(() => {
    const chosen = departAt();
    if (chosen === undefined) return now();
    // Today in the city's time zone; a time already past means tomorrow.
    const current = now();
    const minutesNow = fromClock(nowClock(props.timeZone, 1, current * 1000));
    const delta = (fromClock(chosen) - minutesNow) * 60;
    return current + (delta < -60 ? delta + 86_400 : delta);
  });

  const result = createEffectMemo(() => {
    const a = from()?.endpoint;
    const b = to()?.endpoint;
    if (a === undefined || b === undefined) return Effect.succeedNone;
    const prefs = preferences();
    const query = {
      hash: props.hash,
      from: a,
      to: b,
      at: at(),
      count: 6,
      transferBufferSec: prefs.transferBufferSec,
      walkingSpeedKmh: prefs.walkingSpeedKmh,
      preferLines: prefs.preferredLines,
      avoidLines: prefs.avoidedLines,
      preferencePenaltySec: prefs.preferencePenaltyMin * 60,
    };
    return TimetableClient.use((worker) => Effect.asSome(worker.Plan(query)));
  });
  const planned = () => Option.getOrUndefined(result());

  // The shown journey: the user's pick, else the recommended one.
  const shown = createMemo(() => {
    const plan = planned();
    if (plan === undefined) return undefined;
    return plan.journeys[selected() ?? plan.recommended ?? 0];
  });
  createEffect(
    () => [props.map(), shown()] as const,
    ([map, journey]) => {
      if (map === undefined) return;
      map.setJourney(
        journey === undefined
          ? undefined
          : {
              legs: journey.legs.map((leg) => ({
                kind: leg._tag === "Ride" ? ("ride" as const) : ("walk" as const),
                mode: leg._tag === "Ride" ? leg.line.mode : undefined,
                path: leg.path,
              })),
            },
      );
      return () => map.setJourney(undefined);
    },
  );
  // Frame both ends when they change, not on every refresh.
  createEffect(
    () => [props.map(), from()?.endpoint, to()?.endpoint] as const,
    ([map, a, b]) => {
      if (map === undefined || a === undefined || b === undefined) return;
      untrack(() => map.fitPoints([a, b], 60));
    },
  );
  createEffect(result, () => setSelected(undefined));

  const go = (next: { from?: Place | undefined; to?: Place | undefined }) =>
    navigate({
      page: "trip",
      from: "from" in next ? next.from : props.from,
      to: "to" in next ? next.to : props.to,
    });

  return (
    <article class="panel-body trip">
      <h2>Trip</h2>
      <div class="endpoints">
        <EndpointField
          label="From"
          value={from()}
          hash={props.hash}
          city={props.city}
          onPick={(place) => go({ from: place })}
        />
        <EndpointField
          label="To"
          value={to()}
          hash={props.hash}
          city={props.city}
          onPick={(place) => go({ to: place })}
        />
        <button
          type="button"
          class="ghost swap"
          aria-label="Swap start and destination"
          onClick={() => go({ from: props.to, to: props.from })}
        >
          ⇅
        </button>
      </div>
      <div class="actions when-row">
        <select
          aria-label="When"
          onChange={(e) =>
            setDepartAt(e.currentTarget.value === "now" ? undefined : nowClock(props.timeZone, 5))
          }
        >
          <option value="now" selected={departAt() === undefined}>
            Leave now
          </option>
          <option value="at" selected={departAt() !== undefined}>
            Leave at…
          </option>
        </select>
        <Show when={departAt()}>
          {(time) => (
            <input
              type="time"
              aria-label="Departure time"
              value={time()}
              onChange={(e) => setDepartAt(e.currentTarget.value.slice(0, 5))}
            />
          )}
        </Show>
      </div>

      <Show
        when={from()?.endpoint !== undefined && to()?.endpoint !== undefined}
        fallback={
          <p class="muted">
            Choose where you start and where you're going. Long-press the map to use any point.
          </p>
        }
      >
        <Loading fallback={<p class="loading">Finding connections…</p>}>
          <Show
            when={(planned()?.journeys.length ?? 0) > 0}
            fallback={<p class="empty">No connections found in the next hours.</p>}
          >
            <ol class="journeys" data-pending={isPending(() => result())}>
              <For each={planned()?.journeys ?? []}>
                {(journey, i) => {
                  const open = () => shown() === journey;
                  return (
                    <li class={{ journey: true, open: open() }}>
                      <button
                        type="button"
                        class="journey-head"
                        aria-expanded={open() ? "true" : "false"}
                        onClick={() => setSelected(open() ? undefined : i())}
                      >
                        <span class="journey-times">
                          <strong>
                            {clock(journey.departAt, props.timeZone)} →{" "}
                            {clock(journey.arriveAt, props.timeZone)}
                          </strong>
                          <span class="muted small">
                            {duration(journey.arriveAt - journey.departAt)}
                            {journey.rides > 1 ? ` · ${journey.rides - 1} change` : ""}
                            {journey.rides > 2 ? "s" : ""}
                          </span>
                        </span>
                        <LegChips journey={journey} />
                        <span class="journey-meta small">
                          <Show
                            when={journey.departAt - now() > 30}
                            fallback={<strong class="leave-now">leave now</strong>}
                          >
                            leave in {duration(journey.departAt - now())}
                          </Show>
                          <Show when={journey.live}>
                            <span class="live-tag">
                              <span class="live-dot" aria-hidden="true" />
                              live
                            </span>
                          </Show>
                          <Show when={planned()?.recommended === i()}>
                            <span class="badge">suggested</span>
                          </Show>
                        </span>
                      </button>
                      <Show when={open()}>
                        <ol class="legs">
                          <For each={journey.legs}>
                            {(leg, j) => (
                              <LegDetail
                                leg={leg}
                                timeZone={props.timeZone}
                                live={props.live}
                                last={j() === journey.legs.length - 1}
                              />
                            )}
                          </For>
                          <li class="leg arrive">
                            <span class="leg-time">{clock(journey.arriveAt, props.timeZone)}</span>
                            <span>Arrive · {to()?.label}</span>
                          </li>
                        </ol>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ol>
          </Show>
        </Loading>
      </Show>
    </article>
  );
};
