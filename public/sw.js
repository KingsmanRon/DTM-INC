const CACHE = "dtm-shell-v4";
const SHELL_URLS = ["/manifest.webmanifest", "/icons/favicon.ico", "/icons/apple-touch-icon.png"];

function logError(...args) {
  // eslint-disable-next-line no-console
  console.error("[sw]", ...args);
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function shouldBypassCache(request) {
  const url = new URL(request.url);
  const path = url.pathname.toLowerCase();

  if (request.method !== "GET") return true;

  if (url.origin !== self.location.origin) {
    // Always bypass cross-origin requests, including Supabase traffic.
    return true;
  }

  if (
    path.startsWith("/_next/") ||
    path.startsWith("/api/") ||
    path.includes("/auth/") ||
    path.includes("/session") ||
    path.startsWith("/auth") ||
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

  return false;
}

function isSafeStaticRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  return (
    path.startsWith("/icons/") ||
    path === "/manifest.webmanifest" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "image"
  );
}

async function networkFirstNavigation(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    logError("navigation fetch failed", request.url, error);
    const cached = await caches.match(request);
    if (cached) return cached;

    const fallback = await caches.match("/manifest.webmanifest");
    if (fallback) return fallback;

    return new Response("Offline", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL_URLS)).catch((error) => logError("install cache failed", error)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .catch((error) => logError("activate cleanup failed", error))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const { request } = event;

      try {
        if (isNavigationRequest(request)) {
          return await networkFirstNavigation(request);
        }

        if (shouldBypassCache(request)) {
          return await fetch(request);
        }

        if (!isSafeStaticRequest(request)) {
          return await fetch(request);
        }

        const hit = await caches.match(request);
        if (hit) return hit;

        const res = await fetch(request);
        if (!res || res.status !== 200) return res;

        const contentType = (res.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("application/json") || contentType.includes("text/html")) return res;

        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(request, clone)).catch((error) => logError("cache put failed", error));
        return res;
      } catch (error) {
        logError("fetch handler failed", request.url, error);

        const cached = await caches.match(request);
        if (cached) return cached;

        return new Response("Service unavailable", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
    })()
  );
});
