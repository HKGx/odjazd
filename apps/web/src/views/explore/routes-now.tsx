import type { CityId, Corridor, InterchangeArea } from "@odjazd/model";
import { type JourneyDto, TimetableClient } from "@odjazd/worker";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  isPending,
  Loading,
  Show,
  untrack,
} from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import { clock } from "../../format.ts";
import type { LiveMap } from "../../map/live-map.ts";
import { now } from "../../now.ts";
import { href } from "../../route.ts";
import { preferences, useCity } from "../../user.ts";
import { Countdown, LiveTag } from "./parts.tsx";
import { LegChips } from "./trip.tsx";

const firstRide = (journey: JourneyDto) => journey.legs.find((leg) => leg._tag === "Ride");

/** Which option is drawn on the map: route slug and its first ride's trip. */
const optionKey = (slug: string, journey: JourneyDto) =>
  `${slug}|${firstRide(journey)?.trip ?? journey.departAt}`;

/**
 * The next departures on each of the user's routes, from the first area to the
 * last: what the app is for, on the first screen.
 */
export const RoutesNow = (props: {
  hash: string;
  city: CityId;
  timeZone: string;
  map: Accessor<LiveMap | undefined>;
}) => {
  const records = useCity(() => props.city);
  const areas = createMemo(() => records().areas.map((r) => r.area));
  const [shown, setShown] = createSignal<string>();
  return (
    <Show
      when={records().corridors.length > 0}
      fallback={
        <p class="muted small">
          No routes yet. <a href={href({ page: "route", id: undefined })}>New route</a>
        </p>
      }
    >
      <section class="routes-now" aria-label="Your routes">
        <h2>Your routes</h2>
        <ul>
          <For each={records().corridors}>
            {(record) => (
              <RouteNow
                hash={props.hash}
                corridor={record.corridor}
                areas={areas()}
                timeZone={props.timeZone}
                map={props.map}
                shown={shown()}
                onShow={setShown}
              />
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
};

const RouteNow = (props: {
  hash: string;
  corridor: Corridor;
  areas: ReadonlyArray<InterchangeArea>;
  timeZone: string;
  map: Accessor<LiveMap | undefined>;
  shown: string | undefined;
  onShow: (key: string | undefined) => void;
}) => {
  // Re-timed every minute (and with fresh delays, which the worker folds in).
  const minute = createMemo(() => Math.floor(now() / 60) * 60);
  const result = createEffectMemo(() => {
    const prefs = untrack(preferences);
    const query = {
      hash: props.hash,
      areas: props.areas,
      corridor: props.corridor,
      at: minute(),
      count: 3,
      transferBufferSec: prefs.transferBufferSec,
      walkingSpeedKmh: prefs.walkingSpeedKmh,
      preferencePenaltySec: prefs.preferencePenaltyMin * 60,
    };
    return TimetableClient.use((worker) => worker.RouteNow(query));
  });
  const ends = createMemo(() => {
    const byslug = new Map(props.areas.map((area) => [area.slug, area]));
    const legs = props.corridor.legs;
    return {
      from: byslug.get(legs[0].from),
      to: byslug.get(legs[legs.length - 1]?.to ?? legs[0].to),
    };
  });
  const plan = () => {
    const { from, to } = ends();
    return href({
      page: "trip",
      from: from === undefined ? undefined : { kind: "at", ...from.center },
      to: to === undefined ? undefined : { kind: "at", ...to.center },
    });
  };
  const selected = createMemo(() =>
    result().find((journey) => optionKey(props.corridor.slug, journey) === props.shown),
  );
  createEffect(
    () => [props.map(), selected()] as const,
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
  return (
    <li class="route-now" data-pending={isPending(() => result())}>
      <a class="route-now-name" href={plan()} title="Plan this trip">
        {props.corridor.name}
      </a>
      <Loading fallback={<p class="muted small">Timing it…</p>}>
        <Show
          when={result().length > 0}
          fallback={<p class="muted small">Nothing on this route in the next 2 hours.</p>}
        >
          <ul>
            <For each={result()}>
              {(journey) => {
                const key = () => optionKey(props.corridor.slug, journey);
                const ride = () => firstRide(journey);
                return (
                  <li>
                    <button
                      type="button"
                      class={{ ghost: true, open: props.shown === key() }}
                      aria-pressed={props.shown === key() ? "true" : "false"}
                      onClick={() => {
                        const open = props.shown === key();
                        props.onShow(open ? undefined : key());
                        if (!open)
                          props.map()?.fitPoints(
                            journey.legs.flatMap((l) => l.path),
                            60,
                          );
                      }}
                    >
                      <Countdown
                        at={ride()?.departAt ?? journey.departAt}
                        now={now()}
                        timeZone={props.timeZone}
                      />
                      <span class="route-now-ride">
                        <LegChips journey={journey} />
                        <span class="muted small">
                          from {ride()?.from ?? "—"} · arrive{" "}
                          {clock(journey.arriveAt, props.timeZone)}
                        </span>
                      </span>
                      <LiveTag delay={ride()?.delay} />
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Loading>
    </li>
  );
};
