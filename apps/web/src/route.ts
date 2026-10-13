import { createSignal } from "solid-js";

/** Map-hosted pages share the map; the rest replace it. */
export type Route =
  | { readonly page: "map" }
  | { readonly page: "stop"; readonly group: number }
  | { readonly page: "line"; readonly line: string; readonly direction: number }
  | { readonly page: "vehicle"; readonly id: string }
  | { readonly page: "compare" }
  | { readonly page: "board"; readonly area: string | undefined }
  | { readonly page: "places" }
  | { readonly page: "settings" }
  | { readonly page: "about" };

export const onMap = (route: Route): boolean =>
  route.page === "map" ||
  route.page === "stop" ||
  route.page === "line" ||
  route.page === "vehicle";

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
    case "board":
      return { page: "board", area: present ? arg : undefined };
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
