import { createSignal } from "solid-js";

/**
 * A trip endpoint as it appears in the URL: the device's location (never put
 * in the URL itself), a saved place, a stop group, or a point.
 */
export type Place =
  | { readonly kind: "here" }
  | { readonly kind: "place"; readonly id: string }
  | { readonly kind: "stop"; readonly group: number }
  | { readonly kind: "at"; readonly lat: number; readonly lon: number };

const parsePlace = (text: string | undefined): Place | undefined => {
  if (text === undefined || text === "" || text === "-") return undefined;
  if (text === "here") return { kind: "here" };
  const [kind, value = ""] = text.split(":");
  if (kind === "place" && value !== "") return { kind: "place", id: value };
  if (kind === "stop") {
    const group = Number(value);
    return Number.isInteger(group) && group >= 0 ? { kind: "stop", group } : undefined;
  }
  if (kind === "at") {
    const [lat, lon] = value.split(",").map(Number);
    return lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon)
      ? { kind: "at", lat, lon }
      : undefined;
  }
  return undefined;
};

export const placeText = (place: Place | undefined): string => {
  if (place === undefined) return "-";
  switch (place.kind) {
    case "here":
      return "here";
    case "place":
      return `place:${place.id}`;
    case "stop":
      return `stop:${place.group}`;
    case "at":
      return `at:${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
  }
};

/** Map-hosted pages share the map; the rest replace it. */
export type Route =
  | { readonly page: "map" }
  | { readonly page: "stop"; readonly group: number }
  | { readonly page: "line"; readonly line: string; readonly direction: number }
  | { readonly page: "vehicle"; readonly id: string }
  | { readonly page: "point"; readonly lat: number; readonly lon: number }
  | { readonly page: "trip"; readonly from: Place | undefined; readonly to: Place | undefined }
  /** A route in the map editor; `undefined` for a new one. */
  | { readonly page: "route"; readonly id: string | undefined }
  | { readonly page: "compare" }
  | { readonly page: "board"; readonly area: string | undefined }
  | { readonly page: "places" }
  | { readonly page: "settings" }
  | { readonly page: "about" };

export const onMap = (route: Route): boolean =>
  route.page === "map" ||
  route.page === "stop" ||
  route.page === "line" ||
  route.page === "vehicle" ||
  route.page === "point" ||
  route.page === "trip" ||
  route.page === "route";

const parse = (hash: string): Route => {
  const [page, arg, extra] = hash
    .replace(/^#\/?/, "")
    .split("/")
    .map((part) => decodeURIComponent(part));
  const present = arg !== undefined && arg !== "";
  switch (page) {
    case "stop": {
      const group = Number(arg);
      return Number.isInteger(group) && group >= 0 ? { page: "stop", group } : { page: "map" };
    }
    case "line":
      return present
        ? { page: "line", line: arg, direction: Number(extra ?? 0) || 0 }
        : { page: "map" };
    case "vehicle":
      return present ? { page: "vehicle", id: arg } : { page: "map" };
    case "trip":
      return { page: "trip", from: parsePlace(arg), to: parsePlace(extra) };
    case "at": {
      const [lat, lon] = (arg ?? "").split(",").map(Number);
      return lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon)
        ? { page: "point", lat, lon }
        : { page: "map" };
    }
    case "board":
      return { page: "board", area: present ? arg : undefined };
    case "route":
      return { page: "route", id: present && arg !== "new" ? arg : undefined };
    case "compare":
    case "places":
    case "settings":
    case "about":
      return { page };
    default:
      return { page: "map" };
  }
};

export const href = (route: Route): string => {
  const part = encodeURIComponent;
  switch (route.page) {
    case "map":
      return "#/";
    case "stop":
      return `#/stop/${route.group}`;
    case "line":
      return `#/line/${part(route.line)}${route.direction === 0 ? "" : `/${route.direction}`}`;
    case "vehicle":
      return `#/vehicle/${part(route.id)}`;
    case "trip":
      return `#/trip/${part(placeText(route.from))}/${part(placeText(route.to))}`;
    case "point":
      return `#/at/${route.lat.toFixed(5)},${route.lon.toFixed(5)}`;
    case "route":
      return `#/route/${route.id === undefined ? "new" : part(route.id)}`;
    case "board":
      return `#/board${route.area === undefined ? "" : `/${part(route.area)}`}`;
    default:
      return `#/${route.page}`;
  }
};

const [route, setRoute] = createSignal<Route>(parse(location.hash));
window.addEventListener("hashchange", () => setRoute(parse(location.hash)));

export { route };
export const navigate = (next: Route) => {
  location.hash = href(next);
};
