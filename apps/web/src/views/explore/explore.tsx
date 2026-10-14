import type { CitySummary } from "@odjazd/api";
import { bboxContains } from "@odjazd/model";
import { type LiveDto, type LoadResult, type StopsDto, TimetableClient } from "@odjazd/worker";
import { Effect, Option } from "effect";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Errored,
  For,
  Loading,
  Match,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import type { LiveMap } from "../../map/live-map.ts";
import { now } from "../../now.ts";
import { href, navigate, route } from "../../route.ts";
import { kindIcon, updatePreferences, useCity } from "../../user.ts";
import { LinePanel } from "./line.tsx";
import { mapPick } from "../../map/pick.ts";
import { PointPanel } from "./point.tsx";
import { RouteEditorPanel } from "./route-editor.tsx";
import { TripPanel } from "./trip.tsx";
import { ago } from "./parts.tsx";
import { SearchBox } from "./search.tsx";
import { StopPanel } from "./stop.tsx";
import { VehiclePanel } from "./vehicle.tsx";

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)");

/** The map with search and a detail panel: stops, lines, vehicles. */
export const ExploreView = (props: {
  city: CitySummary;
  cities: ReadonlyArray<CitySummary>;
  loaded: LoadResult;
  live: Accessor<LiveDto>;
  dark: Accessor<boolean>;
}) => {
  const hash = () => props.loaded.manifest.timetable.hash;
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const [map, setMap] = createSignal<LiveMap>();

  // MapLibre is ~1 MB: load it only when the map is shown.
  createEffect(container, (element) => {
    if (element === undefined) return;
    let instance: LiveMap | undefined;
    let cancelled = false;
    void import("../../map/live-map.ts").then(({ LiveMap }) => {
      if (cancelled) return;
      instance = new LiveMap({
        container: element,
        center: untrack(() => props.city.center),
        dark: untrack(props.dark),
        onStop: (group) =>
          mapPick.stop === undefined ? navigate({ page: "stop", group }) : mapPick.stop(group),
        onVehicle: (id) => navigate({ page: "vehicle", id }),
        onPoint: (lat, lon) =>
          mapPick.point === undefined
            ? navigate({ page: "point", lat, lon })
            : mapPick.point(lat, lon),
        onBackground: () => {
          if (route().page !== "map" && mapPick.stop === undefined) navigate({ page: "map" });
        },
        onCity: (id) => {
          const city = props.cities.find((c) => c.id === id);
          if (city !== undefined) updatePreferences({ city: city.id });
        },
        // Looking at another city's network (not just the country) makes it the one you're in.
        onMoved: (center, zoom) => {
          if (zoom < 9 || bboxContains(props.city.bbox, center)) return;
          const city = props.cities.find((c) => bboxContains(c.bbox, center));
          if (city !== undefined) updatePreferences({ city: city.id });
        },
      });
      setMap(instance);
    });
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  });

  // On narrow screens the panel is a sheet over the map: tell the map and the controls.
  const [panel, setPanel] = createSignal<HTMLElement>();
  const [root, setRoot] = createSignal<HTMLElement>();
  createEffect(
    () => [panel(), root(), map()] as const,
    ([element, container, m]) => {
      if (element === undefined || container === undefined) return;
      const narrow = window.matchMedia("(max-width: 760px)");
      const update = () => {
        const inset = narrow.matches ? element.offsetHeight : 0;
        container.style.setProperty("--sheet", `${inset}px`);
        m?.setBottomInset(inset);
      };
      const observer = new ResizeObserver(update);
      observer.observe(element);
      narrow.addEventListener("change", update);
      update();
      return () => {
        observer.disconnect();
        narrow.removeEventListener("change", update);
      };
    },
  );

  const stops = createEffectMemo(() => {
    const request = { hash: hash() };
    return TimetableClient.use((worker) => worker.Stops(request));
  });
  // A non-suspending copy for panels that only need names and positions.
  const [stopsReady, setStopsReady] = createSignal<StopsDto>();
  createEffect(
    () => [map(), stops()] as const,
    ([m, s]) => {
      setStopsReady(s);
      m?.setStops(s);
    },
  );
  createEffect(
    () => [map(), props.live()] as const,
    ([m, live]) => m?.setVehicles(live.vehicles),
  );
  createEffect(
    () => [map(), props.city] as const,
    ([m, city]) => {
      if (m === undefined) return;
      m.setCities(
        props.cities.map((c) => ({ id: c.id, name: c.name["en"] ?? c.id, center: c.center })),
        city.id,
      );
      if (!bboxContains(city.bbox, m.center())) m.showCity(city.bbox);
    },
  );
  createEffect(
    () => [map(), props.dark()] as const,
    ([m, dark]) => m?.setDark(dark),
  );

  const records = useCity(() => props.city.id);
  createEffect(
    () => [map(), records()] as const,
    ([m, r]) =>
      m?.setUserLayers({
        areas: r.areas.map((record) => record.area),
        places: r.places.map((place) => ({
          name: place.name,
          icon: kindIcon[place.kind],
          point: place.point,
        })),
      }),
  );

  const lineRoute = createEffectMemo(() => {
    const r = route();
    if (r.page !== "line") return Effect.succeedNone;
    const query = { hash: hash(), line: r.line };
    return TimetableClient.use((worker) => worker.LineRoute(query));
  });

  const status = createMemo(() => {
    const live = props.live();
    if (live.status === "connecting") return "Connecting to live data…";
    const count = `${live.vehicles.length} vehicles`;
    if (live.status === "offline") {
      return live.fetchedAt === 0
        ? "Live data unavailable"
        : `Offline · last ${ago(now() - live.fetchedAt)}`;
    }
    return `${count} live · ${ago(now() - live.fetchedAt)}`;
  });

  return (
    <div ref={setRoot} class="explore" data-panel={route().page === "map" ? "closed" : "open"}>
      <aside class="side">
        <SearchBox hash={hash()} />
        <p class={`live-status ${props.live().status}`} role="status" aria-live="polite">
          <span class="live-dot" aria-hidden="true" />
          {status()}
        </p>
        <section ref={setPanel} class="panel" aria-label="Details">
          <Show when={route().page !== "map"}>
            <button
              type="button"
              class="ghost close"
              aria-label="Close"
              onClick={() => navigate({ page: "map" })}
            >
              ✕
            </button>
          </Show>
          <Errored
            fallback={(error, reset) => (
              <div role="alert" class="panel-body">
                <p>{String((error() as Error | undefined)?.message ?? error())}</p>
                <button type="button" onClick={() => reset()}>
                  Retry
                </button>
              </div>
            )}
          >
            <Switch
              fallback={
                <div class="panel-body hint">
                  <div class="quick-trips">
                    <For each={records().places}>
                      {(place) => (
                        <a
                          class="quick-trip"
                          href={href({
                            page: "trip",
                            from: { kind: "here" },
                            to: { kind: "place", id: place.id },
                          })}
                        >
                          {kindIcon[place.kind]} {place.name}
                        </a>
                      )}
                    </For>
                    <a
                      class="quick-trip primary"
                      href={href({ page: "trip", from: { kind: "here" }, to: undefined })}
                    >
                      Plan a trip
                    </a>
                  </div>
                  <p>Tap a vehicle or a stop on the map, or search above.</p>
                  <p class="muted small">
                    Long-press (or right-click) anywhere to save a place or an interchange area
                    there.
                  </p>
                  <p class="muted small">
                    Trams are blue, buses grey; arrows point the way they're heading.
                  </p>
                </div>
              }
            >
              <Match
                when={(() => {
                  const r = route();
                  return r.page === "stop" ? r : undefined;
                })()}
              >
                {(r) => (
                  <StopPanel
                    hash={hash()}
                    city={props.city.id}
                    group={r().group}
                    timeZone={props.loaded.timeZone}
                    live={props.live}
                    map={map}
                  />
                )}
              </Match>
              <Match
                when={(() => {
                  const r = route();
                  return r.page === "line" ? r : undefined;
                })()}
              >
                {(r) => (
                  <Loading fallback={<p class="loading">Loading route…</p>}>
                    <Show
                      when={Option.getOrUndefined(lineRoute())}
                      fallback={<p class="empty panel-body">This line isn't in the timetable.</p>}
                    >
                      {(lineData) => (
                        <LinePanel
                          route={lineData()}
                          direction={r().direction}
                          live={props.live}
                          map={map}
                        />
                      )}
                    </Show>
                  </Loading>
                )}
              </Match>
              <Match
                when={(() => {
                  const r = route();
                  return r.page === "vehicle" ? r : undefined;
                })()}
              >
                {(r) => (
                  <VehiclePanel
                    hash={hash()}
                    id={r().id}
                    timeZone={props.loaded.timeZone}
                    live={props.live}
                    map={map}
                  />
                )}
              </Match>
              <Match
                when={(() => {
                  const r = route();
                  return r.page === "trip" ? r : undefined;
                })()}
              >
                {(r) => (
                  <TripPanel
                    hash={hash()}
                    city={props.city.id}
                    timeZone={props.loaded.timeZone}
                    from={r().from}
                    to={r().to}
                    stops={stopsReady}
                    live={props.live}
                    map={map}
                  />
                )}
              </Match>
              <Match
                when={(() => {
                  const r = route();
                  return r.page === "route" ? r : undefined;
                })()}
              >
                {(r) => (
                  <RouteEditorPanel
                    hash={hash()}
                    city={props.city.id}
                    timeZone={props.loaded.timeZone}
                    id={r().id}
                    stops={stopsReady}
                    map={map}
                  />
                )}
              </Match>
              <Match
                when={(() => {
                  const r = route();
                  return r.page === "point" ? r : undefined;
                })()}
              >
                {(r) => (
                  <PointPanel
                    hash={hash()}
                    city={props.city.id}
                    lat={r().lat}
                    lon={r().lon}
                    map={map}
                  />
                )}
              </Match>
            </Switch>
          </Errored>
        </section>
      </aside>
      <div class="map" ref={setContainer} />
    </div>
  );
};

export { prefersDark };
