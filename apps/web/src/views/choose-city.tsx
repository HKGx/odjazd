import type { CitySummary } from "@odjazd/api";
import { For } from "solid-js";
import { megabytes } from "../format.ts";
import { updatePreferences } from "../user.ts";

/** First visit: the user picks their city; nothing is guessed from where they are. */
export const ChooseCity = (props: { cities: ReadonlyArray<CitySummary> }) => (
  <section class="choose-city">
    <h1>Which city?</h1>
    <p class="muted">
      Each city has its own stops, lines and saved places. You can switch any time from the top bar,
      or by zooming into another city on the map.
    </p>
    <ul>
      <For each={props.cities}>
        {(city) => (
          <li>
            <button type="button" onClick={() => updatePreferences({ city: city.id })}>
              <strong>{city.name["en"] ?? city.id}</strong>
              <span class="muted small">
                {city.realtime.includes("vehicle_positions") ? "Live vehicles" : "Timetable"}
                {city.downloadBytes === undefined
                  ? ""
                  : ` · ${megabytes(city.downloadBytes)} download`}
              </span>
            </button>
          </li>
        )}
      </For>
    </ul>
  </section>
);
