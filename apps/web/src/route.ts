import { createSignal } from "solid-js";

export type Route =
  | { readonly page: "compare" }
  | { readonly page: "board"; readonly area: string | undefined }
  | { readonly page: "about" };

const parse = (hash: string): Route => {
  const [page, arg] = hash.replace(/^#\/?/, "").split("/");
  if (page === "board")
    return {
      page: "board",
      area: arg === undefined || arg === "" ? undefined : decodeURIComponent(arg),
    };
  if (page === "about") return { page: "about" };
  return { page: "compare" };
};

export const href = (route: Route): string =>
  route.page === "board"
    ? `#/board${route.area === undefined ? "" : `/${encodeURIComponent(route.area)}`}`
    : `#/${route.page}`;

const [route, setRoute] = createSignal<Route>(parse(location.hash));
window.addEventListener("hashchange", () => setRoute(parse(location.hash)));

export { route };
export const navigate = (next: Route) => {
  location.hash = href(next);
};
