import assert from "node:assert/strict";
import test from "node:test";
import { createBookingAlertHandlers } from "../functions/api/admin/booking-alerts.js";
import {
  BOOKING_ALERT_PRODUCTION_ORIGIN,
  bookingAlertConfiguration,
  bookingAlertDeviceId,
  bookingPushReadiness,
  createBookingAlertService,
  validatePushSubscription,
} from "../server/notifications/booking-alerts.js";
import { HttpError } from "../server/razorpay/http.js";

const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keyPair.publicKey)).toString("base64url");
const privateKey = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)).d;
const authKey = Buffer.alloc(16, 7).toString("base64url");
const NOW = new Date("2026-09-24T10:00:00.000Z");
const UPDATE_TIME = "2026-09-24T09:00:00.000Z";
const ADMIN = { uid: "admin-1", role: "admin", staffUpdateTime: UPDATE_TIME };
const ENV = {
  FIREBASE_PROJECT_ID: "asher-healthcare-clinic",
  BOOKING_ALERTS_ENABLED: "true",
  BOOKING_ALERT_EMAIL_CONFIGURED: "true",
  BOOKING_ALERT_PUSH_CONFIGURED: "true",
  BOOKING_ALERT_VAPID_PUBLIC_KEY: publicKey,
  BOOKING_ALERT_VAPID_PRIVATE_KEY: privateKey,
  BOOKING_ALERTS_ACTIVATED_AT: "2026-09-24T09:00:00Z",
};
const SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/valid-device-token-0123456789:subscription",
  expirationTime: null,
  keys: { p256dh: publicKey, auth: authKey },
};
const DEVICE_ID = await bookingAlertDeviceId(SUBSCRIPTION.endpoint);

function request({ origin = BOOKING_ALERT_PRODUCTION_ORIGIN, urlOrigin = BOOKING_ALERT_PRODUCTION_ORIGIN, body, query = "" } = {}) {
  return new Request(`${urlOrigin}/api/admin/booking-alerts${query}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(origin === null ? {} : { Origin: origin }), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

function existingDevice(overrides = {}) {
  return {
    data: { uid: ADMIN.uid, active: true, origin: BOOKING_ALERT_PRODUCTION_ORIGIN, subscription: SUBSCRIPTION, ...overrides },
    updateTime: UPDATE_TIME,
  };
}

function setup({ document = null, actor = ADMIN, authError, commitError, env = ENV, listRows = [], listError, deliveryError, deliveryResult = { status: "sent", sent: 1, pending: 0, skipped: 0, failed: 0 } } = {}) {
  const calls = [];
  const service = createBookingAlertService({
    async getDocument(_env, path) { calls.push(["get", path]); return document; },
    async commitWrites(_env, writes) { calls.push(["commit", writes]); if (commitError) throw commitError; },
    async listRecentOutbox() { calls.push(["list"]); if (listError) throw listError; return listRows; },
    async deliverPush(_env, appointmentId) { calls.push(["deliver", appointmentId]); if (deliveryError) throw deliveryError; return deliveryResult; },
    now: () => NOW,
  });
  const handlers = createBookingAlertHandlers({
    service,
    async requireAdminStaff() { calls.push(["auth"]); if (authError) throw authError; return actor; },
  });
  return {
    calls,
    service,
    async get(options = {}) { return handlers.get({ request: request(options), env }); },
    async post(body = { action: "subscribe", subscription: SUBSCRIPTION }, options = {}) {
      return handlers.post({ request: request({ ...options, body }), env });
    },
  };
}

test("configuration is production-only and returns only explicitly configured capabilities", () => {
  assert.deepEqual(bookingAlertConfiguration(request(), ENV, NOW.getTime()), {
    emailRecipient: "asherhealthcare100@gmail.com",
    emailConfigured: false,
    emailPaused: true,
    pushDeliveryMethod: "cloudflare",
    pushConfigured: true,
    enabled: true,
    vapidPublicKey: publicKey,
    productionOrigin: BOOKING_ALERT_PRODUCTION_ORIGIN,
  });
  for (const env of [
    { ...ENV, BOOKING_ALERTS_ENABLED: undefined },
    { ...ENV, BOOKING_ALERTS_ENABLED: "TRUE" },
    { ...ENV, FIREBASE_PROJECT_ID: "asher-healthcare-qa" },
  ]) {
    const config = bookingAlertConfiguration(request(), env);
    assert.equal(config.enabled, false);
    assert.equal(config.emailConfigured, false);
    assert.equal(config.pushConfigured, false);
    assert.equal(config.vapidPublicKey, "");
  }
  assert.equal(bookingAlertConfiguration(request(), { ...ENV, BOOKING_ALERT_PUSH_CONFIGURED: "false" }).pushConfigured, false);
  assert.equal(bookingAlertConfiguration(request(), { ...ENV, BOOKING_ALERT_VAPID_PUBLIC_KEY: "invalid" }).pushConfigured, false);
  assert.equal(bookingAlertConfiguration(request(), { ...ENV, BOOKING_ALERT_EMAIL_CONFIGURED: "false" }).emailConfigured, false);
});

test("preview GET stays disabled even when production environment flags were copied", async () => {
  const context = setup({ document: existingDevice() });
  const response = await context.get({ origin: "https://preview.asher-healthcare.pages.dev", urlOrigin: "https://preview.asher-healthcare.pages.dev", query: `?deviceId=${DEVICE_ID}` });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.enabled, false);
  assert.equal(result.deviceActive, false);
  assert.equal(result.vapidPublicKey, "");
  assert.deepEqual(context.calls, [["auth"]]);
});

test("GET and POST require authenticated admin; expired sessions and non-admin roles cannot access devices", async () => {
  for (const method of ["get", "post"]) {
    for (const [status, message] of [[401, "Expired session"], [403, "Inactive staff"]]) {
      const context = setup({ authError: new HttpError(status, message) });
      const response = await context[method]();
      assert.equal(response.status, status);
      assert.deepEqual(context.calls, [["auth"]]);
    }
    for (const role of ["reception", "doctor", undefined]) {
      const context = setup({ actor: { ...ADMIN, role } });
      assert.equal((await context[method]()).status, 403);
      assert.equal(context.calls.some(([name]) => name === "get" || name === "commit"), false);
    }
  }
});

test("cross-origin calls stop before authentication and mutations require explicit live Origin", async () => {
  for (const method of ["get", "post"]) {
    const context = setup();
    const options = { origin: "https://attacker.example" };
    const response = method === "get" ? await context.get(options) : await context.post(undefined, options);
    assert.equal(response.status, 403);
    assert.deepEqual(context.calls, []);
  }
  for (const options of [
    { origin: null },
    { origin: "https://preview.asher-healthcare.pages.dev", urlOrigin: "https://preview.asher-healthcare.pages.dev" },
  ]) {
    const context = setup();
    assert.equal((await context.post(undefined, options)).status, 403);
    assert.equal(context.calls.some(([name]) => name === "commit"), false);
  }
});

test("configuration is readable without Origin on same-site authenticated GET", async () => {
  const result = await (await setup().get({ origin: null })).json();
  assert.equal(result.enabled, true);
  assert.equal(result.deviceActive, false);
});

test("POST rejects malformed/oversized JSON, unsupported fields and fabricated destinations", async () => {
  for (const body of [
    "{invalid", " ", "x".repeat(6001), null, [], {},
    { action: "send-email", email: "attacker@example.com" },
    { action: "subscribe", subscription: SUBSCRIPTION, uid: "other-admin" },
    { action: "subscribe", subscription: SUBSCRIPTION, email: "attacker@example.com" },
    { action: "subscribe", subscription: SUBSCRIPTION, destination: "http://localhost" },
    { action: "subscribe", subscription: SUBSCRIPTION, deviceId: DEVICE_ID },
    { action: "unsubscribe", subscription: SUBSCRIPTION, deviceId: DEVICE_ID },
  ]) {
    const context = setup();
    const response = await context.post(body);
    assert.equal(response.status, 400, JSON.stringify(body)?.slice(0, 60));
    assert.equal(context.calls.some(([name]) => name === "get" || name === "commit"), false);
  }
});

test("subscription endpoint restricts services, scheme, URL features and token path", async () => {
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/valid-device-token-0123456789",
    "https://attacker.example/fcm/send/valid-device-token-0123456789",
    "https://fcm.googleapis.com.attacker.example/fcm/send/valid-device-token-0123456789",
    "https://user:pass@fcm.googleapis.com/fcm/send/valid-device-token-0123456789",
    "https://fcm.googleapis.com:444/fcm/send/valid-device-token-0123456789",
    "https://fcm.googleapis.com:443/fcm/send/valid-device-token-0123456789",
    `${SUBSCRIPTION.endpoint}?secret=1`, `${SUBSCRIPTION.endpoint}#secret`,
    "https://fcm.googleapis.com/arbitrary/path-0123456789",
    "https://fcm.googleapis.com/fcm/send/short",
    "https://fcm.googleapis.com/fcm/send/../anything",
    "https://fcm.googleapis.com/fcm/send/%20bad-device-token-0123456789",
    "https://127.0.0.1/fcm/send/valid-device-token-0123456789", "not a URL",
    "https://constructor/fcm/send/valid-device-token-0123456789",
  ]) {
    await assert.rejects(validatePushSubscription({ ...SUBSCRIPTION, endpoint }, NOW), { status: 400 });
  }
  for (const endpoint of [
    SUBSCRIPTION.endpoint,
    "https://updates.push.services.mozilla.com/wpush/v2/valid-device-token-0123456789",
    "https://web.push.apple.com/Qvalid-device-token-0123456789",
  ]) {
    assert.equal((await validatePushSubscription({ ...SUBSCRIPTION, endpoint }, NOW)).endpoint, endpoint);
  }
});

test("subscription requires valid canonical base64url keys, valid curve point and future expiry", async () => {
  for (const subscription of [
    null, [], {}, { ...SUBSCRIPTION, keys: null },
    { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, extra: "unsupported" } },
    { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, auth: `${authKey}==` } },
    { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, auth: Buffer.alloc(15).toString("base64url") } },
    { ...SUBSCRIPTION, keys: { ...SUBSCRIPTION.keys, p256dh: Buffer.alloc(65, 4).toString("base64url") } },
    { ...SUBSCRIPTION, expirationTime: NOW.getTime() - 1 },
    { ...SUBSCRIPTION, expirationTime: NOW.getTime() },
    { ...SUBSCRIPTION, expirationTime: "never" },
    { ...SUBSCRIPTION, expirationTime: Number.POSITIVE_INFINITY },
  ]) {
    await assert.rejects(validatePushSubscription(subscription, NOW), { status: 400 });
  }
  assert.equal((await validatePushSubscription({ ...SUBSCRIPTION, expirationTime: NOW.getTime() + 60000 }, NOW)).expirationTime, NOW.getTime() + 60000);
});

test("subscribe creates only an admin-owned hashed device and atomically guards active staff revision", async () => {
  const context = setup();
  const response = await context.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { registered: true, deviceId: DEVICE_ID });
  const writes = context.calls.find(([name]) => name === "commit")[1];
  assert.equal(writes.length, 2);
  assert.equal(writes[0].verify, `projects/asher-healthcare-clinic/databases/(default)/documents/staff/${ADMIN.uid}`);
  assert.equal(writes[0].currentDocument.updateTime, UPDATE_TIME);
  assert.equal(writes[1].update.name.endsWith(`/adminPushDevices/${DEVICE_ID}`), true);
  assert.deepEqual(writes[1].currentDocument, { exists: false });
  assert.equal(writes[1].update.fields.uid.stringValue, ADMIN.uid);
  assert.equal(writes[1].update.fields.active.booleanValue, true);
  assert.equal(writes[1].update.fields.origin.stringValue, BOOKING_ALERT_PRODUCTION_ORIGIN);
  assert.equal(writes[1].update.fields.createdAt.timestampValue, NOW.toISOString());
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("GET reports server-owned active state without leaking subscriptions or other owners", async () => {
  for (const [document, expected] of [
    [existingDevice(), true], [null, false],
    [existingDevice({ uid: "admin-2" }), false],
    [existingDevice({ active: false }), false],
    [existingDevice({ origin: "https://preview.example" }), false],
    [existingDevice({ subscription: { ...SUBSCRIPTION, expirationTime: NOW.getTime() - 1 } }), false],
  ]) {
    const response = await setup({ document }).get({ query: `?deviceId=${DEVICE_ID}` });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.deviceActive, expected);
    assert.equal(result.deviceId, DEVICE_ID);
    assert.equal("subscription" in result, false);
    assert.equal("uid" in result, false);
    assert.equal(JSON.stringify(result).includes(SUBSCRIPTION.endpoint), false);
  }
});

test("invalid or duplicate device references never reach database", async () => {
  for (const query of ["?deviceId=", "?deviceId=../../staff/admin", `?deviceId=${DEVICE_ID}&deviceId=${DEVICE_ID}`]) {
    const context = setup();
    assert.equal((await context.get({ query })).status, 400);
    assert.equal(context.calls.some(([name]) => name === "get"), false);
  }
});

test("both active and inactive devices remain owned by original admin", async () => {
  for (const active of [true, false]) {
    for (const body of [{ action: "subscribe", subscription: SUBSCRIPTION }, { action: "unsubscribe", deviceId: DEVICE_ID }]) {
      const context = setup({ document: existingDevice({ uid: "other-admin", active }) });
      assert.equal((await context.post(body)).status, 403);
      assert.equal(context.calls.some(([name]) => name === "commit"), false);
    }
  }
});

test("resubscribe preserves creation date and uses last device revision precondition", async () => {
  const context = setup({ document: existingDevice({ active: false }) });
  assert.equal((await context.post()).status, 200);
  const deviceWrite = context.calls.find(([name]) => name === "commit")[1][1];
  assert.deepEqual(deviceWrite.currentDocument, { updateTime: UPDATE_TIME });
  assert.equal(deviceWrite.updateMask.fieldPaths.includes("createdAt"), false);
  assert.equal(deviceWrite.update.fields.active.booleanValue, true);
});

test("unsubscribe by device ID works without browser subscription and when push setup is disabled", async () => {
  const context = setup({ document: existingDevice(), env: { ...ENV, BOOKING_ALERT_PUSH_CONFIGURED: "false" } });
  const response = await context.post({ action: "unsubscribe", deviceId: DEVICE_ID });
  assert.deepEqual(await response.json(), { registered: false, deviceId: DEVICE_ID });
  const deviceWrite = context.calls.find(([name]) => name === "commit")[1][1];
  assert.equal(deviceWrite.update.fields.active.booleanValue, false);
  assert.deepEqual(deviceWrite.updateMask.fieldPaths, ["active", "updatedAt"]);
  assert.deepEqual(deviceWrite.currentDocument, { updateTime: UPDATE_TIME });
});

test("unsubscribe absent device is idempotent and never creates a record", async () => {
  const context = setup();
  assert.deepEqual(await (await context.post({ action: "unsubscribe", deviceId: DEVICE_ID })).json(), { registered: false, deviceId: DEVICE_ID });
  assert.equal(context.calls.some(([name]) => name === "commit"), false);
});

test("unsubscribe remains available when global alerts are disabled, while subscribe stays blocked", async () => {
  for (const BOOKING_ALERTS_ENABLED of ["false", undefined]) {
    const context = setup({ document: existingDevice(), env: { ...ENV, BOOKING_ALERTS_ENABLED } });
    assert.equal((await context.post()).status, 403);
    assert.equal(context.calls.some(([name]) => name === "commit"), false);
    assert.equal((await context.post({ action: "unsubscribe", deviceId: DEVICE_ID })).status, 200);
    const write = context.calls.find(([name]) => name === "commit")[1][1];
    assert.equal(write.update.fields.active.booleanValue, false);
  }
  const wrongProject = setup({ document: existingDevice(), env: { ...ENV, BOOKING_ALERTS_ENABLED: "false", FIREBASE_PROJECT_ID: "asher-healthcare-qa" } });
  assert.equal((await wrongProject.post({ action: "unsubscribe", deviceId: DEVICE_ID })).status, 403);
  assert.equal(wrongProject.calls.some(([name]) => name === "commit"), false);
});

test("expired browser subscription can still be disabled using its device ID", async () => {
  const context = setup({ document: existingDevice({ subscription: { ...SUBSCRIPTION, expirationTime: NOW.getTime() - 1 } }) });
  assert.equal((await context.post({ action: "unsubscribe", deviceId: DEVICE_ID })).status, 200);
});

test("concurrent device/staff changes fail closed and do not retry a stale commit", async () => {
  const context = setup({ document: existingDevice(), commitError: new HttpError(409, "The staff or device record changed.") });
  const response = await context.post();
  assert.equal(response.status, 409);
  assert.equal(context.calls.filter(([name]) => name === "commit").length, 1);
});

test("missing staff update time prevents mutation without a transactional role guard", async () => {
  const context = setup({ actor: { ...ADMIN, staffUpdateTime: undefined } });
  assert.equal((await context.post()).status, 500);
  assert.equal(context.calls.some(([name]) => name === "commit"), false);
});

test("unexpected exceptions never expose push secrets in responses or logs", async () => {
  const context = setup({ commitError: new Error(`Failure containing ${SUBSCRIPTION.endpoint} ${authKey}`) });
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const response = await context.post();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Appointment notification settings are temporarily unavailable." });
    assert.deepEqual(logs, []);
  } finally {
    console.error = originalError;
  }
});

test("push readiness requires exact enabled flags, valid keys and an explicit past UTC activation", () => {
  assert.equal(bookingPushReadiness(ENV, NOW.getTime()), true);
  for (const value of [undefined, "", "2026-09-24", "2026-09-24T09:00:00+00:00", "2026-02-30T00:00:00Z", "2027-01-01T00:00:00Z"]) {
    assert.equal(bookingPushReadiness({ ...ENV, BOOKING_ALERTS_ACTIVATED_AT: value }, NOW.getTime()), false);
  }
  for (const overrides of [
    { BOOKING_ALERT_VAPID_PRIVATE_KEY: undefined },
    { BOOKING_ALERT_VAPID_PRIVATE_KEY: "invalid" },
    { BOOKING_ALERT_VAPID_PUBLIC_KEY: "invalid" },
    { BOOKING_ALERTS_ENABLED: "TRUE" },
    { BOOKING_ALERT_PUSH_CONFIGURED: undefined },
    { FIREBASE_PROJECT_ID: "asher-healthcare-qa" },
  ]) assert.equal(bookingPushReadiness({ ...ENV, ...overrides }, NOW.getTime()), false);
});

test("email remains paused even if legacy email configuration is present", async () => {
  const result = await (await setup().get()).json();
  assert.equal(result.emailPaused, true);
  assert.equal(result.emailConfigured, false);
  assert.equal(result.pushDeliveryMethod, "cloudflare");
  assert.equal(JSON.stringify(result).includes(privateKey), false);
});

test("GET exposes only sanitized incomplete attempts from the newest 20 outbox records", async () => {
  const listRows = [
    { id: "pending-1", status: "pending", createdAt: UPDATE_TIME, patientName: "PRIVATE" },
    { id: "processing-1", status: "processing", createdAt: UPDATE_TIME, endpoint: SUBSCRIPTION.endpoint },
    { id: "failed-1", status: "needs_attention", createdAt: "invalid date" },
    { id: "complete-1", status: "sent", createdAt: UPDATE_TIME },
    { id: "../bad", status: "pending" },
    ...Array.from({ length: 20 }, (_, index) => ({ id: `complete-${index + 2}`, status: "skipped" })),
  ];
  const result = await (await setup({ listRows }).get()).json();
  assert.deepEqual(result.deliverySummary, {
    available: true, limit: 20, checked: 20, pending: 2, failed: 1,
    items: [
      { appointmentId: "pending-1", status: "pending", createdAt: UPDATE_TIME },
      { appointmentId: "processing-1", status: "processing", createdAt: UPDATE_TIME },
      { appointmentId: "failed-1", status: "needs_attention", createdAt: null },
    ],
  });
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(result).includes(SUBSCRIPTION.endpoint), false);
});

test("delivery status query failures stay unavailable without hiding valid device setup", async () => {
  const result = await (await setup({ listError: new Error("Network unavailable"), document: existingDevice() }).get({ query: `?deviceId=${DEVICE_ID}` })).json();
  assert.equal(result.deviceActive, true);
  assert.equal(result.pushConfigured, true);
  assert.deepEqual(result.deliverySummary, { available: false, limit: 20, checked: 0, pending: 0, failed: 0, items: [] });
});

test("device state is read concurrently with the bounded recent-attempt query", async () => {
  let releaseList;
  let deviceRead = false;
  const waitingList = new Promise((resolve) => { releaseList = resolve; });
  const service = createBookingAlertService({
    now: () => NOW,
    listRecentOutbox: () => waitingList,
    async getDocument() { deviceRead = true; return existingDevice(); },
  });
  const pending = service.get(request({ query: `?deviceId=${DEVICE_ID}` }), ENV, ADMIN);
  assert.equal(deviceRead, true);
  releaseList([]);
  const result = await pending;
  assert.equal(result.deviceActive, true);
  assert.equal(result.deliverySummary.available, true);
});

test("admin retry uses only a bounded appointment ID and whitelists generic delivery results", async () => {
  const context = setup({ deliveryResult: { status: "sent", sent: 2, pending: -1, skipped: 0, failed: NaN, subscription: SUBSCRIPTION, patientName: "PRIVATE" } });
  const response = await context.post({ action: "retry", appointmentId: "booking-test-1" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { retried: true, appointmentId: "booking-test-1", delivery: { status: "sent", sent: 2, pending: 0, skipped: 0, failed: 0 } });
  assert.deepEqual(context.calls, [["auth"], ["deliver", "booking-test-1"]]);
});

test("an already-processing retry is returned as processing, never claimed as accepted", async () => {
  const context = setup({ deliveryResult: { status: "processing", sent: 0, pending: 2, skipped: 1, failed: 0 } });
  const result = await (await context.post({ action: "retry", appointmentId: "booking-test-1" })).json();
  assert.deepEqual(result.delivery, { status: "processing", sent: 0, pending: 2, skipped: 1, failed: 0 });
});

test("retry rejects arbitrary paths, destinations and extra subscription or identity fields", async () => {
  for (const body of [
    { action: "retry" }, { action: "retry", appointmentId: "../staff/admin" },
    { action: "retry", appointmentId: "x".repeat(129) },
    { action: "retry", appointmentId: "booking-test-1", uid: "other" },
    { action: "retry", appointmentId: "booking-test-1", deviceId: DEVICE_ID },
    { action: "retry", appointmentId: "booking-test-1", subscription: SUBSCRIPTION },
    { action: "subscribe", subscription: SUBSCRIPTION, appointmentId: "booking-test-1" },
  ]) {
    const context = setup();
    assert.equal((await context.post(body)).status, 400);
    assert.equal(context.calls.some(([name]) => name === "deliver" || name === "commit"), false);
  }
});

test("retry and subscription require active production configuration but opting out remains available", async () => {
  for (const overrides of [
    { BOOKING_ALERTS_ENABLED: "false" },
    { BOOKING_ALERTS_ACTIVATED_AT: undefined },
    { BOOKING_ALERTS_ACTIVATED_AT: "2027-01-01T00:00:00Z" },
    { BOOKING_ALERT_VAPID_PRIVATE_KEY: undefined },
  ]) {
    const context = setup({ env: { ...ENV, ...overrides }, document: existingDevice() });
    assert.ok([403, 503].includes((await context.post({ action: "retry", appointmentId: "booking-test-1" })).status));
    assert.ok([403, 503].includes((await context.post()).status));
    assert.equal(context.calls.some(([name]) => name === "deliver" || name === "commit"), false);
    assert.equal((await context.post({ action: "unsubscribe", deviceId: DEVICE_ID })).status, 200);
  }
  for (const options of [
    { origin: null },
    { origin: "https://preview.asher-healthcare.pages.dev", urlOrigin: "https://preview.asher-healthcare.pages.dev" },
  ]) {
    const context = setup();
    assert.equal((await context.post({ action: "retry", appointmentId: "booking-test-1" }, options)).status, 403);
    assert.equal(context.calls.some(([name]) => name === "deliver"), false);
  }
  for (const role of ["doctor", "reception"]) {
    const context = setup({ actor: { ...ADMIN, role } });
    assert.equal((await context.post({ action: "retry", appointmentId: "booking-test-1" })).status, 403);
    assert.equal(context.calls.some(([name]) => name === "deliver"), false);
  }
});

test("retry exceptions do not return subscription keys or internal provider details", async () => {
  const context = setup({ deliveryError: new Error(`Private: ${SUBSCRIPTION.endpoint} ${privateKey}`) });
  const response = await context.post({ action: "retry", appointmentId: "booking-test-1" });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Appointment notification settings are temporarily unavailable." });
});
