import { ServiceDate } from "@odjazd/model";
import { Schema } from "effect";

const clocks = new Map<string, Intl.DateTimeFormat>();

/** `HH:MM` of an epoch-seconds instant in the city's time zone. */
export const clock = (epoch: number, timeZone: string): string => {
  let format = clocks.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
    clocks.set(timeZone, format);
  }
  return format.format(epoch * 1000);
};

/** Today's service date in the city's time zone. */
export const today = (timeZone: string, now = Date.now()): ServiceDate =>
  Schema.decodeSync(ServiceDate)(new Intl.DateTimeFormat("en-CA", { timeZone }).format(now));

/** Current wall-clock `HH:MM` in the city's time zone, rounded down to `step` minutes. */
export const nowClock = (timeZone: string, step = 5, now = Date.now()): string => {
  const [h = "0", m = "0"] = clock(now / 1000, timeZone).split(":");
  const minutes = Number(h) * 60 + Math.floor(Number(m) / step) * step;
  return toClock(minutes);
};

export const toClock = (minutes: number): string => {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
};

export const fromClock = (text: string): number => {
  const [h = "0", m = "0"] = text.split(":");
  return Number(h) * 60 + Number(m);
};

export const minutes = (seconds: number): string => `${Math.round(seconds / 60)} min`;

export const oneDecimal = (value: number | undefined): string =>
  value === undefined ? "—" : value.toFixed(1);

export const megabytes = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;
