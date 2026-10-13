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
import { createEffectMemo, createEffectStream } from "./effect-solid.ts";
import { megabytes } from "./format.ts";
import { preferences, updatePreferences, useCity, withStore } from "./user.ts";
import { href, onMap, route } from "./route.ts";
import { AboutView } from "./views/about.tsx";
import { BoardView } from "./views/board.tsx";
import { CompareView } from "./views/compare.tsx";
import { ExploreView, prefersDark } from "./views/explore/explore.tsx";
import { PlacesView } from "./views/places.tsx";
import { SettingsView } from "./views/settings.tsx";
import { Api } from "./runtime.ts";

const sections = [
  { page: "map", label: "Map" },
  { page: "compare", label: "Compare" },
  { page: "board", label: "Boards" },
  { page: "places", label: "Places" },
  { page: "settings", label: "Settings" },
  { page: "about", label: "About" },
] as const;

const Nav = () => (
  <nav aria-label="Sections">
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
          {section.label}
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

const City = (props: { city: CitySummary; cities: CityList }) => {
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
  return (
    <Loading
      fallback={
        <p class="loading">
          Loading the {props.city.name["en"]} timetable
          {props.city.downloadBytes === undefined
            ? ""
            : ` (${megabytes(props.city.downloadBytes)})`}
          …
        </p>
      }
    >
      <Show when={loaded().source === "cache"}>
        <p class="notice" role="status">
          <span aria-hidden="true">●</span> Offline: using the timetable saved on this device.
        </p>
      </Show>
      <Switch>
        <Match when={onMap(route())}>
          <ExploreView city={props.city} loaded={loaded()} live={live} dark={dark} />
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
          <SettingsView cities={props.cities} />
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
  const city = createMemo(
    () => props.cities.cities.find((c) => c.id === preferences().city) ?? props.cities.cities[0],
  );
  return (
    <>
      <header>
        <a class="brand" href={href({ page: "map" })}>
          odjazd
        </a>
        <Show when={props.cities.cities.length > 1}>
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
        <Nav />
      </header>
      <main class={onMap(route()) ? "full" : undefined}>
        <Show when={city()} keyed fallback={<p class="empty">No cities are available yet.</p>}>
          {(selected) => (
            <Errored fallback={(error, reset) => <Failure error={error()} reset={reset} />}>
              <City city={selected} cities={props.cities} />
            </Errored>
          )}
        </Show>
      </main>
    </>
  );
};

export const App = () => {
  const cities = createEffectMemo(() => Api.use((api) => api.cities.list()));
  return (
    <Errored fallback={(error, reset) => <Failure error={error()} reset={reset} />}>
      <Loading fallback={<p class="loading">Loading…</p>}>
        <div data-pending={isPending(() => cities())}>
          <Shell cities={cities()} />
        </div>
      </Loading>
    </Errored>
  );
};
