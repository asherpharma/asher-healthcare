const STAFF_APP_RELEASE = "2026.09.24.1-booking-alerts";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Use fixed private text, never patient details or arbitrary URLs from payloads.
self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (payload?.type !== "appointment-request") return;
  const bookingId = /^[a-zA-Z0-9_-]{1,128}$/.test(payload.appointmentId || "") ? payload.appointmentId : "new";
  event.waitUntil(self.registration.showNotification("Asher Healthcare · new appointment", {
    body: "A new website appointment request is waiting. Sign in to the appointment desk to review it.",
    icon: "/icons/icon-192.png",
    tag: `asher-appointment-${bookingId}`,
    data: { type: "appointment-request" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  if (event.notification.data?.type !== "appointment-request") return;
  event.notification.close();
  const destination = new URL("/admin/appointments", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && (url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) {
        const navigated = await client.navigate(destination);
        if (navigated) return navigated.focus();
      }
    }
    return self.clients.openWindow(destination);
  })());
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
