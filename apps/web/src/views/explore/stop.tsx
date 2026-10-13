import { type LiveDto, TimetableClient } from "@odjazd/worker";
import { type Accessor, createEffect, For, isPending, Loading, Show, untrack } from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import type { LiveMap } from "../../map/live-map.ts";
import { now } from "../../now.ts";
import { navigate } from "../../route.ts";
import { Countdown, LineBadge, LiveTag } from "./parts.tsx";

/** Live departures from every platform of one stop group. */
export const StopPanel = (props: {
  hash: string;
  group: number;
  timeZone: string;
  live: Accessor<LiveDto>;
  map: Accessor<LiveMap | undefined>;
}) => {
  const board = createEffectMemo(() => {
    const query = {
      hash: props.hash,
      group: props.group,
      // Realtime updates re-ask too: delays move departures.
      at: Math.max(now(), props.live().fetchedAt),
      horizonMinutes: 120,
      limit: 30,
    };
    return TimetableClient.use((worker) => worker.StopBoard(query));
  });

  // Center the stop once per selection, not on every refresh.
  createEffect(
    () => [props.map(), board().stop] as const,
    ([map, stop]) => {
      if (map === undefined) return;
      untrack(() => {
        map.setFocus({ stop: stop.group });
        map.flyTo(stop.lat, stop.lon, 16);
      });
    },
  );

  const vehicleOn = (trip: string) => props.live().vehicles.find((v) => v.trip === trip);

  return (
    <Loading fallback={<p class="loading">Loading departures…</p>}>
      <article class="panel-body" data-pending={isPending(() => board())}>
        <h2>{board().stop.name}</h2>
        <p class="hit-lines">
          <For each={board().stop.lines}>{(line) => <LineBadge line={line} link small />}</For>
        </p>
        <Show
          when={board().departures.length > 0}
          fallback={<p class="empty">No departures in the next two hours.</p>}
        >
          <ul class="departures">
            <For each={board().departures} keyed={(d) => `${d.trip}:${d.scheduledAt}`}>
              {(departure) => {
                const vehicle = () => vehicleOn(departure().trip);
                return (
                  <li>
                    <Countdown at={departure().departAt} now={now()} timeZone={props.timeZone} />
                    <LineBadge line={departure()} />
                    <span class="where">
                      <span>{departure().headsign}</span>
                      <span class="muted small">
                        <LiveTag delay={departure().delay} />
                        <Show when={departure().delay === undefined}>scheduled</Show>
                      </span>
                    </span>
                    <Show when={vehicle()}>
                      {(v) => (
                        <button
                          type="button"
                          class="ghost small"
                          onClick={() => navigate({ page: "vehicle", id: v().id })}
                          aria-label={`Show vehicle ${v().label ?? v().id} on the map`}
                        >
                          Track
                        </button>
                      )}
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </article>
    </Loading>
  );
};
