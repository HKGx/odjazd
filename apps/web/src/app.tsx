import type { CityList, CitySummary } from "@odjazd/api";
import { seedIntent } from "@odjazd/user-data";
import { TimetableClient } from "@odjazd/worker";
import { Schema } from "effect";
import { createMemo, Errored, For, isPending, Loading, Match, Show, Switch } from "solid-js";
import { createEffectMemo } from "./effect-solid.ts";
import { megabytes } from "./format.ts";
import { persisted } from "./prefs.ts";
import { href, route } from "./route.ts";
import { AboutView } from "./views/about.tsx";
import { BoardView } from "./views/board.tsx";
import { CompareView } from "./views/compare.tsx";
import { Api } from "./runtime.ts";

const Nav = () => (
  <nav aria-label="Sections">
    <a
      href={href({ page: "compare" })}
      aria-current={route().page === "compare" ? "page" : undefined}
    >
      Compare
    </a>
    <a
      href={href({ page: "board", area: undefined })}
      aria-current={route().page === "board" ? "page" : undefined}
    >
      Departures
    </a>
    <a href={href({ page: "about" })} aria-current={route().page === "about" ? "page" : undefined}>
      About
    </a>
  </nav>
);

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

const City = (props: { city: CitySummary }) => {
  const loaded = createEffectMemo(() => {
    const city = props.city.id;
    return TimetableClient.use((worker) => worker.Load({ city }));
  });
  const intent = createMemo(() => seedIntent(props.city.id));
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
  const [cityId, setCityId] = persisted("city", Schema.String, "");
  const city = createMemo(
    () => props.cities.cities.find((c) => c.id === cityId()) ?? props.cities.cities[0],
  );
  return (
    <>
      <header>
        <a class="brand" href={href({ page: "compare" })}>
          odjazd
        </a>
        <Show when={props.cities.cities.length > 1}>
          <label class="city-picker">
            <span class="sr-only">City</span>
            <select onChange={(e) => setCityId(e.currentTarget.value)}>
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
      <main>
        <Show when={city()} keyed fallback={<p class="empty">No cities are available yet.</p>}>
          {(selected) => (
            <Errored fallback={(error, reset) => <Failure error={error()} reset={reset} />}>
              <City city={selected} />
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
