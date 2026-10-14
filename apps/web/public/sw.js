// odjazd's service worker: the app opens offline.
//
// - Pages: network first, falling back to the last copy, so a deploy shows up
//   on the next online launch.
// - /assets/*: content-hashed and immutable, so cache first.
// - /api/cities: the city list, network first; the worker already keeps each
//   city's manifest and timetable on the device.
// - Everything else under /api (realtime, feeds) and other origins (map tiles):
//   not touched.

const version = "v1";
const shell = `odjazd-shell-${version}`;
const assets = `odjazd-assets-${version}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(shell)
      .then((cache) => cache.addAll(["/", "/api/cities", "/manifest.webmanifest", "/icon.svg"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("odjazd-") && key !== shell && key !== assets)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const networkFirst = async (request, cacheName, fallback) => {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(fallback ?? request, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(fallback ?? request);
    if (saved !== undefined) return saved;
    throw error;
  }
};

const cacheFirst = async (request) => {
  const cache = await caches.open(assets);
  const saved = await cache.match(request);
  if (saved !== undefined) return saved;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
};

// The page loaded its first files before this worker controlled it: it lists
// them here so they're kept too.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type !== "cache-assets" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter(
    (url) => typeof url === "string" && new URL(url).origin === self.location.origin,
  );
  event.waitUntil(
    caches.open(assets).then(async (cache) => {
      for (const url of urls) {
        if ((await cache.match(url)) === undefined) await cache.add(url).catch(() => undefined);
      }
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // One page (routes live in the hash): every navigation is the app shell.
    event.respondWith(networkFirst(request, shell, "/"));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname === "/api/cities") {
    event.respondWith(networkFirst(request, shell));
  } else if (!url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, shell));
  }
});
