const CACHE = "dtm-shell-v3";
const SHELL_URLS = ["/manifest.webmanifest", "/icons/favicon.ico", "/icons/apple-touch-icon.png"];

function shouldBypassCache(request) {
  const url = new URL(request.url);
  const path = url.pathname.toLowerCase();

  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;

  if (
    path.startsWith("/api/") ||
    path.startsWith("/admin/") ||
    path.startsWith("/portal/") ||
    path.startsWith("/audit/") ||
    path.startsWith("/patients/")
  ) {
    return true;
  }

  if (path.includes("_rsc") || url.searchParams.has("_rsc")) return true;

  const hasSensitiveQuery = ["search", "patient", "clinical", "referral", "prescription", "appointment", "profile"].some(
    (token) => url.searchParams.toString().toLowerCase().includes(token)
  );
  if (hasSensitiveQuery) return true;

  if (request.destination === "document") return true;

  return false;
}

function isSafeStaticRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  return (
    path.startsWith("/_next/static/") ||
    path.startsWith("/icons/") ||
    path === "/manifest.webmanifest" ||
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "font" ||
    request.destination === "image"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL_URLS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (shouldBypassCache(request)) {
    event.respondWith(fetch(request));
    return;
  }

  if (!isSafeStaticRequest(request)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (!res || res.status !== 200) return res;
        const contentType = (res.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("application/json") || contentType.includes("text/html")) return res;
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(request, clone)).catch(() => {});
        return res;
      });
    })
  );
});
