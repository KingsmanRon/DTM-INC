const CACHE = "dtm-shell-v6";
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icons/favicon.ico", "/icons/apple-touch-icon.png"];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Offline</title></head><body><h1>You are offline</h1><p>Please reconnect and try again.</p></body></html>`;

function logError(...args) {
  // eslint-disable-next-line no-console
  console.error("[sw]", ...args);
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function isCrossOriginRequest(request) {
  return new URL(request.url).origin !== self.location.origin;
}

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

  if (isCrossOriginRequest(request)) return true;

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

async function fetchOrFallback(request, options = {}) {
  try {
    return await fetch(request);
  } catch (error) {
    if (options.logOnError !== false) {
      logError(options.context || "fetch failed", request.url, error);
    }

    const cached = await caches.match(request);
    if (cached) return cached;

    return options.fallbackResponse || Response.error();
  }
}

async function networkFirstNavigation(request) {
  const networkResponse = await fetchOrFallback(request, {
    context: "navigation fetch failed",
    fallbackResponse: null,
  });

  if (networkResponse && networkResponse.type !== "error") {
    return networkResponse;
  }

  const appShell = await caches.match("/");
  if (appShell) return appShell;

  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
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
          return networkFirstNavigation(request);
        }

        if (shouldBypassCache(request)) {
          return fetchOrFallback(request, {
            context: "bypass fetch failed",
            // Cross-origin CSP denials are expected in some environments; avoid noisy logs.
            logOnError: !isCrossOriginRequest(request),
            fallbackResponse: Response.error(),
          });
        }

        if (!isSafeStaticRequest(request)) {
          return fetchOrFallback(request, {
            context: "non-cacheable fetch failed",
            fallbackResponse: Response.error(),
          });
        }

        const hit = await caches.match(request);
        if (hit) return hit;

        const res = await fetchOrFallback(request, {
          context: "cacheable fetch failed",
          fallbackResponse: Response.error(),
        });
        if (!res || res.type === "error" || res.status !== 200) return res;

        const contentType = (res.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("application/json") || contentType.includes("text/html")) return res;

        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(request, clone)).catch((error) => logError("cache put failed", error));
        return res;
      } catch (error) {
        logError("fetch handler failed", request.url, error);
        const cached = await caches.match(request);
        if (cached) return cached;
        return Response.error();
      }
    })()
  );
});
