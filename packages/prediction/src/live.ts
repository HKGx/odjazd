import type { EpochSeconds } from "@odjazd/model";
import type { Timetable } from "@odjazd/timetable";
import type { Realization } from "./realization.ts";

/** A delay reported for one running trip instance, from one of its stops onward. */
export interface LiveDelay {
  readonly trip: number;
  readonly day: number;
  /** First stop time index the delay applies to (the vehicle's current or next stop). */
  readonly fromStopTime: number;
  /** Seconds; positive is late. */
  readonly delay: number;
}

/** Trip index owning a stop time (binary search over `firstStopTime`). */
export const tripOfStopTime = (timetable: Timetable, stopTime: number): number => {
  const first = timetable.trips.firstStopTime;
  let lo = 0;
  let hi = timetable.trips.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((first[mid] ?? 0) <= stopTime) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

const maxEarlySec = 180;

/**
 * `base`, shifted by the live delay for trip instances that report one. The
 * delay is held constant to the end of the trip (v1: no recovery model), and a
 * vehicle running early is assumed to wait out its scheduled departure. Arrivals
 * are at most `maxEarlySec` early: a vehicle can't make up more time than that
 * between its last departure and the next stop.
 */

export const liveRealization = (
  timetable: Timetable,
  base: Realization,
  delays: ReadonlyMap<number, LiveDelay>,
): Realization => {
  const shift = (day: number, stopTime: number, departure: boolean) => {
    if (delays.size === 0) return 0;
    const live = delays.get(tripOfStopTime(timetable, stopTime));
    if (live === undefined || live.day !== day || stopTime < live.fromStopTime) return 0;
    return departure ? Math.max(0, live.delay) : Math.max(-maxEarlySec, live.delay);
  };
  return {
    arrival: (day, stopTime) =>
      (base.arrival(day, stopTime) + shift(day, stopTime, false)) as EpochSeconds,
    departure: (day, stopTime) =>
      (base.departure(day, stopTime) + shift(day, stopTime, true)) as EpochSeconds,
  };
};
