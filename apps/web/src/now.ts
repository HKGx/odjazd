import { createSignal } from "solid-js";

const read = () => Math.floor(Date.now() / 1000);
const [now, setNow] = createSignal(read());
// One app-wide clock: boards and countdowns tick together, and only while visible.
setInterval(() => {
  if (document.visibilityState === "visible") setNow(read());
}, 15_000);
document.addEventListener("visibilitychange", () => setNow(read()));

/** Epoch seconds, updated every 15 s. */
export { now };
