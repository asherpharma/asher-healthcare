import assert from "node:assert/strict";
import test from "node:test";
import { createBookingHandler } from "../functions/api/appointments/book.js";
import { HttpError } from "../server/razorpay/http.js";

const NOW = new Date("2026-09-25T10:00:00.000Z");
const ORIGIN = "https://asherhealthcare.in";
const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const ENV = {
  FIREBASE_PROJECT_ID: "asher-healthcare-clinic",
  BOOKING_ALERTS_ENABLED: "true",
  BOOKING_ALERT_PUSH_CONFIGURED: "true",
  BOOKING_ALERTS_ACTIVATED_AT: "2026-09-25T09:00:00Z",
  BOOKING_ALERT_VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url"),
  BOOKING_ALERT_VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d,
};
const BODY = {
  patientName: "Booking Test",
  phone: "0000000000",
  doctorId: "pediatrics",
  preferredDate: "2026-09-26",
  preferredTime: "17:00",
  reason: "Private test reason",
  source: "website",
  privacyAccepted: true,
  formElapsedMs: 2000,
};

function setup({ env = ENV, origin = ORIGIN, body = BODY, commitError, deliverPush, waitUntil = "capture" } = {}) {
  const calls = [];
  const promises = [];
  const handler = createBookingHandler({
    now: () => NOW,
    async getDocument(_env, path) { calls.push(["get", path]); return null; },
    async requireActiveStaff() { calls.push(["auth"]); return { uid: "staff-test" }; },
    async commitWrites(_env, writes) {
      calls.push(["commit", writes]);
      if (commitError) throw commitError;
      calls.push(["committed"]);
    },
    deliverPush(...args) { calls.push(["deliver", ...args]); return deliverPush ? deliverPush(...args) : Promise.resolve({ status: "sent" }); },
  });
  const context = {
    env,
    request: new Request(`${origin}/api/appointments/book`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  };
  if (waitUntil !== "missing") context.waitUntil = (promise) => {
    calls.push(["waitUntil"]);
    promises.push(promise);
    if (waitUntil === "throw") throw new Error("Worker background scope unavailable");
  };
  return { calls, promises, run: () => handler(context) };
}

function outboxWrites(context) {
  return (context.calls.find(([name]) => name === "commit")?.[1] || []).filter((write) => write.update?.name.includes("/appointmentPushOutbox/"));
}

test("production website bookings save a PHI-free outbox atomically and schedule only after commit", async () => {
  for (const origin of [ORIGIN, "https://www.asherhealthcare.in"]) {
    const context = setup({ origin });
    const response = await context.run();
    assert.equal(response.status, 201);
    const { appointmentId } = await response.json();
    await Promise.all(context.promises);
    const commits = context.calls.filter(([name]) => name === "commit");
    assert.equal(commits.length, 1);
    const writes = commits[0][1];
    assert.equal(writes.some((write) => write.update.name.endsWith(`/appointments/${appointmentId}`)), true);
    assert.equal(writes.some((write) => write.update.name.includes("/appointmentSlots/")), true);
    const [outbox] = outboxWrites(context);
    assert.deepEqual(outbox.currentDocument, { exists: false });
    assert.deepEqual(outbox.update.fields, {
      appointmentId: { stringValue: appointmentId },
      requestOrigin: { stringValue: origin },
      createdAt: { timestampValue: NOW.toISOString() },
      status: { stringValue: "pending" },
    });
    assert.equal(JSON.stringify(outbox).includes(BODY.patientName), false);
    assert.equal(JSON.stringify(outbox).includes(BODY.phone), false);
    const events = context.calls.map(([name]) => name);
    assert.ok(events.indexOf("committed") < events.indexOf("waitUntil"));
    assert.ok(events.indexOf("waitUntil") < events.indexOf("deliver"));
    assert.equal(context.calls.find(([name]) => name === "deliver")[2], appointmentId);
  }
});

test("preview, QA, inactive, incomplete and future activation configurations never schedule pushes", async () => {
  const cases = [
    { origin: "https://preview.asher-healthcare.pages.dev" },
    { env: { ...ENV, FIREBASE_PROJECT_ID: "asher-healthcare-qa" } },
    { env: { ...ENV, BOOKING_ALERTS_ENABLED: "false" } },
    { env: { ...ENV, BOOKING_ALERT_PUSH_CONFIGURED: "false" } },
    { env: { ...ENV, BOOKING_ALERTS_ACTIVATED_AT: undefined } },
    { env: { ...ENV, BOOKING_ALERTS_ACTIVATED_AT: "2027-01-01T00:00:00Z" } },
    { env: { ...ENV, BOOKING_ALERT_VAPID_PRIVATE_KEY: undefined } },
    { env: { ...ENV, BOOKING_ALERT_VAPID_PUBLIC_KEY: "bad" } },
  ];
  for (const options of cases) {
    const context = setup(options);
    assert.equal((await context.run()).status, 201);
    assert.equal(outboxWrites(context).length, 0);
    assert.equal(context.calls.some(([name]) => ["deliver", "waitUntil"].includes(name)), false);
  }
});

test("staff-created bookings do not trigger website booking notifications", async () => {
  for (const source of ["reception", "phone", "walk-in"]) {
    const context = setup({ body: { ...BODY, source } });
    assert.equal((await context.run()).status, 201);
    assert.equal(outboxWrites(context).length, 0);
    assert.equal(context.calls.some(([name]) => name === "deliver"), false);
  }
});

test("caller supplied provenance cannot turn a preview booking into a live push", async () => {
  const context = setup({ origin: "https://preview.asher-healthcare.pages.dev", body: { ...BODY, requestOrigin: ORIGIN } });
  assert.equal((await context.run()).status, 201);
  assert.equal(outboxWrites(context).length, 0);
  const writes = context.calls.find(([name]) => name === "commit")[1];
  const appointment = writes.find((write) => write.update.name.includes("/appointments/"));
  assert.equal(appointment.update.fields.requestOrigin.stringValue, "https://preview.asher-healthcare.pages.dev");
});

test("failed atomic booking commits never invoke background delivery", async () => {
  const context = setup({ commitError: new HttpError(409, "Already booked") });
  assert.equal((await context.run()).status, 409);
  assert.equal(context.calls.some(([name]) => ["deliver", "waitUntil"].includes(name)), false);
});

test("background delivery rejection and synchronous errors do not fail successful bookings", async () => {
  for (const deliverPush of [
    async () => { throw new Error("Delivery unavailable"); },
    () => { throw new Error("Delivery unavailable"); },
  ]) {
    const context = setup({ deliverPush });
    assert.equal((await context.run()).status, 201);
    await assert.doesNotReject(Promise.all(context.promises));
    assert.equal(outboxWrites(context).length, 1);
  }
});

test("absent or rejecting waitUntil preserves the outbox without sending inline", async () => {
  for (const waitUntil of ["missing", "throw"]) {
    const context = setup({ waitUntil });
    assert.equal((await context.run()).status, 201);
    await Promise.all(context.promises);
    assert.equal(outboxWrites(context).length, 1);
    assert.equal(context.calls.some(([name]) => name === "deliver"), false);
  }
});

test("booking response resolves while push delivery remains pending", async () => {
  let finish;
  let settled = false;
  const delivery = new Promise((resolve) => { finish = resolve; }).then(() => { settled = true; });
  const context = setup({ deliverPush: () => delivery });
  const response = await context.run();
  assert.equal(response.status, 201);
  assert.equal(settled, false);
  assert.equal(context.promises.length, 1);
  finish();
  await Promise.all(context.promises);
  assert.equal(settled, true);
});

test("rejected appointment validation never creates outbox records", async () => {
  const context = setup({ body: { ...BODY, privacyAccepted: false } });
  assert.equal((await context.run()).status, 400);
  assert.equal(context.calls.some(([name]) => ["commit", "deliver", "waitUntil"].includes(name)), false);
});
