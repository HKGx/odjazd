import type { Corridor, EpochSeconds, InterchangeArea } from "@odjazd/model";
import {
  evaluateFirstSuitable,
  prepareCorridor,
  type EvaluationOptions,
  type Itinerary,
  type PreparedCorridor,
} from "./evaluate.ts";

export interface ComparisonRow {
  readonly departAt: EpochSeconds;
  /** One per corridor, in input order; `undefined` where the corridor has no service. */
  readonly results: ReadonlyArray<Itinerary | undefined>;
}

export interface CorridorSummary {
  /** Departures for which the corridor gets the rider there at all. */
  readonly feasible: number;
  /** Door-to-door (area center to area center) minutes. */
  readonly meanMinutes: number | undefined;
  readonly medianMinutes: number | undefined;
  readonly worstMinutes: number | undefined;
  /** Departures where this corridor arrives earliest (ties count for each). */
  readonly earliest: number;
  /** Mean minutes later than the best corridor for the same departure. */
  readonly meanLossMinutes: number | undefined;
}

export interface Comparison {
  readonly corridors: ReadonlyArray<PreparedCorridor>;
  readonly rows: ReadonlyArray<ComparisonRow>;
  readonly summaries: ReadonlyArray<CorridorSummary>;
}

const mean = (values: ReadonlyArray<number>) =>
  values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length;

const median = (values: ReadonlyArray<number>) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/**
 * Evaluates every corridor for departures every `stepSec` in `[from, to]`
 * under identical inputs (same timetable, realization, walking model).
 */
export const compareCorridors = (
  options: EvaluationOptions,
  corridors: ReadonlyArray<Corridor>,
  areas: ReadonlyArray<InterchangeArea>,
  from: EpochSeconds,
  to: EpochSeconds,
  stepSec: number,
): Comparison => {
  const prepared = corridors.map((corridor) => prepareCorridor(options, corridor, areas, from, to));
  const rows: Array<ComparisonRow> = [];
  for (let t = from; t <= to; t = (t + stepSec) as EpochSeconds) {
    rows.push({
      departAt: t,
      results: prepared.map((corridor) => evaluateFirstSuitable(options, corridor, t)),
    });
  }

  const summaries = prepared.map((_, c): CorridorSummary => {
    const minutes: Array<number> = [];
    const losses: Array<number> = [];
    let earliest = 0;
    for (const row of rows) {
      const result = row.results[c];
      if (result === undefined) continue;
      minutes.push((result.arriveAt - row.departAt) / 60);
      const best = Math.min(...row.results.map((r) => r?.arriveAt ?? Number.POSITIVE_INFINITY));
      losses.push((result.arriveAt - best) / 60);
      if (result.arriveAt === best) earliest++;
    }
    return {
      feasible: minutes.length,
      meanMinutes: mean(minutes),
      medianMinutes: median(minutes),
      worstMinutes: minutes.length === 0 ? undefined : Math.max(...minutes),
      earliest,
      meanLossMinutes: mean(losses),
    };
  });

  return { corridors: prepared, rows, summaries };
};
