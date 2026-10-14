import type { ComparisonDto } from "@odjazd/worker";
import { createElementSize } from "@solid-primitives/resize-observer";
import { createMemo, createSignal, For, Show } from "solid-js";
import { clock } from "../format.ts";

/*
 * Door-to-door minutes against departure time, one line per corridor. Hues
 * come from the categorical slots in corridor order (validated in light and
 * dark for adjacent pairs, four slots); a legend, direct end labels and the
 * table view carry identity, so color never stands alone.
 */

const height = 300;
const margin = { top: 24, bottom: 30, left: 44 };
const tickSteps = [5, 10, 15, 20, 30, 60];

export const seriesColor = (index: number) => `var(--series-${(index % 4) + 1})`;

const niceStep = (max: number, count: number, steps: ReadonlyArray<number>) =>
  steps.find((step) => max / step <= count) ?? steps[steps.length - 1] ?? 1;

export const TravelTimeChart = (props: {
  data: ComparisonDto;
  selected: number | undefined;
  onSelect: (row: number) => void;
}) => {
  const [hover, setHover] = createSignal<number | undefined>(undefined);

  const [container, setContainer] = createSignal<HTMLDivElement>();
  const size = createElementSize(container);
  const width = () => Math.max(280, size.width ?? 640);

  const wide = () => width() >= 640;
  const right = () => (wide() ? 200 : 16);

  const geometry = createMemo(() => {
    const { rows, corridors } = props.data;
    const values = corridors.map((_, c) =>
      rows.map((row) => {
        const result = row.results[c];
        return result === null || result === undefined
          ? undefined
          : (result.arriveAt - row.departAt) / 60;
      }),
    );
    const all = values.flat().filter((v): v is number => v !== undefined);
    const yStep = niceStep(Math.max(10, ...all), 6, tickSteps);
    const yMax = Math.max(yStep, Math.ceil(Math.max(10, ...all) / yStep) * yStep);
    const first = rows[0]?.departAt ?? 0;
    const last = rows[rows.length - 1]?.departAt ?? first;
    const span = Math.max(60, last - first);
    const plotWidth = width() - margin.left - right();
    const plotHeight = height - margin.top - margin.bottom;
    const x = (epoch: number) => margin.left + ((epoch - first) / span) * plotWidth;
    const y = (value: number) => margin.top + plotHeight - (value / yMax) * plotHeight;

    const paths = values.map((series) => {
      let d = "";
      let pen = false;
      series.forEach((value, i) => {
        const row = rows[i];
        if (value === undefined || row === undefined) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${x(row.departAt).toFixed(1)},${y(value).toFixed(1)}`;
        pen = true;
      });
      return d;
    });

    const xStep = niceStep(span / 60, 8, tickSteps) * 60;
    const xTicks: Array<number> = [];
    for (let t = Math.ceil(first / xStep) * xStep; t <= last; t += xStep) xTicks.push(t);
    const yTicks: Array<number> = [];
    for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);

    // End labels: last point of each series, nudged apart vertically.
    const labels = values
      .map((series, c) => {
        let i = series.length - 1;
        while (i >= 0 && series[i] === undefined) i--;
        const value = series[i];
        return value === undefined ? undefined : { c, y: y(value) };
      })
      .filter((label) => label !== undefined)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) {
      const previous = labels[i - 1];
      const label = labels[i];
      if (previous !== undefined && label !== undefined && label.y - previous.y < 16) {
        label.y = previous.y + 16;
      }
    }

    return { values, paths, x, y, xTicks, yTicks, labels, plotWidth, plotHeight };
  });

  const focus = () => hover() ?? props.selected;
  // Boxed so row 0 is truthy for <Show>.
  const boxed = (row: number | undefined) => (row === undefined ? undefined : { row });

  const rowAt = (clientX: number, svg: SVGSVGElement) => {
    const { rows } = props.data;
    if (rows.length === 0) return undefined;
    const box = svg.getBoundingClientRect();
    const px = clientX - box.left;
    const g = geometry();
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    rows.forEach((row, i) => {
      const distance = Math.abs(g.x(row.departAt) - px);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  };

  const onKey = (event: KeyboardEvent) => {
    const count = props.data.rows.length;
    if (count === 0) return;
    const current = focus() ?? 0;
    if (event.key === "ArrowRight") setHover(Math.min(count - 1, current + 1));
    else if (event.key === "ArrowLeft") setHover(Math.max(0, current - 1));
    else if (event.key === "Enter" || event.key === " ") props.onSelect(current);
    else return;
    event.preventDefault();
  };

  const tz = () => props.data.timeZone;

  return (
    <div class="chart" ref={setContainer}>
      <ul class="legend" aria-label="Corridors">
        <For each={props.data.corridors}>
          {(corridor, c) => (
            <li>
              <span class="line-key" style={{ background: seriesColor(c()) }} />
              {corridor.name}
            </li>
          )}
        </For>
      </ul>
      <svg
        width={width()}
        height={height}
        role="img"
        aria-label="Door-to-door minutes by departure time; use arrow keys to move between departures"
        tabindex={0}
        onPointerMove={(event) => setHover(rowAt(event.clientX, event.currentTarget))}
        onPointerLeave={() => setHover(undefined)}
        onClick={(event) => {
          const row = rowAt(event.clientX, event.currentTarget);
          if (row !== undefined) props.onSelect(row);
        }}
        onKeyDown={onKey}
        onBlur={() => setHover(undefined)}
      >
        <For each={geometry().yTicks}>
          {(tick) => (
            <g>
              <line
                class="grid"
                x1={margin.left}
                x2={margin.left + geometry().plotWidth}
                y1={geometry().y(tick)}
                y2={geometry().y(tick)}
              />
              <text
                class="tick"
                x={margin.left - 8}
                y={geometry().y(tick)}
                dy="0.32em"
                text-anchor="end"
              >
                {tick}
              </text>
            </g>
          )}
        </For>
        <line
          class="axis"
          x1={margin.left}
          x2={margin.left + geometry().plotWidth}
          y1={geometry().y(0)}
          y2={geometry().y(0)}
        />
        <For each={geometry().xTicks}>
          {(tick) => (
            <text class="tick" x={geometry().x(tick)} y={height - 10} text-anchor="middle">
              {clock(tick, tz())}
            </text>
          )}
        </For>
        <text class="tick" x={margin.left - 8} y={8} text-anchor="end">
          min
        </text>

        <Show when={boxed(focus())} keyed>
          {({ row }) => {
            const departAt = () => props.data.rows[row]?.departAt ?? 0;
            return (
              <line
                class="crosshair"
                x1={geometry().x(departAt())}
                x2={geometry().x(departAt())}
                y1={margin.top}
                y2={margin.top + geometry().plotHeight}
              />
            );
          }}
        </Show>

        <For each={geometry().paths}>
          {(d, c) => <path class="series" d={d} style={{ stroke: seriesColor(c()) }} />}
        </For>

        <Show when={boxed(focus())} keyed>
          {({ row }) => (
            <For each={geometry().values}>
              {(series, c) => (
                <Show when={series[row]} keyed>
                  {(value) => (
                    <circle
                      class="marker"
                      cx={geometry().x(props.data.rows[row]?.departAt ?? 0)}
                      cy={geometry().y(value)}
                      r={4}
                      style={{ fill: seriesColor(c()) }}
                    />
                  )}
                </Show>
              )}
            </For>
          )}
        </Show>

        <Show when={wide()}>
          <For each={geometry().labels}>
            {(label) => (
              <g transform={`translate(${margin.left + geometry().plotWidth + 8},${label.y})`}>
                <line class="label-key" x1={0} x2={10} style={{ stroke: seriesColor(label.c) }} />
                <text class="end-label" x={14} dy="0.32em">
                  {props.data.corridors[label.c]?.name ?? ""}
                </text>
              </g>
            )}
          </For>
        </Show>
      </svg>

      <Show when={boxed(hover())} keyed>
        {({ row }) => {
          const departAt = () => props.data.rows[row]?.departAt ?? 0;
          const left = () => geometry().x(departAt());
          const flip = () => left() > width() / 2;
          return (
            <div
              class="tooltip"
              role="status"
              style={{
                left: `${flip() ? left() - 12 : left() + 12}px`,
                transform: flip() ? "translateX(-100%)" : "none",
              }}
            >
              <div class="tooltip-title">Leave {clock(departAt(), tz())}</div>
              <For each={props.data.corridors}>
                {(corridor, c) => {
                  const result = () => props.data.rows[row]?.results[c()];
                  return (
                    <div class="tooltip-row">
                      <span class="line-key" style={{ background: seriesColor(c()) }} />
                      <strong>
                        {(() => {
                          const r = result();
                          return r === null || r === undefined
                            ? "no service"
                            : `${Math.round((r.arriveAt - departAt()) / 60)} min · ${clock(r.arriveAt, tz())}`;
                        })()}
                      </strong>
                      <span class="muted">{corridor.name}</span>
                    </div>
                  );
                }}
              </For>
            </div>
          );
        }}
      </Show>
    </div>
  );
};
