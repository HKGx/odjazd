import type { CityList, CitySummary } from "@odjazd/api";
import { type LiveDto, TimetableClient } from "@odjazd/worker";
import { Effect, Stream } from "effect";
import {
  createEffect,
  createMemo,
  createSignal,
  Errored,
  For,
  isPending,
  Loading,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { type JSX, Portal } from "@solidjs/web";
import { createEffectMemo, createEffectStream } from "./effect-solid.ts";
import { megabytes } from "./format.ts";
import { AboutIcon, BoardIcon, CompareIcon, MapIcon, PlacesIcon, SettingsIcon } from "./icons.tsx";
import {
  chosenCity,
  preferences,
  updatePreferences,
  useCity,
  userDataLoaded,
  withStore,
} from "./user.ts";
import { href, navigate, onMap, route } from "./route.ts";
import { AboutView } from "./views/about.tsx";
import { BoardView } from "./views/board.tsx";
import { ChooseCity } from "./views/choose-city.tsx";
import { CompareView } from "./views/compare.tsx";
import { ExploreView, prefersDark } from "./views/explore/explore.tsx";
import { PlacesView } from "./views/places.tsx";
import { SettingsView } from "./views/settings.tsx";
import { Api } from "./runtime.ts";

const sections = [
  { page: "map", label: "Map", icon: MapIcon },
  { page: "compare", label: "Compare", icon: CompareIcon },
  { page: "board", label: "Boards", icon: BoardIcon },
  { page: "places", label: "Places", icon: PlacesIcon },
  { page: "settings", label: "Settings", icon: SettingsIcon },
  { page: "about", label: "About", icon: AboutIcon },
] as const;

/** In the header on wide screens; a small floating dock at the bottom on phones. */
const Nav = (props: { class: string }) => (
  <nav class={props.class} aria-label="Sections">
    <For each={sections}>
      {(section) => (
        <a
          href={href(
            section.page === "board" ? { page: "board", area: undefined } : { page: section.page },
          )}
          aria-current={
            (section.page === "map" ? onMap(route()) : route().page === section.page)
              ? "page"
              : undefined
          }
        >
          <section.icon />
          <span class="nav-label">{section.label}</span>
        </a>
      )}
    </For>
  </nav>
);

/** Dark mode per the theme preference, following the system when set to "system". */
const useDark = () => {
  const query = prefersDark();
  const [systemDark, setSystemDark] = createSignal(query.matches);
  const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
  query.addEventListener("change", listener);
  onCleanup(() => query.removeEventListener("change", listener));
  createEffect(
    () => preferences().theme,
    (theme) => {
      document.documentElement.dataset["theme"] = theme;
    },
  );
  return createMemo(() => {
    const theme = preferences().theme;
    return theme === "system" ? systemDark() : theme === "dark";
  });
};

const Failure = (props: { error: unknown; reset: () => void }) => (
  <div class="card failure" role="alert">
    <h2>
      <span aria-hidden="true">⚠</span> Something went wrong
    </h2>
    <p>{props.error instanceof Error ? props.error.message : String(props.error)}</p>
    <button type="button" onClick={() => props.reset()}>
      Try again
    </button>
  </div>
);

/** No download size means nothing is published yet: a new server is still compiling it. */
const LoadingText = (props: { city: CitySummary }) => (
  <Show
    when={props.city.downloadBytes}
    fallback={
      <>
        The server is preparing the {props.city.name["en"]} timetable for the first time. It opens
        here by itself when ready, usually within a minute or two…
      </>
    }
  >
    {(bytes) => (
      <>
        Loading the {props.city.name["en"]} timetable ({megabytes(bytes())})…
      </>
    )}
  </Show>
);

/** Notices float under the header, over the page: showing or hiding one moves nothing. */
const Status = (props: { slot: HTMLElement | undefined; children: JSX.Element }) => (
  <Show when={props.slot}>{(slot) => <Portal mount={slot()}>{props.children}</Portal>}</Show>
);

const City = (props: { city: CitySummary; cities: CityList; status: HTMLElement | undefined }) => {
  const loaded = createEffectMemo(() => {
    const city = props.city.id;
    return TimetableClient.use((worker) => worker.Load({ city }));
  });
  // Starter areas and routes, offered once per city; the user can delete them.
  createEffect(
    () => props.city.id,
    (city) => {
      withStore((store) => store.seed(city));
    },
  );
  const records = useCity(() => props.city.id);
  const intent = createMemo(() => ({
    areas: records().areas.map((r) => r.area),
    corridors: records().corridors.map((r) => r.corridor),
  }));
  const initialLive: LiveDto = { status: "connecting", fetchedAt: 0, vehicles: [] };
  const live = createEffectStream(() => {
    const city = props.city.id;
    return Stream.unwrap(TimetableClient.use((worker) => Effect.succeed(worker.Live({ city }))));
  }, initialLive);
  const dark = useDark();
  // Stops, vehicles and trips are per network: panels about the old city close.
  createEffect(
    () => props.city.id,
    (_city, previous) => {
      if (previous !== undefined && onMap(route()) && route().page !== "map") {
        navigate({ page: "map" });
      }
    },
  );
  return (
    <Loading
      fallback={
        <p class="loading">
          <LoadingText city={props.city} />
        </p>
      }
    >
      {/* Switching city: the old network stays on screen until the new one is in. */}
      <Status slot={props.status}>
        <Show when={isPending(() => loaded())}>
          <p class="toast" role="status">
            <LoadingText city={props.city} />
          </p>
        </Show>
        <Show when={loaded().source === "cache"}>
          <p class="toast" role="status">
            <span aria-hidden="true">●</span> Offline: using the timetable saved on this device.
          </p>
        </Show>
      </Status>
      <Switch>
        <Match when={onMap(route())}>
          <ExploreView
            city={props.city}
            cities={props.cities.cities}
            loaded={loaded()}
            live={live}
            dark={dark}
          />
        </Match>
        <Match when={route().page === "compare"}>
          <CompareView loaded={loaded()} intent={intent()} />
        </Match>
        <Match when={route().page === "board"}>
          <BoardView
            loaded={loaded()}
            intent={intent()}
            area={(() => {
              const r = route();
              return r.page === "board" ? r.area : undefined;
            })()}
          />
        </Match>
        <Match when={route().page === "places"}>
          <PlacesView city={props.city} />
        </Match>
        <Match when={route().page === "settings"}>
          <SettingsView />
        </Match>
        <Match when={route().page === "about"}>
          <AboutView city={props.city} loaded={loaded()} />
        </Match>
      </Switch>
      <footer>
        <For each={loaded().manifest.attribution}>
          {(license) => (
            <span>
              {license.attribution} ·{" "}
              <a href={license.url} rel="license noopener" target="_blank">
                {license.spdx}
              </a>
            </span>
          )}
        </For>
      </footer>
    </Loading>
  );
};

const Shell = (props: { cities: CityList }) => {
  const city = createMemo(() => {
    const list = props.cities.cities;
    if (list.length === 1) return list[0];
    const id = chosenCity();
    return id === undefined ? undefined : (list.find((c) => c.id === id) ?? list[0]);
  });
  const [status, setStatus] = createSignal<HTMLElement>();
  return (
    <>
      <header>
        <a class="brand" href={href({ page: "map" })}>
          odjazd
        </a>
        <Show when={props.cities.cities.length > 1 && city() !== undefined}>
          <label class="city-picker">
            <span class="sr-only">City</span>
            <select
              onChange={(e) => {
                const id = props.cities.cities.find((c) => c.id === e.currentTarget.value)?.id;
                if (id !== undefined) updatePreferences({ city: id });
              }}
            >
              <For each={props.cities.cities}>
                {(c) => (
                  <option value={c.id} selected={c.id === city()?.id}>
                    {c.name["en"] ?? c.id}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
        <Show when={props.cities.cities.length === 1}>
          <span class="city-name">{city()?.name["en"]}</span>
        </Show>
        <Nav class="sections" />
        <div class="status-slot" ref={setStatus} />
      </header>
      <main class={onMap(route()) ? "full" : undefined}>
        {/* Not keyed: switching city keeps the map and panels, only the network changes. */}
        <Show
          when={city()}
          fallback={
            <Show
              when={props.cities.cities.length > 0}
              fallback={<p class="empty">No cities are available yet.</p>}
            >
              <Show when={userDataLoaded()}>
                <ChooseCity cities={props.cities.cities} />
              </Show>
            </Show>
          }
        >
          {(selected) => (
            <Errored fallback={(error, reset) => <Failure error={error()} reset={reset} />}>
              <City city={selected()} cities={props.cities} status={status()} />
            </Errored>
          )}
        </Show>
      </main>
      <Nav class="dock" />
    </>
  );
};

export const App = () => {
  const cities = createEffectMemo(() => Api.use((api) => api.cities.list()));
  return (
    <Errored fallback={(error, reset) => <Failure error={error()} reset={reset} />}>
      {/* The header's frame from the first paint, so the shell fills in rather than appears. */}
      <Loading
        fallback={
          <header>
            <span class="brand">odjazd</span>
          </header>
        }
      >
        <div data-pending={isPending(() => cities())}>
          <Shell cities={cities()} />
        </div>
      </Loading>
    </Errored>
  );
};
