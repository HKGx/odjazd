import type { CityId } from "@odjazd/model";
import type { StopsDto } from "@odjazd/worker";
import { type Accessor, onCleanup, Show } from "solid-js";
import { navigate, type Place } from "../../route.ts";
import { draftOf, nearestStop, setDraft } from "./endpoints.ts";

/** Room the balloon needs above a point before it opens below it instead. */
const ROOM_ABOVE = 132;
/** Half the balloon's width, so it stays inside the map near the edges. */
const HALF = 150;

/**
 * What to do with a long-pressed (or right-clicked) point, right where it is:
 * the finger only moves up a little to a choice. Floats over the map, so
 * opening and closing it moves nothing.
 */
export const Balloon = (props: {
  city: CityId;
  point: { lat: number; lon: number };
  /** The point on screen and the map's size, in pixels. */
  at: { x: number; y: number; width: number };
  stops: Accessor<StopsDto | undefined>;
  onClose: () => void;
}) => {
  const place = (): Place => ({ kind: "at", lat: props.point.lat, lon: props.point.lon });
  const near = () => nearestStop(props.stops(), props.point.lat, props.point.lon);
  const below = () => props.at.y < ROOM_ABOVE;
  // The box slides to stay on screen; its tip stays on the point.
  const left = () =>
    Math.min(Math.max(props.at.x, HALF + 8), Math.max(HALF + 8, props.at.width - HALF - 8));

  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") props.onClose();
  };
  document.addEventListener("keydown", keyDown);
  onCleanup(() => document.removeEventListener("keydown", keyDown));

  // One end set: wait for the other in the fields; both: show the trip.
  const use = (end: "from" | "to") => {
    const draft = draftOf(props.city);
    const next = end === "from" ? { ...draft, from: place() } : { ...draft, to: place() };
    setDraft(props.city, next);
    props.onClose();
    if (next.to !== undefined) navigate({ page: "trip", from: next.from, to: next.to });
  };

  return (
    <>
      <span
        class="balloon-pin"
        aria-hidden="true"
        style={{ left: `${props.at.x}px`, top: `${props.at.y}px` }}
      />
      <div
        class={{ balloon: true, below: below() }}
        role="dialog"
        aria-label="This point"
        style={{
          left: `${left()}px`,
          top: `${props.at.y}px`,
          "--tip": `${props.at.x - left()}px`,
        }}
      >
        <p class="balloon-title small">
          <Show when={near()} fallback="Point on the map">
            {(name) => <>Near {name()}</>}
          </Show>
        </p>
        <div class="balloon-actions">
          <button type="button" onClick={() => use("from")}>
            From here
          </button>
          <button type="button" class="primary" onClick={() => use("to")}>
            To here
          </button>
          <button
            type="button"
            class="ghost"
            title="Save this point, make an interchange area, nearby stops"
            onClick={() => {
              props.onClose();
              navigate({ page: "point", lat: props.point.lat, lon: props.point.lon });
            }}
          >
            More…
          </button>
        </div>
      </div>
    </>
  );
};
