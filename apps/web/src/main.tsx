import { render } from "@solidjs/web";
import { App } from "./app.tsx";
import "./styles.css";

const root = document.getElementById("app");
if (root !== null) render(() => <App />, root);

// Opens offline once installed. Not in development: Vite serves modules uncached.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
    void navigator.serviceWorker.ready.then((registration) => {
      const urls = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => new URL(url).pathname.startsWith("/assets/"));
      registration.active?.postMessage({ type: "cache-assets", urls });
    });
  });
}
