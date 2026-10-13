import type { SeedIntent } from "@odjazd/user-data";
import { type LoadResult, TimetableClient } from "@odjazd/worker";
import { Effect, Option } from "effect";
import { createMemo, createSignal, For, isPending, onCleanup, Show } from "solid-js";
import { createEffectMemo } from "../effect-solid.ts";
import { clock } from "../format.ts";
import { navigate } from "../route.ts";

const tick = () => {
  const [now, setNow] = createSignal(Math.floor(Date.now() / 1000));
  const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
  onCleanup(() => clearInterval(timer));
  return now;
};

export const BoardView = (props: {
  loaded: LoadResult;
  intent: SeedIntent;
  area: string | undefined;
}) => {
  const now = tick();
  const area = createMemo(
    () => props.intent.areas.find((a) => a.slug === props.area) ?? props.intent.areas[0],
  );
  const board = createEffectMemo(() => {
    const selected = area();
    if (selected === undefined) return Effect.succeedNone;
    const query = {
      hash: props.loaded.manifest.timetable.hash,
      area: selected,
      at: now(),
      horizonMinutes: 90,
      limit: 40,
    };
    return TimetableClient.use((worker) => worker.Board(query)).pipe(Effect.asSome);
  });
  const tz = () => props.loaded.timeZone;

  return (
    <section class="board">
      <div class="filters">
        <label>
          Interchange area
          <select onChange={(e) => navigate({ page: "board", area: e.currentTarget.value })}>
            <For each={props.intent.areas}>
              {(a) => (
                <option value={a.slug} selected={a.slug === area()?.slug}>
                  {a.name}
                </option>
              )}
            </For>
          </select>
        </label>
        <p class="muted">Updated {clock(now(), tz())} · scheduled times</p>
      </div>
      <Show
        when={Option.getOrUndefined(board())}
        keyed
        fallback={<p class="empty">No interchange areas defined.</p>}
      >
        {(data) => (
          <div class="card" data-pending={isPending(() => board())}>
            <h2>Next departures</h2>
            <p class="subtitle">
              From {data.stops.length} stop{data.stops.length === 1 ? "" : "s"}:{" "}
              {data.stops.map((s) => `${s.name} (${s.distanceMeters} m)`).join(", ")}
            </p>
            <Show
              when={data.departures.length > 0}
              fallback={<p class="empty">Nothing in the next 90 minutes.</p>}
            >
              <ul class="departures">
                <For each={data.departures}>
                  {(departure) => {
                    const inMinutes = () =>
                      Math.max(0, Math.round((departure.departAt - now()) / 60));
                    return (
                      <li>
                        <span class="when">
                          <strong>{inMinutes() === 0 ? "now" : `${inMinutes()} min`}</strong>
                          <span class="muted small">{clock(departure.departAt, tz())}</span>
                        </span>
                        <span class={`line-badge ${departure.mode}`}>{departure.label}</span>
                        <span class="where">
                          <span>{departure.headsign}</span>
                          <span class="muted small">{departure.stop}</span>
                        </span>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
};
