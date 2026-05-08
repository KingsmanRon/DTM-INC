// DTM Inc. service worker.
// §FR-14: caches APP SHELL ONLY. Never caches /api/** responses — those
// contain patient data. All API responses also carry `Cache-Control: no-store`
// from next.config.mjs as a belt-and-braces measure.
//
// SHELL_URLS is limited to truly static, public assets. HTML pages (/login,
// /dashboard, /privacy, /) are NOT precached because:
//   • /dashboard and other authenticated routes 302 to /login when the user
//     is logged out — precaching that redirect would serve stale auth state.
//   • /login and /privacy may embed build-time stamps or updated text; the
//     network-first 'document' handler below already falls back to cache if
//     offline, so a cold navigation still works when the asset is in cache.
// Keep SHELL_URLS to things that don't change per-user and carry no data.

const CACHE = "dtm-shell-v2";
const SHELL_URLS = [
  "/manifest.webmanifest",
  "/icons/favicon.ico",
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

  // Network-only for HTML. We used to cache the document and fall back to
  // `/`, but that can serve stale auth state (e.g. a logged-out /dashboard
  // redirect) after the user has logged in, or leak content from a previous
  // session on a shared device. The tradeoff is no offline page — acceptable
  // for a clinic workstation app.
  if (request.destination === "document") {
    event.respondWith(fetch(request));
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
