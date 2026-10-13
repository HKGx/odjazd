import type { LineRouteDto, LiveDto } from "@odjazd/worker";
import { type Accessor, createEffect, For, Show, untrack } from "solid-js";
import type { LiveMap } from "../../map/live-map.ts";
import { href, navigate } from "../../route.ts";
import { LineBadge } from "./parts.tsx";

/** A line's main route per direction, with its vehicles highlighted on the map. */
export const LinePanel = (props: {
  route: LineRouteDto;
  direction: number;
  live: Accessor<LiveDto>;
  map: Accessor<LiveMap | undefined>;
}) => {
  const direction = () => props.route.directions[props.direction] ?? props.route.directions[0];
  const running = () => props.live().vehicles.filter((v) => v.line === props.route.line.id);

  createEffect(
    () => [props.map(), props.route, props.direction] as const,
    ([map, route, index]) => {
      if (map === undefined) return;
      untrack(() => {
        map.setRoute(route, index);
        map.setFocus({ line: route.line.id });
        map.fitPoints(route.directions[index]?.stops ?? [], 60);
      });
      return () => {
        map.setRoute(undefined, 0);
        map.setFocus({});
      };
    },
  );

  return (
    <article class="panel-body">
      <h2 class="line-title">
        <LineBadge line={props.route.line} />
        <span>
          {props.route.line.mode === "tram" ? "Tram" : "Bus"} {props.route.line.label}
        </span>
      </h2>
      <p class="muted small">
        {running().length === 0
          ? "No vehicles reporting right now."
          : `${running().length} vehicle${running().length === 1 ? "" : "s"} live`}
      </p>
      <Show when={props.route.directions.length > 1}>
        <div class="segmented" role="group" aria-label="Direction">
          <For each={props.route.directions}>
            {(d, i) => (
              <button
                type="button"
                aria-pressed={i() === props.direction ? "true" : "false"}
                onClick={() =>
                  navigate({ page: "line", line: props.route.line.id, direction: i() })
                }
              >
                → {d.headsign === "" ? `Direction ${i() + 1}` : d.headsign}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={direction()}>
        {(d) => (
          <ol class="route-stops">
            <For each={d().stops}>
              {(stop) => (
                <li>
                  <a href={href({ page: "stop", group: stop.group })}>{stop.name}</a>
                </li>
              )}
            </For>
          </ol>
        )}
      </Show>
    </article>
  );
};
