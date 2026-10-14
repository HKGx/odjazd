import type { CityId } from "@odjazd/model";
import type { Place as PlaceRecord } from "@odjazd/user-data";
import type { PlanEndpoint, StopsDto } from "@odjazd/worker";
import { type Accessor, createSignal } from "solid-js";
import { here } from "../../here.ts";
import type { Place } from "../../route.ts";
import { kindIcon } from "../../user.ts";

/** A trip end as shown and planned: its label, and coordinates once known. */
export interface Resolved {
  readonly label: string;
  readonly endpoint: PlanEndpoint | undefined;
  /** Why there's no endpoint yet (e.g. waiting for a location fix). */
  readonly pending?: string;
}

/** Name of the closest stop group, for labelling a map point. */
export const nearestStop = (stops: StopsDto | undefined, lat: number, lon: number) => {
  if (stops === undefined) return undefined;
  let best: string | undefined;
  let bestD = 0.004 ** 2;
  const k = Math.cos((lat * Math.PI) / 180) ** 2;
  stops.names.forEach((name, i) => {
    const d = ((stops.lat[i] ?? 0) - lat) ** 2 + ((stops.lon[i] ?? 0) - lon) ** 2 * k;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  });
  return best;
};

/** Labels and coordinates for trip ends; reactive in the location, places and stops. */
export const resolver =
  (places: Accessor<ReadonlyArray<PlaceRecord>>, stops: Accessor<StopsDto | undefined>) =>
  (place: Place | undefined): Resolved | undefined => {
    if (place === undefined) return undefined;
    switch (place.kind) {
      case "here": {
        const position = here();
        if (position.status === "ok") {
          return { label: "◎ My location", endpoint: { lat: position.lat, lon: position.lon } };
        }
        // Not asked for yet (nothing to plan): no status to show.
        if (position.status === "idle") return { label: "◎ My location", endpoint: undefined };
        const why =
          position.status === "denied"
            ? "location blocked"
            : position.status === "unavailable"
              ? "location unavailable"
              : "locating…";
        return { label: "◎ My location", endpoint: undefined, pending: why };
      }
      case "place": {
        const saved = places().find((p) => p.id === place.id);
        return saved === undefined
          ? { label: "Deleted place", endpoint: undefined, pending: "pick another" }
          : { label: `${kindIcon[saved.kind]} ${saved.name}`, endpoint: saved.point };
      }
      case "stop": {
        const all = stops();
        const name = all?.names[place.group];
        if (all === undefined || name === undefined) {
          return { label: "Stop", endpoint: undefined, pending: "loading…" };
        }
        return {
          label: name,
          endpoint: {
            lat: all.lat[place.group] ?? 0,
            lon: all.lon[place.group] ?? 0,
            group: place.group,
          },
        };
      }
      case "at": {
        const near = nearestStop(stops(), place.lat, place.lon);
        return {
          label: near === undefined ? "◆ Point on the map" : `◆ Near ${near}`,
          endpoint: { lat: place.lat, lon: place.lon },
        };
      }
    }
  };

/*
 * Where trips start, per city: your location until you pick something else,
 * then that, until you pick again. Nothing else changes it: a location fix
 * arriving, closing a trip or swapping keeps your choice. Memory only.
 */
const [starts, setStarts] = createSignal<ReadonlyMap<CityId, Place>>(new Map());

export const startOf = (city: CityId): Place => starts().get(city) ?? { kind: "here" };

export const chooseStart = (city: CityId, place: Place) =>
  setStarts((map) => new Map(map).set(city, place));
