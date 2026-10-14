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
import { fromJourney } from "../../route-draft.ts";
import { longPress } from "../../press.ts";
import { editDraft } from "./handoff.ts";
import { nearestStop, type Resolved, resolver } from "./endpoints.ts";
import { LineBadge, LiveTag } from "./parts.tsx";

type Ride = Extract<PlanLegDto, { _tag: "Ride" }>;

const walkTime = (seconds: number) => (seconds < 60 ? "<1 min" : duration(seconds));

const duration = (seconds: number) => {
  const minutes = Math.max(0, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

/** Pick an endpoint: this device's location, a saved place, or a stop by name. */
export const LegChips = (props: { journey: JourneyDto }) => (
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
  hash: string;
  context: { ready: number; position: { lat: number; lon: number }; first: boolean } | undefined;
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
        const [alternatives, setAlternatives] = createSignal(false);
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
                <Show when={ride().stayAboard}>
                  <span class="badge">stay on</span>{" "}
                </Show>
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
              <Show when={props.context}>
                {(context) => (
                  <>
                    <button
                      type="button"
                      class="ghost small alternatives-toggle"
                      aria-expanded={alternatives() ? "true" : "false"}
                      onClick={() => setAlternatives(!alternatives())}
                    >
                      {alternatives() ? "Hide" : "Other lines here"}
                    </button>
                    <Show when={alternatives()}>
                      <Substitutes
                        hash={props.hash}
                        ride={ride()}
                        ready={context().ready}
                        position={context().position}
                        bufferSec={context().first ? 0 : preferences().transferBufferSec}
                        timeZone={props.timeZone}
                      />
                    </Show>
                  </>
                )}
              </Show>
            </span>
          </li>
        );
      }}
    </Match>
  </Switch>
);

/** A journey's identity across refreshes: the vehicles it rides (delays move the times). */
const journeyKey = (journey: JourneyDto) =>
  `${journey.route?.slug ?? ""}|${journey.legs
    .map((leg) => (leg._tag === "Ride" ? leg.trip : "walk"))
    .join(">")}`;

/** Where and when the rider stands before each ride of a journey. */
const rideContexts = (journey: JourneyDto) => {
  const contexts: Array<{ ready: number; position: { lat: number; lon: number }; first: boolean }> =
    [];
  let ready = journey.departAt;
  let position = journey.legs[0]?.path[0] ?? { lat: 0, lon: 0 };
  let first = true;
  for (const leg of journey.legs) {
    if (leg._tag === "Ride") {
      contexts.push({ ready, position, first });
      first = false;
    }
    ready = leg.arriveAt;
    position = leg.path[leg.path.length - 1] ?? position;
  }
  return contexts;
};

/**
 * Everything that covers one ride's section (its interchange area to the
 * next), so a missed or full vehicle isn't a problem: take any of these.
 */
const Substitutes = (props: {
  hash: string;
  ride: Ride;
  ready: number;
  position: { lat: number; lon: number };
  bufferSec: number;
  timeZone: string;
}) => {
  const options = createEffectMemo(() => {
    const prefs = untrack(preferences);
    const query = {
      hash: props.hash,
      section: props.ride.section,
      position: props.position,
      ready: props.ready,
      bufferSec: props.bufferSec,
      walkingSpeedKmh: prefs.walkingSpeedKmh,
    };
    return TimetableClient.use((worker) => worker.Section(query));
  });
  const others = () =>
    options().filter((o) => o.line.id !== props.ride.line.id || o.departures.length > 1);
  return (
    <Loading fallback={<span class="muted small">Looking for alternatives…</span>}>
      <Show
        when={others().length > 0}
        fallback={
          <span class="muted small">
            Nothing else goes from {props.ride.section.from.name} to {props.ride.section.to.name} in
            the next half hour.
          </span>
        }
      >
        <div class="substitutes">
          <span class="small">
            {props.ride.section.from.name} → {props.ride.section.to.name}: any of{" "}
            <For each={options()}>{(option) => <LineBadge line={option.line} small />}</For>
          </span>
          <ul class="substitute-list small">
            <For each={options()}>
              {(option) => (
                <li>
                  <LineBadge line={option.line} small />
                  <Show when={option.preferred}>
                    <span class="badge">preferred</span>
                  </Show>
                  <span>
                    <For each={option.departures}>
                      {(d, k) => (
                        <>
                          {k() > 0 ? ", " : ""}
                          <span
                            class={{ current: d.trip === props.ride.trip }}
                            title={`${d.from} → ${d.to}, arrive ${clock(d.arriveAt, props.timeZone)}`}
                          >
                            {clock(d.departAt, props.timeZone)}
                            <span class="muted"> (arr. {clock(d.arriveAt, props.timeZone)})</span>
                          </span>
                        </>
                      )}
                    </For>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </Loading>
  );
};

/** From A to B: options leaving soon, with live delays, drawn on the map. */
const changes = (journey: JourneyDto) =>
  journey.rides === 0
    ? "Walk only"
    : journey.rides === 1
      ? "None, direct"
      : `${journey.rides - 1} change${journey.rides > 2 ? "s" : ""}`;

/** Everything the planner weighed for one option: opened by a long-press on it. */
const JourneyWhy = (props: {
  journey: JourneyDto;
  suggested: boolean;
  why: string | undefined;
  notes: ReadonlyArray<string>;
  timeZone: string;
  onClose: () => void;
}) => (
  <>
    <h2>
      {clock(props.journey.departAt, props.timeZone)} →{" "}
      {clock(props.journey.arriveAt, props.timeZone)}{" "}
      <span class="muted">· {duration(props.journey.arriveAt - props.journey.departAt)}</span>
    </h2>
    <Show when={props.suggested}>
      <p>
        <strong>Suggested.</strong> {props.why}
      </p>
    </Show>
    <Show when={props.journey.reasons.length > 0}>
      <h3>What sets it apart</h3>
      <ul class="reasons">
        <For each={props.journey.reasons}>{(reason) => <li>{reason}</li>}</For>
      </ul>
    </Show>
    <dl class="facts">
      <dt>Changes</dt>
      <dd>{changes(props.journey)}</dd>
      <dt>Walking</dt>
      <dd>{Math.round(props.journey.walkMeters)} m</dd>
      <Show when={!props.journey.live}>
        <dt>Delays</dt>
        <dd>Schedule only</dd>
      </Show>
      <Show when={props.journey.route}>
        {(route) => (
          <>
            <dt>Your route</dt>
            <dd>
              {route().name}
              {route().partial ? " (part of it)" : ""}
              {route().via.length > 0 ? ` · via ${route().via.join(" → ")}` : ""}
            </dd>
          </>
        )}
      </Show>
    </dl>
    <Show when={props.notes.length > 0}>
      <h3>Your routes</h3>
      <ul class="notes">
        <For each={props.notes}>{(note) => <li>{note}</li>}</For>
      </ul>
    </Show>
    <div class="actions">
      <button type="button" onClick={() => props.onClose()}>
        Close
      </button>
    </div>
  </>
);

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
  // The journey the user opened, by the vehicles it rides (stable across live refreshes);
  // `undefined` follows the suggestion, `null` means the user closed it.
  const [selected, setSelected] = createSignal<string | null>();
  // The option whose reasoning is open in the dialog.
  const [inspected, setInspected] = createSignal<JourneyDto>();
  let dialog: HTMLDialogElement | undefined;
  createEffect(inspected, (journey) => {
    if (journey !== undefined && dialog !== undefined && !dialog.open) dialog.showModal();
  });

  const resolve = resolver(() => records().places, props.stops);

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
      preferencePenaltySec: prefs.preferencePenaltyMin * 60,
      routeToleranceSec: prefs.routeToleranceMin * 60,
      areas: records().areas.map((r) => r.area),
      corridors: records().corridors.map((r) => r.corridor),
    };
    return TimetableClient.use((worker) => Effect.asSome(worker.Plan(query)));
  });
  const planned = () => Option.getOrUndefined(result());

  // The shown journey: the user's pick, else the recommended one.
  const shown = createMemo(() => {
    const plan = planned();
    if (plan === undefined) return undefined;
    const key = selected();
    if (key === null) return undefined;
    const suggested = plan.journeys[plan.recommended ?? 0];
    // A picked journey that's gone (its vehicle has left) falls back to the suggestion.
    return key === undefined
      ? suggested
      : (plan.journeys.find((j) => journeyKey(j) === key) ?? suggested);
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
  // A new question starts from the suggestion; a refresh of the same one keeps the pick.
  createEffect(
    () => [props.from, props.to, departAt()] as const,
    () => setSelected(undefined),
  );

  const go = (next: { from?: Place | undefined; to?: Place | undefined }) =>
    navigate({
      page: "trip",
      from: "from" in next ? next.from : props.from,
      to: "to" in next ? next.to : props.to,
    });

  return (
    <article class="panel-body trip">
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
            Choose where you're going above, or long-press the map to use any point.
          </p>
        }
      >
        <Loading fallback={<p class="loading">Finding connections…</p>}>
          <Show
            when={(planned()?.journeys.length ?? 0) > 0}
            fallback={<p class="empty">No connections found in the next hours.</p>}
          >
            <ol class="journeys" data-pending={isPending(() => result())}>
              <For each={planned()?.journeys ?? []} keyed={journeyKey}>
                {(journey, i) => {
                  const open = () => shown() === journey();
                  const press = longPress(() => setInspected(journey()));
                  return (
                    <li
                      class={{
                        journey: true,
                        open: open(),
                        suggested: planned()?.recommended === i(),
                      }}
                    >
                      <button
                        type="button"
                        class="journey-head"
                        aria-expanded={open() ? "true" : "false"}
                        onPointerDown={press.onPointerDown}
                        onPointerMove={press.onPointerMove}
                        onPointerUp={press.onPointerUp}
                        onPointerCancel={press.onPointerCancel}
                        onPointerLeave={press.onPointerLeave}
                        onContextMenu={press.onContextMenu}
                        onClick={() => {
                          if (press.swallowClick()) return;
                          setSelected(open() ? null : journeyKey(journey()));
                        }}
                      >
                        <span class="journey-times">
                          <strong>
                            {clock(journey().departAt, props.timeZone)} →{" "}
                            {clock(journey().arriveAt, props.timeZone)}
                          </strong>
                          <span class="muted small">
                            {duration(journey().arriveAt - journey().departAt)}
                            {journey().rides > 1 ? ` · ${journey().rides - 1} change` : ""}
                            {journey().rides > 2 ? "s" : ""}
                          </span>
                        </span>
                        <LegChips journey={journey()} />
                        <span class="journey-meta small">
                          <Show
                            when={journey().departAt - now() > 30}
                            fallback={<strong class="leave-now">leave now</strong>}
                          >
                            leave in {duration(journey().departAt - now())}
                          </Show>
                          <Show when={journey().live}>
                            <span class="live-tag">
                              <span class="live-dot" aria-hidden="true" />
                              live
                            </span>
                          </Show>
                          <Show when={journey().route}>
                            {(route) => <span class="badge route-tag">↝ {route().name}</span>}
                          </Show>
                        </span>
                      </button>
                      <Show when={open()}>
                        <ol class="legs">
                          <For each={journey().legs} keyed={false}>
                            {(leg, j) => (
                              <LegDetail
                                leg={leg()}
                                timeZone={props.timeZone}
                                live={props.live}
                                last={j === journey().legs.length - 1}
                                hash={props.hash}
                                context={
                                  leg()._tag === "Ride"
                                    ? rideContexts(journey())[
                                        journey()
                                          .legs.slice(0, j)
                                          .filter((l) => l._tag === "Ride").length
                                      ]
                                    : undefined
                                }
                              />
                            )}
                          </For>
                          <li class="leg arrive">
                            <span class="leg-time">
                              {clock(journey().arriveAt, props.timeZone)}
                            </span>
                            <span>Arrive · {to()?.label}</span>
                          </li>
                        </ol>
                        <div class="actions journey-actions">
                          <button
                            type="button"
                            class="ghost small"
                            onClick={() => setInspected(journey())}
                          >
                            Why this option…
                          </button>
                          <Show
                            when={journey().route}
                            fallback={
                              <Show when={journey().rides > 0}>
                                <button
                                  type="button"
                                  class="ghost small"
                                  onClick={() =>
                                    editDraft(
                                      fromJourney(
                                        journey(),
                                        records().areas.map((r) => r.area),
                                        props.city,
                                      ),
                                    )
                                  }
                                >
                                  Save as route…
                                </button>
                              </Show>
                            }
                          >
                            {(used) => (
                              <Show
                                when={
                                  records().corridors.find((r) => r.corridor.slug === used().slug)
                                    ?.id
                                }
                              >
                                {(id) => (
                                  <a
                                    class="button ghost small"
                                    href={href({ page: "route", id: id() })}
                                  >
                                    Edit “{used().name}”
                                  </a>
                                )}
                              </Show>
                            )}
                          </Show>
                        </div>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ol>
          </Show>
        </Loading>
      </Show>
      <dialog
        ref={(element) => (dialog = element)}
        class="why-dialog"
        aria-label="Why this option"
        onClose={() => setInspected(undefined)}
        // A tap on the backdrop (the dialog box itself, outside its content) closes it.
        onClick={(event) => {
          if (event.target === dialog) dialog.close();
        }}
      >
        <Show when={inspected()}>
          {(journey) => (
            <div class="why-content">
              <JourneyWhy
                journey={journey()}
                suggested={planned()?.journeys.indexOf(journey()) === planned()?.recommended}
                why={planned()?.why}
                notes={planned()?.notes ?? []}
                timeZone={props.timeZone}
                onClose={() => dialog?.close()}
              />
            </div>
          )}
        </Show>
      </dialog>
    </article>
  );
};
