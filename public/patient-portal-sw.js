const PATIENT_PORTAL_RELEASE = "2026.08.13.1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/portal")) return;

  // Every portal request is network-only. No page, prescription, receipt or
  // report response is ever written to Cache Storage on a patient device.
  event.respondWith(fetch(request, { cache: "no-store" }).catch(() => {
    const html = request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
    if (html) {
      return new Response(
        "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>Connection required</title><main style='font:16px system-ui;padding:32px;color:#233A59'><h1>Connection required</h1><p>Reconnect to the internet to securely open your Asher Healthcare records.</p></main>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "X-Asher-Portal-Release": PATIENT_PORTAL_RELEASE } },
      );
    }
    return new Response("A secure connection is required.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Asher-Portal-Release": PATIENT_PORTAL_RELEASE },
    });
  }));
});

