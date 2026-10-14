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
  onCleanup,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { createEffectMemo } from "../../effect-solid.ts";
import { VehicleIcon } from "../../icons.tsx";
import type { LiveMap } from "../../map/live-map.ts";
import { now } from "../../now.ts";
import { href, navigate, route } from "../../route.ts";
import { kindIcon, updatePreferences, useCity } from "../../user.ts";
import { LinePanel } from "./line.tsx";
import { mapPick } from "../../map/pick.ts";
import { PointPanel } from "./point.tsx";
import { RouteEditorPanel } from "./route-editor.tsx";
import { RoutesNow } from "./routes-now.tsx";
import { TripPanel } from "./trip.tsx";
import { ago } from "./parts.tsx";
import { PlanBar } from "./search.tsx";
import { Balloon } from "./balloon.tsx";
import { draftOf, setDraft } from "./endpoints.ts";
import { dragSheet } from "./sheet.ts";
import { StopPanel } from "./stop.tsx";
import { VehiclePanel } from "./vehicle.tsx";

/** Live positions arrive every 15 s; older than this, the chip says how old. */
const STALE = 45;

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
  // Says so when moving the map (not the picker) changed the city.
  const [arrived, setArrived] = createSignal<string>();
  let arrivedTimer: ReturnType<typeof setTimeout> | undefined;
  const switchTo = (city: CitySummary) => {
    updatePreferences({ city: city.id });
    setArrived(city.name["en"] ?? city.id);
    clearTimeout(arrivedTimer);
    arrivedTimer = setTimeout(() => setArrived(undefined), 3000);
  };
  onCleanup(() => clearTimeout(arrivedTimer));

  // The long-pressed point's balloon, kept on its point while the map moves.
  const [balloon, setBalloon] = createSignal<{ lat: number; lon: number }>();
  const [frame, setFrame] = createSignal(0);
  createEffect(map, (m) => m?.onCamera(() => setFrame((n) => n + 1)));
  const balloonAt = createMemo(() => {
    frame();
    const point = balloon();
    const m = map();
    const element = container();
    if (point === undefined || m === undefined || element === undefined) return undefined;
    return { ...m.project(point.lat, point.lon), width: element.clientWidth };
  });

  // Going anywhere (a stop tapped, a panel closed) leaves the balloon behind.
  createEffect(route, () => setBalloon(undefined));

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
          mapPick.point === undefined ? setBalloon({ lat, lon }) : mapPick.point(lat, lon),
        onBackground: () => {
          // A tap beside an open balloon only closes it.
          if (untrack(balloon) !== undefined) return setBalloon(undefined);
          if (route().page !== "map" && mapPick.stop === undefined) navigate({ page: "map" });
        },
        onCity: (id) => {
          const city = props.cities.find((c) => c.id === id);
          if (city !== undefined) switchTo(city);
        },
        // Looking at another city's network (not just the country) makes it the one you're in.
        onMoved: (center, zoom) => {
          if (zoom < 9 || bboxContains(props.city.bbox, center)) return;
          const city = props.cities.find((c) => bboxContains(c.bbox, center));
          if (city !== undefined) switchTo(city);
        },
      });
      setMap(instance);
    });
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  });

  // On narrow screens the panel is a sheet over the map that you drag: tell the map and the
  // controls how much it covers.
  const [panel, setPanel] = createSignal<HTMLElement>();
  const [root, setRoot] = createSignal<HTMLElement>();
  const [sheet, setSheet] = createSignal<ReturnType<typeof dragSheet>>();
  createEffect(
    () => [panel(), root(), map()] as const,
    ([element, container, m]) => {
      if (element === undefined || container === undefined) return;
      const made = dragSheet({
        sheet: element,
        container,
        top: () => container.querySelector<HTMLElement>(".plan-bar"),
        dock: () => document.querySelector<HTMLElement>("nav.dock"),
        onSlide: (visible) => container.style.setProperty("--sheet", `${visible}px`),
        onInset: (visible) => m?.setBottomInset(visible),
      });
      setSheet(made);
      return () => made.dispose();
    },
  );
  // Opening something while the sheet is down lifts it enough to show it.
  createEffect(
    () => [route(), sheet()] as const,
    ([, made], previous) => {
      if (previous !== undefined) made?.reveal();
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
    () => [map(), props.city, props.cities] as const,
    ([m, city, cities]) => {
      if (m === undefined) return;
      m.setCities(
        cities.map((c) => ({ id: c.id, name: c.name["en"] ?? c.id, center: c.center })),
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
  // The chip: the dot says live, connecting or offline; the age only once it's stale.
  const age = createMemo(() => {
    const live = props.live();
    const seconds = now() - live.fetchedAt;
    return live.fetchedAt === 0 || (live.status === "live" && seconds < STALE)
      ? undefined
      : ago(seconds);
  });

  return (
    <div ref={setRoot} class="explore" data-panel={route().page === "map" ? "closed" : "open"}>
      <aside class="side">
        <PlanBar hash={hash()} city={props.city.id} stops={stopsReady}>
          <p
            class={`live-status ${props.live().status}`}
            role="status"
            aria-label={status()}
            title={status()}
          >
            <span class="live-dot" aria-hidden="true" />
            <VehicleIcon />
            <span aria-hidden="true">
              {props.live().status === "connecting" ? "…" : props.live().vehicles.length}
            </span>
            <Show when={age()}>
              {(text) => (
                <span class="live-age" aria-hidden="true">
                  {text()}
                </span>
              )}
            </Show>
          </p>
        </PlanBar>
        <section ref={setPanel} class="panel" aria-label="Details">
          <button
            type="button"
            class="grip"
            aria-label="Resize the details"
            onClick={() => sheet()?.toggle()}
          />
          <Show when={route().page !== "map"}>
            <button
              type="button"
              class="ghost close"
              aria-label="Close"
              onClick={() => {
                // Closing a trip lets go of its destination; the start stays.
                if (route().page === "trip") setDraft(props.city.id, { to: undefined });
                navigate({ page: "map" });
              }}
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
                            from: draftOf(props.city.id).from,
                            to: { kind: "place", id: place.id },
                          })}
                        >
                          {kindIcon[place.kind]} {place.name}
                        </a>
                      )}
                    </For>
                  </div>
                  <RoutesNow
                    hash={hash()}
                    city={props.city.id}
                    timeZone={props.city.timezone}
                    map={map}
                  />
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
      <div class="map-area">
        <div class="map" ref={setContainer} />
        <Show when={balloon()}>
          {(point) => (
            <Show when={balloonAt()}>
              {(at) => (
                <Balloon
                  city={props.city.id}
                  point={point()}
                  at={at()}
                  onClose={() => setBalloon(undefined)}
                />
              )}
            </Show>
          )}
        </Show>
        <Show when={arrived()}>
          {(name) => (
            <p class="arrived" role="status">
              Now in {name()}
            </p>
          )}
        </Show>
      </div>
    </div>
  );
};
