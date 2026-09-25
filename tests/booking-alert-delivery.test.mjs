import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import {
  ALERT_RECIPIENT, PRODUCTION_ORIGIN, PRODUCTION_PROJECT, RETRY_WINDOW_MS, LEASE_MS,
  claimTransition, eligibility, emailMessage, fingerprint, processAppointmentAlert,
  pushMessage, validSubscription,
} from "../notification-functions/delivery.mjs";

const instant = Date.parse("2026-09-24T10:00:00Z");
const curve = createECDH("prime256v1");
curve.generateKeys();
const subscription = {
  endpoint: `https://fcm.googleapis.com/fcm/send/${"a".repeat(50)}`,
  keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") },
};
const event = {
  id: "fixture-appointment", projectId: PRODUCTION_PROJECT, createdAtMs: instant,
  appointment: {
    source: "website", createdBy: "public-website", status: "requested", requestOrigin: PRODUCTION_ORIGIN,
    patientName: "QA SECRET NAME", phone: "9999999999", reason: "QA SECRET REASON",
  },
};
const config = {
  enabled: true, activatedAt: "2026-09-24T09:00:00Z", origin: PRODUCTION_ORIGIN,
  recipient: ALERT_RECIPIENT, sender: "notifications@asherhealthcare.in",
  resendApiKey: "fake-not-a-secret", vapidPublicKey: "fake-public", vapidPrivateKey: "fake-private",
};

function harness(count = 1) {
  let clock = instant;
  let serial = 0;
  const alerts = new Map();
  const channels = new Map();
  const devices = new Map(Array.from({ length: count }, (_, index) => [String(index), {
    uid: "qa-admin", active: true, origin: PRODUCTION_ORIGIN, subscription: structuredClone(subscription),
  }]));
  const staff = new Map([["qa-admin", { active: true, role: "admin" }]]);
  const mails = [];
  const pushes = [];
  const store = {
    async getAlert(id) { return alerts.get(id); },
    async listDevices(limit) { return [...devices.entries()].filter(([, device]) => device.active).slice(0, limit).map(([id]) => ({ id })); },
    async initializeAlert(id, initial) { if (!alerts.has(id)) alerts.set(id, initial); return alerts.get(id); },
    async expireAlert(id, values) { const result = { ...alerts.get(id), ...values, status: "needs_attention", code: "retry_window_closed" }; alerts.set(id, result); return result; },
    async getDevice(id) { return devices.get(id); },
    async getStaff(uid) { return staff.get(uid); },
    async claim(id, key, options) {
      const keyId = `${id}/${key}`;
      const transition = claimTransition(channels.get(keyId), options);
      channels.set(keyId, transition.record);
      return transition;
    },
    async finish(id, key, token, update) {
      const keyId = `${id}/${key}`;
      const current = channels.get(keyId);
      if (current?.leaseToken !== token) return current;
      const next = { ...current, ...update };
      channels.set(keyId, next);
      return next;
    },
    async disableDeviceIfUnchanged(id, hash) {
      const current = devices.get(id);
      if (current && fingerprint(current.subscription) === hash) current.active = false;
    },
    async summarizeAlert(id, summary) {
      if (["complete", "needs_attention"].includes(alerts.get(id)?.status)) return;
      alerts.set(id, { ...alerts.get(id), ...summary });
    },
  };
  const dependencies = {
    store, now: () => clock, token: () => `lease-${serial++}`,
    async sendEmail(message, options) { mails.push({ message, options }); },
    async sendPush(target, message, options) { pushes.push({ target, message, options }); },
  };
  return { store, alerts, channels, devices, staff, dependencies, mails, pushes,
    advance: (ms) => { clock += ms; }, run: (overrides = {}) => processAppointmentAlert(event, { ...config, ...overrides }, dependencies) };
}

test("eligible fresh production request sends independently to fixed email and active admin", async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.status, "complete");
  assert.equal(h.mails.length, 1);
  assert.deepEqual(h.mails[0].message.to, [ALERT_RECIPIENT]);
  assert.equal(h.pushes.length, 1);
  assert.deepEqual(h.pushes[0].message, { type: "appointment-request", appointmentId: event.id });
});

test("explicit email pause sends only push without email configuration or Resend calls", async () => {
  const h = harness();
  const result = await h.run({ emailEnabled: false, recipient: undefined, sender: undefined, resendApiKey: undefined });
  assert.equal(result.status, "complete");
  assert.equal(result.emailStatus, "skipped");
  assert.equal(h.mails.length, 0);
  assert.equal(h.pushes.length, 1);
  assert.equal(h.channels.has(`${event.id}/email`), false);
});

test("production www booking alias is eligible but links remain canonical", async () => {
  const h = harness();
  const candidate = { ...event, appointment: { ...event.appointment, requestOrigin: "https://www.asherhealthcare.in" } };
  assert.equal((await processAppointmentAlert(candidate, config, h.dependencies)).status, "complete");
  assert.equal(h.mails.length, 1);
  assert.ok(h.mails[0].message.text.includes(`${PRODUCTION_ORIGIN}/admin/appointments`));
});

test("Resend concurrent idempotent request conflicts retry the same key", async () => {
  const h = harness();
  h.dependencies.sendEmail = async (message, options) => {
    h.mails.push({ message, options });
    if (h.mails.length === 1) throw Object.assign(new Error("concurrent request"), { status: 409 });
  };
  assert.equal((await h.run()).status, "processing");
  h.advance(60_001);
  assert.equal((await h.run()).status, "complete");
  assert.equal(h.mails[0].options.idempotencyKey, h.mails[1].options.idempotencyKey);
});

test("configuration and event gates fail closed, including QA, preview, and pre-activation events", async () => {
  const cases = [
    [{ ...event, projectId: "asher-healthcare-qa" }, config],
    [event, { ...config, enabled: false }],
    [event, { ...config, origin: "https://preview.pages.dev" }],
    [event, { ...config, recipient: "someone@example.com" }],
    [event, { ...config, activatedAt: "" }],
    [event, { ...config, activatedAt: "2026-09-25T00:00:00Z" }],
    [{ ...event, createdAtMs: instant - 2 * 60 * 60 * 1000 }, config],
    [{ ...event, appointment: { ...event.appointment, requestOrigin: "https://preview.pages.dev" } }, config],
    [{ ...event, appointment: { ...event.appointment, requestOrigin: undefined } }, config],
    ...["source", "createdBy", "status"].map((field) => [{ ...event, appointment: { ...event.appointment, [field]: "invalid" } }, config]),
  ];
  for (const [candidate, settings] of cases) {
    const h = harness();
    assert.ok(eligibility(candidate, settings, instant));
    assert.equal((await processAppointmentAlert(candidate, settings, h.dependencies)).status, "ignored");
    assert.equal(h.mails.length + h.pushes.length + h.alerts.size, 0);
  }
});

test("sequential and concurrent duplicate events do not re-send completed channels", async () => {
  const h = harness();
  await Promise.all([h.run(), h.run(), h.run()]);
  await h.run();
  assert.equal(h.mails.length, 1);
  assert.equal(h.pushes.length, 1);
});

test("email retry preserves idempotency key and does not repeat successful push", async () => {
  const h = harness();
  h.dependencies.sendEmail = async (message, options) => {
    h.mails.push({ message, options });
    if (h.mails.length === 1) throw Object.assign(new Error("transient"), { status: 503 });
  };
  assert.equal((await h.run()).status, "processing");
  await h.run();
  assert.equal(h.mails.length, 1, "backoff suppresses immediate retry");
  h.advance(60_001);
  assert.equal((await h.run()).status, "complete");
  assert.equal(h.mails.length, 2);
  assert.equal(h.mails[0].options.idempotencyKey, h.mails[1].options.idempotencyKey);
  assert.equal(h.pushes.length, 1);
});

test("accepted email followed by storage failure retries same provider key within lease window", async () => {
  const h = harness();
  const finish = h.store.finish;
  let reject = true;
  h.store.finish = async (...args) => {
    if (args[1] === "email" && reject) { reject = false; throw new Error("storage unavailable"); }
    return finish(...args);
  };
  assert.equal((await h.run()).status, "processing");
  h.advance(LEASE_MS + 1);
  assert.equal((await h.run()).status, "complete");
  assert.equal(new Set(h.mails.map((mail) => mail.options.idempotencyKey)).size, 1);
  assert.equal(h.pushes.length, 1);
});

test("push failure leaves successful email complete and current admin role is checked on retry", async () => {
  const h = harness();
  h.dependencies.sendPush = async () => { throw Object.assign(new Error("temporary"), { statusCode: 503 }); };
  assert.equal((await h.run()).status, "processing");
  h.staff.set("qa-admin", { active: true, role: "reception" });
  h.advance(60_001);
  assert.equal((await h.run()).status, "complete");
  assert.equal(h.mails.length, 1);
  assert.equal(h.channels.get(`${event.id}/device:0`).code, "admin_access_revoked");
});

test("opted-out, preview-origin and missing-admin devices receive no push", async () => {
  for (const scenario of ["inactive", "origin", "role"]) {
    const h = harness();
    if (scenario === "inactive") h.devices.get("0").active = false;
    if (scenario === "origin") h.devices.get("0").origin = "https://preview.pages.dev";
    if (scenario === "role") h.staff.clear();
    await h.run();
    assert.equal(h.pushes.length, 0);
    assert.equal(h.mails.length, 1);
  }
});

test("expired subscriptions are disabled only if subscription has not changed", async () => {
  for (const rotate of [false, true]) {
    const h = harness();
    h.dependencies.sendPush = async () => {
      if (rotate) h.devices.get("0").subscription = { ...subscription, endpoint: subscription.endpoint.replace(/a/gu, "b") };
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    };
    await h.run();
    assert.equal(h.devices.get("0").active, rotate);
    assert.equal(h.channels.get(`${event.id}/device:0`).code, "subscription_expired");
  }
});

test("subscription expiry is checked with the injected clock before contacting the provider", async () => {
  const h = harness();
  h.devices.get("0").subscription = { ...subscription, expirationTime: instant + 1000 };
  h.advance(1001);
  assert.equal((await h.run()).status, "complete");
  assert.equal(h.pushes.length, 0);
  assert.equal(h.devices.get("0").active, false);
  assert.equal(h.channels.get(`${event.id}/device:0`).code, "subscription_expired");
  assert.equal(validSubscription({ ...subscription, expirationTime: instant }, instant), false);
  assert.equal(validSubscription({ ...subscription, expirationTime: instant + 1 }, instant), true);
  assert.equal(validSubscription({ ...subscription, expirationTime: "tomorrow" }, instant), false);
});

test("permanent email error does not block push and stops automatic retries", async () => {
  const h = harness();
  h.dependencies.sendEmail = async () => { throw Object.assign(new Error("unauthorized"), { status: 401 }); };
  assert.equal((await h.run()).status, "needs_attention");
  await h.run();
  assert.equal(h.pushes.length, 1);
  assert.equal(h.channels.get(`${event.id}/email`).attempts, 1);
});

test("20-hour cutoff prevents late retries beyond Resend 24-hour idempotency retention", async () => {
  const h = harness();
  h.dependencies.sendEmail = async () => { throw new Error("network"); };
  await h.run();
  h.advance(RETRY_WINDOW_MS);
  const result = await h.run();
  assert.equal(result.status, "needs_attention");
  assert.equal(result.code, "retry_window_closed");
  assert.equal(h.channels.get(`${event.id}/email`).attempts, 1);
  const fresh = harness();
  fresh.advance(RETRY_WINDOW_MS);
  await fresh.run();
  assert.equal(fresh.mails.length + fresh.pushes.length, 0);
});

test("expired leases can be reclaimed and attempt limits/payload changes fail closed", () => {
  const options = { now: instant, deadlineAtMs: instant + RETRY_WINDOW_MS, token: "one", payloadHash: "hash" };
  const first = claimTransition(null, options);
  assert.equal(first.claimed, true);
  assert.equal(claimTransition(first.record, options).claimed, false);
  assert.equal(claimTransition(first.record, { ...options, now: instant + LEASE_MS }).claimed, true);
  assert.equal(claimTransition({ attempts: 12 }, options).record.status, "needs_attention");
  assert.equal(claimTransition({ payloadHash: "other" }, options).record.code, "configuration_changed");
});

test("fanout is bounded at 100 and overflow is explicitly needs_attention", async () => {
  const h = harness(101);
  const result = await h.run();
  assert.equal(h.pushes.length, 100);
  assert.equal(result.fanoutTruncated, true);
  assert.equal(result.status, "needs_attention");
});

test("no enrolled devices is reported as zero targets, not a delivered mobile alert", async () => {
  const h = harness(0);
  const result = await h.run();
  assert.equal(result.pushTargetCount, 0);
  assert.equal(result.pushAcceptedCount, 0);
  assert.equal(h.mails.length, 1);
});

test("email/push payloads and delivery ledgers never copy appointment PHI", async () => {
  const h = harness();
  await h.run();
  const serialized = JSON.stringify([emailMessage(config), pushMessage(event.id), [...h.alerts], [...h.channels]]);
  for (const value of ["QA SECRET NAME", "9999999999", "QA SECRET REASON", "patientName", "phone", "preferredDate"]) {
    assert.equal(serialized.includes(value), false);
  }
  assert.ok(emailMessage(config).text.includes(`${PRODUCTION_ORIGIN}/admin/appointments`));
});

test("push endpoints and keys are independently validated against SSRF and invalid points", () => {
  assert.equal(validSubscription(subscription), true);
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/" + "a".repeat(50),
    "https://127.0.0.1/private", "https://constructor/foo", "https://fcm.googleapis.com.evil.test/path",
    subscription.endpoint + "?redirect=https://example.com", subscription.endpoint + "#fragment",
    subscription.endpoint.replace("https://", "https://username@"),
    subscription.endpoint.replace(".com/", ".com:443/"), "https://fcm.googleapis.com/internal",
  ]) assert.equal(validSubscription({ ...subscription, endpoint }), false, endpoint);
  assert.equal(validSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: "A".repeat(87) } }), false);
  assert.equal(validSubscription({ ...subscription, keys: { ...subscription.keys, auth: "bad" } }), false);
});
