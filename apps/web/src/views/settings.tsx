import type { CityList } from "@odjazd/api";
import type { Theme } from "@odjazd/user-data";
import { For, Show } from "solid-js";
import { preferences, updatePreferences } from "../user.ts";

const themes: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "system", label: "Follow the system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Preferences; each one changes what the trip and comparison views compute. */
export const SettingsView = (props: { cities: CityList }) => (
  <section class="settings">
    <div class="card">
      <h2>Travel</h2>
      <label class="stack">
        Walking speed: {preferences().walkingSpeedKmh.toFixed(1)} km/h
        <input
          type="range"
          min="2"
          max="8"
          step="0.5"
          value={String(preferences().walkingSpeedKmh)}
          onChange={(e) => updatePreferences({ walkingSpeedKmh: Number(e.currentTarget.value) })}
        />
        <span class="muted small">Walks inside interchange areas and to the first stop.</span>
      </label>
      <label class="stack">
        Time to change vehicles: {preferences().transferBufferSec} s
        <input
          type="range"
          min="0"
          max="300"
          step="15"
          value={String(preferences().transferBufferSec)}
          onChange={(e) => updatePreferences({ transferBufferSec: Number(e.currentTarget.value) })}
        />
        <span class="muted small">Connections tighter than this are treated as missed.</span>
      </label>
    </div>

    <div class="card">
      <h2>Routes</h2>
      <p class="muted small">
        Which lines to take is set per section of each route, in{" "}
        <a href="#/places">Places → Routes</a>. These decide how much they count.
      </p>
      <label class="stack">
        Suggest my route if it's at most {preferences().routeToleranceMin} min slower
        <input
          type="range"
          min="0"
          max="30"
          step="1"
          value={String(preferences().routeToleranceMin)}
          onChange={(e) => updatePreferences({ routeToleranceMin: Number(e.currentTarget.value) })}
        />
        <span class="muted small">
          When planning a trip, a saved route that fits is suggested over the fastest option unless
          it arrives later than this.
        </span>
      </label>
      <label class="stack">
        Preferred lines on a section: worth waiting {preferences().preferencePenaltyMin} min
        <input
          type="range"
          min="0"
          max="15"
          step="1"
          value={String(preferences().preferencePenaltyMin)}
          onChange={(e) =>
            updatePreferences({ preferencePenaltyMin: Number(e.currentTarget.value) })
          }
        />
        <span class="muted small">
          On a section where you prefer some lines, another line is only taken if it leaves at least
          this much sooner.
        </span>
      </label>
    </div>

    <div class="card">
      <h2>Display</h2>
      <fieldset class="kinds">
        <legend>Theme</legend>
        <For each={themes}>
          {(theme) => (
            <label class="check">
              <input
                type="radio"
                name="theme"
                checked={preferences().theme === theme.value}
                onChange={() => updatePreferences({ theme: theme.value })}
              />
              {theme.label}
            </label>
          )}
        </For>
      </fieldset>
      <Show when={props.cities.cities.length > 1}>
        <label class="stack">
          City
          <select
            onChange={(e) => {
              const id = props.cities.cities.find((c) => c.id === e.currentTarget.value)?.id;
              if (id !== undefined) updatePreferences({ city: id });
            }}
          >
            <For each={props.cities.cities}>
              {(c) => (
                <option value={c.id} selected={c.id === preferences().city}>
                  {c.name["en"] ?? c.id}
                </option>
              )}
            </For>
          </select>
        </label>
      </Show>
    </div>
  </section>
);
