import type { EpochSeconds } from "@odjazd/model";
import { instantOn, type Timetable } from "@odjazd/timetable";

/**
 * One possible world: when each trip instance actually reaches each stop.
 * `stopTime` indexes `timetable.stopTimes`; `day` the service day.
 *
 * The evaluator is deterministic for a given realization. Distributions come
 * from evaluating many sampled realizations (delays correlated along a trip),
 * which is also how missed transfers enter the result.
 */
export interface Realization {
  readonly arrival: (day: number, stopTime: number) => EpochSeconds;
  readonly departure: (day: number, stopTime: number) => EpochSeconds;
}

/** v1: everything runs exactly to schedule. */
export const scheduleRealization = (timetable: Timetable): Realization => ({
  arrival: (day, stopTime) => instantOn(timetable, day, timetable.stopTimes.arrival[stopTime] ?? 0),
  departure: (day, stopTime) =>
    instantOn(timetable, day, timetable.stopTimes.departure[stopTime] ?? 0),
});
