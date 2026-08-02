const APP_RELEASE = "2026.08.02.3-public-trust";
const CACHE_NAME = `asher-public-${APP_RELEASE}`;
const PUBLIC_ASSETS = [
  "/",
  "/offline.html",
  "/public-offline.html",
  "/manifest.webmanifest",
  "/images/logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith("asher-public-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated clinic screens or medical/financial information.
  if (url.pathname.startsWith("/admin")) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(async () => {
        if (request.mode === "navigate") {
          return (await caches.match("/offline.html")) || Response.error();
        }
        return new Response("The Asher Staff app is offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }),
    );
    return;
  }

  // Public pages use the network first so patients see current appointment
  // information. If the connection is unavailable, show a branded page that
  // contains no patient, appointment, or billing data.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        return (await caches.match("/public-offline.html")) || Response.error();
      }),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/images/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest";
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
