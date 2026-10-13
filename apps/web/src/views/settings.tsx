import type { CityList } from "@odjazd/api";
import { LineRef } from "@odjazd/model";
import type { Theme } from "@odjazd/user-data";
import { Schema } from "effect";
import { createSignal, For, Show } from "solid-js";
import { preferences, updatePreferences } from "../user.ts";

const themes: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "system", label: "Follow the system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Comma- or space-separated line refs; `undefined` when one doesn't parse. */
const parseLines = (text: string): ReadonlyArray<LineRef> | undefined => {
  const refs: Array<LineRef> = [];
  for (const part of text.split(/[\s,]+/).filter((p) => p !== "")) {
    const ref = Schema.decodeOption(LineRef)(part);
    if (ref._tag === "None") return undefined;
    refs.push(ref.value);
  }
  return [...new Set(refs)];
};

const LinesField = (props: {
  label: string;
  hint: string;
  value: ReadonlyArray<LineRef>;
  onSave: (lines: ReadonlyArray<LineRef>) => void;
}) => {
  const [error, setError] = createSignal(false);
  return (
    <label class="stack">
      {props.label}
      <input
        value={props.value.join(", ")}
        placeholder="tram:10, bus:86"
        aria-invalid={error() ? "true" : undefined}
        onChange={(e) => {
          const lines = parseLines(e.currentTarget.value);
          setError(lines === undefined);
          if (lines !== undefined) props.onSave(lines);
        }}
      />
      <span class={error() ? "form-error small" : "muted small"}>
        {error() ? "Write lines as mode:number, like tram:10 or bus:58A." : props.hint}
      </span>
    </label>
  );
};

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
      <h2>Lines</h2>
      <LinesField
        label="Preferred lines"
        hint="Picked over others unless they're much slower."
        value={preferences().preferredLines}
        onSave={(preferredLines) => updatePreferences({ preferredLines })}
      />
      <LinesField
        label="Avoided lines"
        hint="Never used, unless a route asks for them explicitly."
        value={preferences().avoidedLines}
        onSave={(avoidedLines) => updatePreferences({ avoidedLines })}
      />
      <label class="stack">
        Preference strength: {preferences().preferencePenaltyMin} min
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
        <span class="muted small">Other lines count as leaving this much later than they do.</span>
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
