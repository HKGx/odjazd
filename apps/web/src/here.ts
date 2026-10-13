import { createSignal } from "solid-js";

/*
 * The device's position, asked for only when a trip starts or ends "here".
 * It stays in memory: never stored, never put in a URL, never sent anywhere
 * (the planner runs in the worker on this device).
 */
export type Here =
  | { readonly status: "idle" | "locating" | "denied" | "unavailable" }
  | { readonly status: "ok"; readonly lat: number; readonly lon: number; readonly at: number };

const [here, setHere] = createSignal<Here>({ status: "idle" });

let watch: number | undefined;

/** Starts following the position (once); later calls are no-ops. */
export const locate = () => {
  if (watch !== undefined || !("geolocation" in navigator)) {
    if (!("geolocation" in navigator)) setHere({ status: "unavailable" });
    return;
  }
  if (here().status !== "ok") setHere({ status: "locating" });
  watch = navigator.geolocation.watchPosition(
    (position) =>
      setHere({
        status: "ok",
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        at: position.timestamp,
      }),
    (error) => {
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      watch = undefined;
      setHere({ status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" });
    },
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
  );
};

export { here };
