import { ServiceDate } from "@odjazd/model";
import type { SeedIntent } from "@odjazd/user-data";
import {
  type ComparisonDto,
  type ItineraryDto,
  type LoadResult,
  TimetableClient,
} from "@odjazd/worker";
import { Option, Schema } from "effect";
import { createEffect, createMemo, createSignal, For, isPending, Show, untrack } from "solid-js";
import { createEffectMemo } from "../effect-solid.ts";
import { clock, fromClock, minutes, nowClock, oneDecimal, toClock, today } from "../format.ts";
import { queryPreferences } from "../apply-preferences.ts";
import { persisted } from "../prefs.ts";
import { href } from "../route.ts";
import { preferences, updatePreferences } from "../user.ts";
import { seriesColor, TravelTimeChart } from "./chart.tsx";

const Clock = Schema.String.check(Schema.isPattern(/^\d{2}:\d{2}$/));
const parseDate = Schema.decodeUnknownOption(ServiceDate);

const presets = [
  { label: "Morning", from: "07:00", to: "09:00" },
  { label: "Midday", from: "11:00", to: "13:00" },
  { label: "Afternoon", from: "15:00", to: "18:00" },
  { label: "Evening", from: "19:00", to: "22:00" },
] as const;

const clampDate = (date: ServiceDate, loaded: LoadResult): ServiceDate =>
  date < loaded.firstDate ? loaded.firstDate : date > loaded.lastDate ? loaded.lastDate : date;

export const CompareView = (props: { loaded: LoadResult; intent: SeedIntent }) => {
  const tz = () => props.loaded.timeZone;
  // The initial date is a snapshot; later loads keep the user's choice.
  const [date, setDate] = createSignal<ServiceDate>(
    untrack(() => clampDate(today(tz()), props.loaded)),
  );
  const [from, setFrom] = persisted("compare.from", Clock, "07:00");
  const [to, setTo] = persisted("compare.to", Clock, "09:00");
  const [step, setStep] = persisted("compare.step", Schema.Int, 5);
  const [hidden, setHidden] = persisted("compare.hidden", Schema.Array(Schema.String), []);
  const [selected, setSelected] = createSignal<number | undefined>(undefined);
  const [showTable, setShowTable] = createSignal(false);

  const corridors = createMemo(() =>
    props.intent.corridors.filter((corridor) => !hidden().includes(corridor.slug)),
  );

  const comparison = createEffectMemo(() => {
    const query = {
      hash: props.loaded.manifest.timetable.hash,
      areas: props.intent.areas,
      corridors: corridors(),
      date: date(),
      from: from(),
      to: fromClock(to()) < fromClock(from()) ? from() : to(),
      stepMinutes: step(),
      ...queryPreferences(preferences()),
    };
    return TimetableClient.use((worker) => worker.Compare(query));
  });
  // A new comparison invalidates the selected departure.
  createEffect(comparison, () => setSelected(undefined));

  const toggle = (slug: string) =>
    setHidden(hidden().includes(slug) ? hidden().filter((s) => s !== slug) : [...hidden(), slug]);

  const leaveNow = () => {
    const now = nowClock(tz(), step());
    setDate(clampDate(today(tz()), props.loaded));
    setFrom(now);
    setTo(toClock(fromClock(now) + 120));
  };

  return (
    <section class="compare">
      <form class="filters" onSubmit={(event) => event.preventDefault()}>
        <label>
          Date
          <input
            type="date"
            value={date()}
            min={props.loaded.firstDate}
            max={props.loaded.lastDate}
            onInput={(event) => {
              Option.map(parseDate(event.currentTarget.value), setDate);
            }}
          />
        </label>
        <label>
          From
          <input
            type="time"
            value={from()}
            onChange={(e) => setFrom(e.currentTarget.value.slice(0, 5))}
          />
        </label>
        <label>
          To
          <input
            type="time"
            value={to()}
            onChange={(e) => setTo(e.currentTarget.value.slice(0, 5))}
          />
        </label>
        <label>
          Every
          <select onChange={(e) => setStep(Number(e.currentTarget.value))}>
            <For each={[1, 2, 5, 10, 15]}>
              {(n) => (
                <option value={String(n)} selected={n === step()}>
                  {n} min
                </option>
              )}
            </For>
          </select>
        </label>
        <label>
          Transfer buffer
          <select
            onChange={(e) =>
              updatePreferences({ transferBufferSec: Number(e.currentTarget.value) })
            }
          >
            <For each={[0, 30, 60, 90, 120, 180]}>
              {(n) => (
                <option value={String(n)} selected={n === preferences().transferBufferSec}>
                  {n} s
                </option>
              )}
            </For>
          </select>
        </label>
        <div class="presets" role="group" aria-label="Time window presets">
          <button type="button" onClick={leaveNow}>
            Leave now
          </button>
          <For each={presets}>
            {(preset) => (
              <button
                type="button"
                aria-pressed={from() === preset.from && to() === preset.to ? "true" : "false"}
                onClick={() => {
                  setFrom(preset.from);
                  setTo(preset.to);
                }}
              >
                {preset.label}
              </button>
            )}
          </For>
        </div>
      </form>
      <p class="muted small applied">
        Walking {oneDecimal(preferences().walkingSpeedKmh)} km/h ·{" "}
        <a href={href({ page: "settings" })}>Settings</a> ·{" "}
        <a href={href({ page: "places" })}>Edit routes</a>
      </p>

      <fieldset class="corridor-picker">
        <legend>Corridors</legend>
        <For each={props.intent.corridors}>
          {(corridor) => (
            <label class="check">
              <input
                type="checkbox"
                checked={!hidden().includes(corridor.slug)}
                onChange={() => toggle(corridor.slug)}
              />
              {corridor.name}
            </label>
          )}
        </For>
      </fieldset>

      <div class="results" data-pending={isPending(() => comparison())}>
        <Results
          data={comparison()}
          selected={selected()}
          onSelect={setSelected}
          showTable={showTable()}
          onShowTable={setShowTable}
        />
      </div>
    </section>
  );
};

const Results = (props: {
  data: ComparisonDto;
  selected: number | undefined;
  onSelect: (row: number | undefined) => void;
  showTable: boolean;
  onShowTable: (value: boolean) => void;
}) => {
  const bestMean = createMemo(() => {
    const means = props.data.summaries
      .map((s) => s.meanMinutes)
      .filter((m): m is number => m !== undefined);
    return means.length === 0 ? undefined : Math.min(...means);
  });

  return (
    <>
      <Show when={!props.data.inRange}>
        <p class="notice" role="alert">
          <span aria-hidden="true">⚠</span> This date is outside the loaded timetable.
        </p>
      </Show>
      <For each={props.data.rejected}>
        {(rejected) => (
          <p class="notice" role="alert">
            <span aria-hidden="true">⚠</span> Corridor {rejected.slug} skipped: {rejected.reason}
          </p>
        )}
      </For>

      <Show
        when={props.data.corridors.length > 0}
        fallback={<p class="empty">Pick at least one corridor.</p>}
      >
        <div class="card">
          <div class="card-head">
            <h2>Door-to-door time by departure</h2>
            <div class="segmented" role="group" aria-label="View">
              <button
                type="button"
                aria-pressed={!props.showTable ? "true" : "false"}
                onClick={() => props.onShowTable(false)}
              >
                Chart
              </button>
              <button
                type="button"
                aria-pressed={props.showTable ? "true" : "false"}
                onClick={() => props.onShowTable(true)}
              >
                Table
              </button>
            </div>
          </div>
          <Show
            when={props.showTable}
            fallback={
              <TravelTimeChart
                data={props.data}
                selected={props.selected}
                onSelect={props.onSelect}
              />
            }
          >
            <RowsTable data={props.data} selected={props.selected} onSelect={props.onSelect} />
          </Show>
        </div>

        <Show when={props.selected === undefined ? undefined : { row: props.selected }} keyed>
          {({ row }) => <Itineraries data={props.data} row={row} />}
        </Show>

        <div class="card">
          <h2>Summary</h2>
          <div class="table-scroll">
            <table class="summary">
              <thead>
                <tr>
                  <th scope="col">Corridor</th>
                  <th scope="col">Feasible</th>
                  <th scope="col">Mean</th>
                  <th scope="col">Median</th>
                  <th scope="col">Worst</th>
                  <th scope="col" title="Departures where this corridor arrives first">
                    Earliest
                  </th>
                  <th scope="col" title="Mean minutes later than the best corridor">
                    Mean loss
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={props.data.summaries}>
                  {(summary, c) => (
                    <tr>
                      <th scope="row">
                        <span class="line-key" style={{ background: seriesColor(c()) }} />
                        {props.data.corridors[c()]?.name}
                        <Show
                          when={
                            summary.meanMinutes !== undefined && summary.meanMinutes === bestMean()
                          }
                        >
                          <span class="badge">fastest</span>
                        </Show>
                      </th>
                      <td>
                        {summary.feasible}/{props.data.rows.length}
                      </td>
                      <td>{oneDecimal(summary.meanMinutes)}</td>
                      <td>{oneDecimal(summary.medianMinutes)}</td>
                      <td>{oneDecimal(summary.worstMinutes)}</td>
                      <td>{summary.earliest}</td>
                      <td>{oneDecimal(summary.meanLossMinutes)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="subtitle">Minutes. Mean loss counts only departures the corridor serves.</p>
        </div>

        <div class="card">
          <h2>Legs</h2>
          <For each={props.data.corridors}>
            {(corridor, c) => (
              <div class="resolved">
                <h3>
                  <span class="line-key" style={{ background: seriesColor(c()) }} />
                  {corridor.name}
                </h3>
                <ul>
                  <For each={corridor.legs}>
                    {(leg) => (
                      <li>
                        <span class="muted">
                          {leg.fromName} → {leg.toName}:
                        </span>{" "}
                        <Show
                          when={leg.lines.length > 0}
                          fallback={<strong class="no-service">no service</strong>}
                        >
                          <For each={leg.lines}>
                            {(line) => (
                              <span
                                class={`line-badge ${line.mode}`}
                                title={`${line.instances} trips`}
                              >
                                {line.label}
                              </span>
                            )}
                          </For>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );
};

const RowsTable = (props: {
  data: ComparisonDto;
  selected: number | undefined;
  onSelect: (row: number) => void;
}) => (
  <div class="table-scroll">
    <table class="rows">
      <thead>
        <tr>
          <th scope="col">Leave</th>
          <For each={props.data.corridors}>
            {(corridor) => <th scope="col">{corridor.name}</th>}
          </For>
        </tr>
      </thead>
      <tbody>
        <For each={props.data.rows}>
          {(row, i) => {
            const best = Math.min(
              ...row.results.map((r) => r?.arriveAt ?? Number.POSITIVE_INFINITY),
            );
            return (
              <tr
                aria-selected={props.selected === i() ? "true" : "false"}
                tabindex={0}
                onClick={() => props.onSelect(i())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.onSelect(i());
                }}
              >
                <th scope="row">{clock(row.departAt, props.data.timeZone)}</th>
                <For each={row.results}>
                  {(result) => (
                    <td>
                      <Show when={result} fallback={<span class="muted">—</span>} keyed>
                        {(r) => (
                          <>
                            <strong>{Math.round((r.arriveAt - row.departAt) / 60)}</strong>
                            <span class="muted">
                              {" "}
                              {clock(r.arriveAt, props.data.timeZone)}{" "}
                              {r.legs.map((leg) => leg.label).join("→")}
                            </span>
                            <Show when={r.arriveAt === best}>
                              <span class="badge">first</span>
                            </Show>
                          </>
                        )}
                      </Show>
                    </td>
                  )}
                </For>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </div>
);

const Itineraries = (props: { data: ComparisonDto; row: number }) => {
  const row = () => props.data.rows[props.row];
  const tz = () => props.data.timeZone;
  return (
    <div class="card">
      <h2>Leaving at {clock(row()?.departAt ?? 0, tz())}</h2>
      <div class="itineraries">
        <For each={props.data.corridors}>
          {(corridor, c) => (
            <article class="itinerary">
              <h3>
                <span class="line-key" style={{ background: seriesColor(c()) }} />
                {corridor.name}
              </h3>
              <Show
                when={row()?.results[c()]}
                fallback={<p class="muted">No service within the wait limit.</p>}
                keyed
              >
                {(itinerary: ItineraryDto) => (
                  <>
                    <p class="arrival">
                      <strong>{clock(itinerary.arriveAt, tz())}</strong>{" "}
                      <span class="muted">
                        arrive · {minutes(itinerary.arriveAt - itinerary.departAt)}
                      </span>
                    </p>
                    <ol class="legs">
                      <For each={itinerary.legs}>
                        {(leg) => (
                          <li>
                            <span class={`line-badge ${leg.mode}`}>{leg.label}</span>
                            <div>
                              <div>
                                {clock(leg.departAt, tz())} {leg.boardStop} →{" "}
                                {clock(leg.arriveAt, tz())} {leg.alightStop}
                              </div>
                              <div class="muted small">
                                {leg.headsign === "" ? "" : `towards ${leg.headsign} · `}
                                {leg.stayedAboard
                                  ? "stay aboard"
                                  : `walk ${Math.round(leg.walkSec / 60)} min · wait ${Math.round(leg.waitSec / 60)} min`}
                              </div>
                            </div>
                          </li>
                        )}
                      </For>
                    </ol>
                  </>
                )}
              </Show>
            </article>
          )}
        </For>
      </div>
    </div>
  );
};
