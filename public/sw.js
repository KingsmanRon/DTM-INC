// DTM Inc. service worker.
// §FR-14: caches APP SHELL ONLY. Never caches /api/** responses — those
// contain patient data. All API responses also carry `Cache-Control: no-store`
// from next.config.mjs as a belt-and-braces measure.

const CACHE = "dtm-shell-v1";
const SHELL_URLS = [
  "/",
  "/login",
  "/dashboard",
  "/privacy",
  "/manifest.webmanifest",
  "/icons/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL_URLS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // HARD RULE: never serve /api/** from cache, never store it.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell strategy: network-first for HTML, cache-first for static assets.
  if (request.destination === "document") {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((r) => r ?? caches.match("/")))
    );
    return;
  }

  if (["style", "script", "font", "image"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(request, clone)).catch(() => {});
        return res;
      }))
    );
  }
});
