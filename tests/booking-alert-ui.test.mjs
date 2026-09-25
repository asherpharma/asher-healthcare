import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { publicKeyBytes, subscriptionDeviceId, usableSubscription } from "../src/lib/booking-alert-device.mjs";

test("device identity follows the current endpoint, not a remembered browser ID", async () => {
  const first = await subscriptionDeviceId({ endpoint: "https://fcm.googleapis.com/fcm/send/first" });
  const renewed = await subscriptionDeviceId({ endpoint: "https://fcm.googleapis.com/fcm/send/renewed" });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(renewed, first);
  assert.equal(await subscriptionDeviceId(null), "");
  assert.equal(await subscriptionDeviceId({ endpoint: "https://fcm.googleapis.com/fcm/send/first" }), first);
});

test("expired and old-key subscriptions cannot be reported as usable", () => {
  const key = Buffer.from([4, 1, 2, 3]).toString("base64url");
  const subscription = { options: { applicationServerKey: publicKeyBytes(key).buffer }, expirationTime: null };
  assert.equal(usableSubscription(subscription, key, 100), true);
  assert.equal(usableSubscription({ ...subscription, expirationTime: 100 }, key, 100), false);
  assert.equal(usableSubscription({ ...subscription, expirationTime: 101 }, key, 100), true);
  assert.equal(usableSubscription({ ...subscription, expirationTime: NaN }, key, 100), false);
  assert.equal(usableSubscription(subscription, "BAECAwQ", 100), false);
  assert.equal(usableSubscription(null, key, 100), false);
});

const worker = readFileSync(new URL("../public/staff-v2-sw.js", import.meta.url), "utf8");
function setup(windows = []) {
  const events = new Map();
  const notifications = [];
  const opened = [];
  const context = {
    URL,
    self: {
      location: { origin: "https://asherhealthcare.in" },
      addEventListener: (name, callback) => events.set(name, callback),
      registration: { async showNotification(title, options) { notifications.push({ title, options }); } },
      clients: {
        async matchAll() { return windows; },
        async openWindow(url) { opened.push(url); },
      },
    },
  };
  vm.runInNewContext(worker, context);
  async function push(payload) {
    let pending;
    events.get("push")({ data: { json: () => payload }, waitUntil(value) { pending = value; } });
    await pending;
  }
  return { events, notifications, opened, push };
}

test("push uses fixed private content and stable booking tag, ignoring supplied PHI/URL", async () => {
  const ui = setup();
  const payload = { type: "appointment-request", appointmentId: "a123", title: "Private name", body: "Private illness", url: "https://evil.example" };
  await ui.push(payload);
  await ui.push(payload);
  assert.equal(ui.notifications.length, 2);
  assert.equal(ui.notifications[0].options.tag, "asher-appointment-a123");
  assert.equal(ui.notifications[1].options.tag, ui.notifications[0].options.tag);
  assert.doesNotMatch(JSON.stringify(ui.notifications), /Private|evil|illness/);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.notifications[0].options.data)), { type: "appointment-request" });
});

test("unknown and malformed push messages do not display alerts", async () => {
  const ui = setup();
  await ui.push(null);
  await ui.push({ type: "marketing" });
  ui.events.get("push")({ data: { json() { throw new Error("invalid JSON"); } } });
  assert.equal(ui.notifications.length, 0);
});

test("notification click opens only the fixed same-origin secure appointment desk", async () => {
  const ui = setup();
  let pending;
  let closed = false;
  ui.events.get("notificationclick")({
    notification: { data: { type: "appointment-request", url: "https://evil.example" }, close() { closed = true; } },
    waitUntil(value) { pending = value; },
  });
  await pending;
  assert.equal(closed, true);
  assert.deepEqual(ui.opened, ["https://asherhealthcare.in/admin/appointments"]);
});

test("existing staff window is reused, not an unrelated same-site patient window", async () => {
  const navigated = [];
  let focused = 0;
  const ui = setup([
    { url: "https://asherhealthcare.in/portal", async navigate() { assert.fail("must not navigate patient workspace"); } },
    { url: "https://asherhealthcare.in/admin/settings", async navigate(url) { navigated.push(url); return { async focus() { focused += 1; } }; } },
  ]);
  let pending;
  ui.events.get("notificationclick")({ notification: { data: { type: "appointment-request" }, close() {} }, waitUntil(value) { pending = value; } });
  await pending;
  assert.deepEqual(navigated, ["https://asherhealthcare.in/admin/appointments"]);
  assert.equal(focused, 1);
  assert.equal(ui.opened.length, 0);
});

test("notification panel is admin-only, permission is opt-in, status is server-verified", () => {
  const panel = readFileSync(new URL("../src/components/admin/BookingAlertsPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /profile\.role === "admin"/);
  assert.match(panel, /data\.deviceActive/);
  assert.match(panel, /result\.registered !== true/);
  assert.match(panel, /async function enable\(\)[\s\S]+Notification\.requestPermission\(\)/);
  assert.match(panel, /timeoutMs = 15_000/);
  assert.match(panel, /signal: AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(panel, /This is not an end-to-end delivery test/);
  assert.match(panel, /Preview bookings never send alerts/);
  assert.match(panel, /Email alerts · Paused/);
});

test("Android-only panel exposes honest manual retry status without an email dependency", () => {
  const panel = readFileSync(new URL("../src/components/admin/BookingAlertsPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Email setup is paused/);
  assert.match(panel, /Android alerts do not require the email sending service/);
  assert.match(panel, /action: "retry", appointmentId/);
  assert.match(panel, /result\.retried !== true/);
  assert.match(panel, /There are no automatic retries in this version/);
  assert.match(panel, /does not prove your phone displayed it/);
  assert.match(panel, /Delivery checks are temporarily unavailable/);
  assert.match(panel, /These are not all-time totals/);
  assert.doesNotMatch(panel, /setup\??\.emailConfigured|setup\??\.emailRecipient/);
});

test("paused alerts retain the current subscription for opt-out when local storage is missing", () => {
  const panel = readFileSync(new URL("../src/components/admin/BookingAlertsPanel.tsx", import.meta.url), "utf8");
  const selection = panel.match(/setDeviceId\((data\.deviceActive \? id : [^;\n]+)\);/);
  assert.ok(selection, "refresh must retain a device reference separately from delivery-enabled state");
  const currentId = "a".repeat(64);
  const savedId = "b".repeat(64);
  for (const [data, saved, current, expected] of [
    [{ enabled: false, pushConfigured: false, deviceActive: false }, "", currentId, currentId],
    [{ enabled: true, pushConfigured: false, deviceActive: false }, "", currentId, currentId],
    [{ enabled: false, deviceActive: false }, savedId, currentId, savedId],
    [{ enabled: false, deviceActive: false }, savedId, "", savedId],
    [{ enabled: false, deviceActive: false }, "", "", ""],
    [{ enabled: true, deviceActive: true }, savedId, currentId, currentId],
  ]) {
    assert.equal(vm.runInNewContext(`(${selection[1]})`, {
      data, savedId: saved, currentId: current, id: current || saved,
    }), expected);
  }
  assert.match(panel, /deviceId && !enabled && <button[\s\S]+Remove saved device/);
  assert.match(panel, /if \(deviceId\) await api\(\{ action: "unsubscribe", deviceId \}\)/);
});

test("booking provenance is server-owned and booking success remains independent of alerts", () => {
  const booking = readFileSync(new URL("../functions/api/appointments/book.js", import.meta.url), "utf8");
  assert.match(booking, /requestOrigin: new URL\(context\.request\.url\)\.origin/);
  assert.doesNotMatch(booking, /body\.requestOrigin|resend|web-push|sendNotification/);
  assert.match(booking, /return json\(\{ appointmentId, slotId, status \}, 201\)/);
});
