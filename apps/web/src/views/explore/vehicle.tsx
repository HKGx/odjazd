import { type LiveDto, TimetableClient } from "@odjazd/worker";
import { Effect, Option } from "effect";
import { type Accessor, createEffect, createMemo, For, Loading, Show, untrack } from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import { clock } from "../../format.ts";
import type { LiveMap } from "../../map/live-map.ts";
import { now } from "../../now.ts";
import { href } from "../../route.ts";
import { ago, LineBadge, LiveTag } from "./parts.tsx";

/** One vehicle: where it is, how late, and its remaining stops. */
export const VehiclePanel = (props: {
  hash: string;
  id: string;
  timeZone: string;
  live: Accessor<LiveDto>;
  map: Accessor<LiveMap | undefined>;
}) => {
  const vehicle = createMemo(() => props.live().vehicles.find((v) => v.id === props.id));
  const tripId = createMemo(() => vehicle()?.trip);
  const trip = createEffectMemo(() => {
    const id = tripId();
    if (id === undefined) return Effect.succeedNone;
    // Re-asked on each realtime update: expected times shift with the delay.
    const query = {
      hash: props.hash,
      trip: id,
      at: Math.max(untrack(now), props.live().fetchedAt),
    };
    return TimetableClient.use((worker) => worker.Trip(query));
  });

  createEffect(
    () => [props.map(), props.id] as const,
    ([map, id]) => {
      if (map === undefined) return;
      untrack(() => {
        map.setFocus({ vehicle: id });
        const v = vehicle();
        if (v !== undefined) map.flyTo(v.lat, v.lon, 15);
      });
      return () => map.setFocus({});
    },
  );

  // Follow the vehicle as new fixes arrive.
  createEffect(
    () => [props.map(), vehicle()] as const,
    ([map, v]) => {
      if (map !== undefined && v !== undefined) map.keepInView(v.lat, v.lon);
    },
  );

  return (
    <Show
      when={vehicle()}
      fallback={
        <article class="panel-body">
          <h2>Vehicle {props.id}</h2>
          <p class="empty">
            {props.live().status === "connecting"
              ? "Connecting to live data…"
              : "This vehicle isn't reporting its position right now."}
          </p>
        </article>
      }
    >
      {(v) => (
        <article class="panel-body">
          <h2 class="line-title">
            <LineBadge line={{ id: v().line ?? "", label: v().lineLabel, mode: v().mode }} link />
            <span>{v().headsign ?? "—"}</span>
          </h2>
          <p class="muted small">
            <LiveTag delay={v().delay} />
            {v().stopName === undefined
              ? ""
              : ` · ${v().status === "stopped" ? "at" : "next"} ${v().stopName}`}
            {v().speed === undefined ? "" : ` · ${Math.round((v().speed ?? 0) * 3.6)} km/h`}
            {` · #${v().label ?? v().id} · ${ago(now() - v().at)}`}
          </p>
          <Loading fallback={<p class="loading">Loading stops…</p>}>
            <Show when={Option.getOrUndefined(trip())}>
              {(t) => {
                const next = () => t().fromSequence ?? 0;
                return (
                  <ol class="trip-stops">
                    <For each={t().stops.filter((s) => s.sequence >= next())}>
                      {(stop) => (
                        <li class={{ current: stop.sequence === next() }}>
                          <span class="trip-time">
                            <strong>{clock(stop.expectedAt, props.timeZone)}</strong>
                            <Show when={stop.expectedAt !== stop.scheduledAt}>
                              <s class="muted small">{clock(stop.scheduledAt, props.timeZone)}</s>
                            </Show>
                          </span>
                          <a href={href({ page: "stop", group: stop.group })}>{stop.name}</a>
                        </li>
                      )}
                    </For>
                  </ol>
                );
              }}
            </Show>
          </Loading>
        </article>
      )}
    </Show>
  );
};
