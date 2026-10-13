import { type CityId, distanceMeters, InterchangeArea } from "@odjazd/model";
import { type LiveDto, type StopBoardDto, TimetableClient } from "@odjazd/worker";
import { Schema } from "effect";
import {
  type Accessor,
  createEffect,
  createMemo,
  For,
  isPending,
  Loading,
  Show,
  untrack,
} from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import type { LiveMap } from "../../map/live-map.ts";
import { now } from "../../now.ts";
import { href, navigate } from "../../route.ts";
import { slugify } from "../../slug.ts";
import { useCity, withStore } from "../../user.ts";
import { Countdown, LineBadge, LiveTag } from "./parts.tsx";

/** An area covering every platform of the stop, with a margin for walking in. */
const areaAround = (board: StopBoardDto) => {
  const platforms = board.platforms.length > 0 ? board.platforms : [board.stop];
  const lat = platforms.reduce((sum, p) => sum + p.lat, 0) / platforms.length;
  const lon = platforms.reduce((sum, p) => sum + p.lon, 0) / platforms.length;
  const spread = Math.max(...platforms.map((p) => distanceMeters(lat, lon, p.lat, p.lon)));
  const radiusMeters = Math.min(1000, Math.max(80, Math.ceil((spread + 50) / 10) * 10));
  return { center: { lat, lon }, radiusMeters };
};

/** Save the stop as an interchange area, or name the area it's already in. */
const AreaAction = (props: { city: CityId; board: StopBoardDto }) => {
  const records = useCity(() => props.city);
  const containing = createMemo(() => {
    const { lat, lon } = props.board.stop;
    return records().areas.find(
      (r) => distanceMeters(lat, lon, r.area.center.lat, r.area.center.lon) <= r.area.radiusMeters,
    );
  });
  const save = () => {
    const taken = new Set(records().areas.map((r) => r.area.slug));
    const area = Schema.decodeExit(InterchangeArea)({
      slug: slugify(props.board.stop.name, taken),
      cityId: props.city,
      name: props.board.stop.name,
      ...areaAround(props.board),
    });
    if (area._tag === "Success")
      withStore((store) => store.saveArea({ _tag: "Area", area: area.value }));
  };
  return (
    <Show
      when={containing()}
      fallback={
        <button type="button" class="small" onClick={save}>
          Save as interchange area
        </button>
      }
    >
      {(record) => (
        <a class="small area-tag" href={href({ page: "places" })}>
          In your area “{record().area.name}”
        </a>
      )}
    </Show>
  );
};

/** Live departures from every platform of one stop group. */
export const StopPanel = (props: {
  hash: string;
  city: CityId;
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
        <p>
          <AreaAction city={props.city} board={board()} />
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
