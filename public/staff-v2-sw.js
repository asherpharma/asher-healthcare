const STAFF_APP_RELEASE = "2026.08.02.3-recovery";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/admin")) return;

  // Staff pages contain medical and financial data. Always use the network and
  // never place authenticated responses in Cache Storage.
  event.respondWith(
    fetch(request, { cache: "no-store" }).catch(() => {
      const acceptsHtml = request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
      if (acceptsHtml) {
        return new Response(
          "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>Asher Staff is offline</title><main style='font:16px system-ui;padding:32px;color:#233A59'><h1>Connection required</h1><p>Reconnect to the internet to securely open clinic records.</p></main>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "X-Asher-Staff-Release": STAFF_APP_RELEASE } },
        );
      }
      return new Response("Asher Staff is offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "X-Asher-Staff-Release": STAFF_APP_RELEASE },
      });
    }),
  );
});
