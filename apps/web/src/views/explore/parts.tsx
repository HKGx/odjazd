import type { LineLabel } from "@odjazd/worker";
import { Show } from "solid-js";
import { clock } from "../../format.ts";
import { href } from "../../route.ts";

export const LineBadge = (props: { line: LineLabel; small?: boolean; link?: boolean }) => (
  <Show
    when={props.link === true}
    fallback={
      <span class={`line-badge ${props.line.mode}${props.small === true ? " small" : ""}`}>
        {props.line.label}
      </span>
    }
  >
    <a
      class={`line-badge ${props.line.mode}${props.small === true ? " small" : ""}`}
      href={href({ page: "line", line: props.line.id, direction: 0 })}
      aria-label={`Line ${props.line.label}`}
    >
      {props.line.label}
    </a>
  </Show>
);

/** "+3 min" / "on time" / "1 min early"; nothing when there's no live data. */
export const delayText = (delay: number | undefined): string | undefined => {
  if (delay === undefined) return undefined;
  const minutes = Math.round(delay / 60);
  if (minutes === 0) return "on time";
  return minutes > 0 ? `+${minutes} min` : `${-minutes} min early`;
};

export const LiveTag = (props: { delay: number | undefined }) => (
  <Show when={delayText(props.delay)}>
    {(text) => (
      <span class={`live-tag${(props.delay ?? 0) >= 180 ? " late" : ""}`}>
        <span class="live-dot" aria-hidden="true" />
        {text()}
      </span>
    )}
  </Show>
);

/** Countdown for imminent departures, clock time after that. */
export const Countdown = (props: { at: number; now: number; timeZone: string }) => {
  const minutes = () => Math.round((props.at - props.now) / 60);
  return (
    <span class="when">
      <strong>
        {minutes() <= 0
          ? "now"
          : minutes() < 60
            ? `${minutes()} min`
            : clock(props.at, props.timeZone)}
      </strong>
      <span class="muted small">{clock(props.at, props.timeZone)}</span>
    </span>
  );
};

export const ago = (seconds: number): string =>
  seconds < 60
    ? `${Math.max(0, Math.round(seconds))} s ago`
    : `${Math.round(seconds / 60)} min ago`;
