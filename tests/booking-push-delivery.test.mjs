import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { createPushDeliveryService, PUSH_RETRY_WINDOW_MS, PUSH_MAX_DEVICES } from "../server/notifications/push-delivery.js";
import { createWebPushTransport } from "../server/notifications/push-transport.js";
import { createPushStore } from "../server/notifications/push-store.js";

const instant = Date.parse("2026-09-25T10:00:00Z");
function keyPair() {
  const key = createECDH("prime256v1"); key.generateKeys();
  return { publicKey: key.getPublicKey().toString("base64url"), privateKey: key.getPrivateKey().toString("base64url") };
}
const vapid = keyPair();
const receiver = keyPair();
const env = {
  FIREBASE_PROJECT_ID: "asher-healthcare-clinic", BOOKING_ALERTS_ENABLED: "true",
  BOOKING_ALERT_PUSH_CONFIGURED: "true", BOOKING_ALERTS_ACTIVATED_AT: "2026-09-25T09:00:00Z",
  BOOKING_ALERT_VAPID_PUBLIC_KEY: vapid.publicKey, BOOKING_ALERT_VAPID_PRIVATE_KEY: vapid.privateKey,
};
const subscription = {
  endpoint: `https://fcm.googleapis.com/fcm/send/${"a".repeat(50)}`,
  expirationTime: null, keys: { p256dh: receiver.publicKey, auth: Buffer.alloc(16, 2).toString("base64url") },
};
const appointmentId = "fixture-appointment";
const outboxPath = `appointmentPushOutbox/${appointmentId}`;
const idFor = (index) => index.toString(16).padStart(64, "0");

function harness(count = 1, options = {}) {
  let clock = instant; let serial = 0;
  const docs = new Map([
    [outboxPath, { appointmentId, requestOrigin: "https://asherhealthcare.in", createdAt: new Date(instant), status: "pending" }],
    [`appointments/${appointmentId}`, { source: "website", createdBy: "public-website", status: "requested",
      requestOrigin: "https://asherhealthcare.in", createdAt: new Date(instant), patientName: "PRIVATE NAME", phone: "PRIVATE PHONE", reason: "PRIVATE CONDITION" }],
    ["staff/qa-admin", { active: true, role: "admin" }],
    ...Array.from({ length: count }, (_, index) => [`adminPushDevices/${idFor(index)}`, {
      active: true, uid: "qa-admin", origin: "https://asherhealthcare.in", subscription: structuredClone(subscription),
    }]),
  ]);
  const sends = [];
  const store = {
    async get(_env, path) { return docs.has(path) ? { data: structuredClone(docs.get(path)), updateTime: "version" } : null; },
    async listDevices(_env, limit) {
      return [...docs].filter(([path, doc]) => path.startsWith("adminPushDevices/") && doc.active).slice(0, limit).map(([path]) => path.split("/").at(-1));
    },
    async mutate(_env, path, transition, check = () => {}) {
      check(); const current = docs.get(path) || null; const patch = transition(current ? structuredClone(current) : null);
      if (patch) docs.set(path, { ...current, ...structuredClone(patch) });
      return structuredClone(docs.get(path));
    },
    async disableIfUnchanged(_env, id, expected) {
      const current = docs.get(`adminPushDevices/${id}`);
      if (current?.uid === expected.uid && JSON.stringify(current?.subscription) === JSON.stringify(expected.subscription)) current.active = false;
    },
  };
  const deps = { store, now: () => clock, token: () => `lease-${serial++}`,
    async sendPush(target, payload, settings) { sends.push({ target, payload, settings }); }, ...options };
  return { docs, store, sends, deps, advance(ms) { clock += ms; },
    run(config = env) { return createPushDeliveryService(deps).deliver(config, appointmentId); } };
}

test("Pages sender is push only, reports acceptance and deduplicates repeated/concurrent dispatch", async () => {
  const h = harness();
  await Promise.all([h.run(), h.run(), h.run()]);
  const result = await h.run();
  assert.deepEqual(result, { status: "sent", sent: 1, pending: 0, skipped: 0, failed: 0 });
  assert.equal(h.sends.length, 1);
  assert.deepEqual(h.sends[0].payload, { type: "appointment-request", appointmentId });
  assert.equal(h.docs.get(`${outboxPath}/devices/${idFor(0)}`).status, "sent");
});

test("missing outbox, disabled configuration, preview project and invalid IDs never send", async () => {
  const h = harness(); h.docs.delete(outboxPath);
  assert.equal((await h.run()).status, "skipped");
  for (const override of [
    { FIREBASE_PROJECT_ID: "asher-healthcare-qa" }, { BOOKING_ALERTS_ENABLED: "false" },
    { BOOKING_ALERT_PUSH_CONFIGURED: "false" }, { BOOKING_ALERTS_ACTIVATED_AT: "" },
    { BOOKING_ALERTS_ACTIVATED_AT: "2026-09-26T00:00:00Z" }, { BOOKING_ALERT_VAPID_PRIVATE_KEY: "" },
  ]) { const item = harness(); await item.run({ ...env, ...override }); assert.equal(item.sends.length, 0); }
  assert.equal((await createPushDeliveryService(h.deps).deliver(env, "../patients")).status, "skipped");
});

test("trusted outbox must match a fresh production website appointment", async () => {
  for (const change of [
    (h) => { h.docs.get(outboxPath).appointmentId = "different"; },
    (h) => { h.docs.get(outboxPath).requestOrigin = "https://preview.pages.dev"; },
    (h) => { h.docs.get(outboxPath).createdAt = new Date(instant - 7200000); },
    (h) => { h.docs.get(`appointments/${appointmentId}`).createdAt = new Date(instant - 7200000); },
    (h) => { h.docs.get(`appointments/${appointmentId}`).source = "staff"; },
    (h) => { h.docs.get(`appointments/${appointmentId}`).createdBy = "qa-admin"; },
    (h) => { h.docs.get(`appointments/${appointmentId}`).status = "confirmed"; },
    (h) => { h.docs.delete(`appointments/${appointmentId}`); },
  ]) { const h = harness(); change(h); assert.equal((await h.run()).status, "skipped"); assert.equal(h.sends.length, 0); }
  const www = harness();
  for (const path of [outboxPath, `appointments/${appointmentId}`]) www.docs.get(path).requestOrigin = "https://www.asherhealthcare.in";
  assert.equal((await www.run()).sent, 1);
});

test("current device ownership and admin role are checked immediately before every delivery", async () => {
  for (const change of [
    (h) => { h.docs.get("staff/qa-admin").active = false; },
    (h) => { h.docs.get("staff/qa-admin").role = "reception"; },
    (h) => { h.docs.get(`adminPushDevices/${idFor(0)}`).origin = "https://preview.pages.dev"; },
  ]) { const h = harness(); change(h); await h.run(); assert.equal(h.sends.length, 0); }
});

test("manual retry respects backoff and never repeats accepted devices", async () => {
  const h = harness(2); let calls = 0;
  h.deps.sendPush = async (target, payload) => { calls += 1; h.sends.push({ target, payload }); if (calls === 1) throw Object.assign(new Error("temporary"), { status: 503 }); };
  const first = await h.run(); assert.equal(first.status, "needs_attention"); assert.equal(first.sent, 1);
  await h.run(); assert.equal(calls, 2);
  h.advance(60001);
  const second = await h.run(); assert.equal(second.status, "sent"); assert.equal(second.sent, 2); assert.equal(calls, 3);
});

test("role revocation takes effect on manual retry; retries stop after20hours", async () => {
  const h = harness();
  h.deps.sendPush = async () => { throw Object.assign(new Error("temporary"), { status: 503 }); };
  await h.run(); h.advance(60001); h.docs.get("staff/qa-admin").role = "reception";
  assert.equal((await h.run()).skipped, 1);
  const old = harness(); old.advance(PUSH_RETRY_WINDOW_MS);
  assert.equal((await old.run()).status, "needs_attention"); assert.equal(old.sends.length, 0);
  assert.equal(old.docs.get(outboxPath).reason, "retry_window_closed");
});

test("expired subscriptions skip transport and are disabled only if unchanged", async () => {
  const expired = harness(); expired.docs.get(`adminPushDevices/${idFor(0)}`).subscription.expirationTime = instant - 1;
  assert.equal((await expired.run()).skipped, 1); assert.equal(expired.sends.length, 0);
  assert.equal(expired.docs.get(`adminPushDevices/${idFor(0)}`).active, false);
  for (const rotate of [false, true]) {
    const h = harness(); h.deps.sendPush = async () => {
      if (rotate) h.docs.get(`adminPushDevices/${idFor(0)}`).subscription.endpoint += "b";
      throw Object.assign(new Error("gone"), { status: 410 });
    };
    assert.equal((await h.run()).skipped, 1);
    assert.equal(h.docs.get(`adminPushDevices/${idFor(0)}`).active, rotate);
  }
});

test("permanent provider failure is not retried, even manually", async () => {
  const h = harness(); let calls = 0;
  h.deps.sendPush = async () => { calls += 1; throw Object.assign(new Error("unauthorized"), { status: 401 }); };
  await h.run(); h.advance(60001); await h.run(); assert.equal(calls, 1);
});

test("fanout overflow and no devices are explicit needs_attention", async () => {
  const h = harness(PUSH_MAX_DEVICES + 1);
  assert.equal((await h.run()).status, "needs_attention"); assert.equal(h.sends.length, PUSH_MAX_DEVICES);
  assert.equal(h.docs.get(outboxPath).reason, "device_limit_exceeded");
  const none = harness(0); assert.equal((await none.run()).status, "needs_attention"); assert.equal(none.docs.get(outboxPath).reason, "no_devices");
});

test("dispatch has a hard budget and persists attention without blocking a booking", async () => {
  const h = harness(1, { budgetMs: 80 });
  h.deps.sendPush = async () => new Promise(() => {});
  const before = Date.now(); const result = await h.run();
  assert.ok(Date.now() - before < 1000); assert.equal(result.status, "needs_attention");
  assert.equal(h.docs.get(outboxPath).status, "needs_attention");
});

test("outbox/device ledgers and payload never copy patient details", async () => {
  const h = harness(); await h.run();
  const output = JSON.stringify([h.sends.map(({ payload }) => payload), [...h.docs].filter(([path]) => path.startsWith("appointmentPushOutbox/"))]);
  for (const marker of ["PRIVATE NAME", "PRIVATE PHONE", "PRIVATE CONDITION", "patientName", "phone"]) assert.equal(output.includes(marker), false);
});

test("native fetch transport encrypts payload, fixes content and forbids redirects", async () => {
  let request;
  const send = createWebPushTransport({ now: () => instant, fetch: async (endpoint, init) => { request = { endpoint, init }; return new Response(null, { status: 201 }); } });
  await send(subscription, { type: "appointment-request", appointmentId, patientName: "PRIVATE NAME", url: "https://evil.test" }, { ...vapid, topic: "safe-topic", signal: new AbortController().signal });
  assert.equal(request.endpoint, subscription.endpoint); assert.equal(request.init.redirect, "manual");
  assert.equal(request.init.headers["Content-Length"], undefined);
  assert.equal(request.init.headers["Content-Encoding"], "aes128gcm");
  assert.ok(request.init.body instanceof Uint8Array); assert.ok(request.init.body.length > 50);
  assert.equal(request.init.body.includes(Buffer.from("PRIVATE NAME")), false);
});

test("transport rejects provider redirects without forwarding notification credentials", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    const send = createWebPushTransport({ now: () => instant, fetch: async (_endpoint, init) => {
      calls += 1;
      assert.equal(init.redirect, "manual");
      return new Response(null, { status, headers: { Location: "https://untrusted.example/collect" } });
    } });
    await assert.rejects(send(subscription, { type: "appointment-request", appointmentId }, { ...vapid, topic: "safe" }), (error) => error.status === status);
    assert.equal(calls, 1);
  }
});

test("transport rejects SSRF endpoints, expired subscriptions and mismatched VAPID pair without fetch", async () => {
  let calls = 0;
  const send = createWebPushTransport({ now: () => instant, fetch: async () => { calls += 1; return new Response(null, { status: 201 }); } });
  const settings = { ...vapid, topic: "safe" };
  for (const candidate of [ { ...subscription, endpoint: "https://127.0.0.1/private" }, { ...subscription, expirationTime: instant - 1 } ]) {
    await assert.rejects(send(candidate, { type: "appointment-request", appointmentId }, settings));
  }
  await assert.rejects(send(subscription, { type: "appointment-request", appointmentId }, { ...settings, privateKey: keyPair().privateKey }));
  assert.equal(calls, 0);
});

test("REST store retries only conflicting conditional writes and preserves immutable data", async () => {
  let writes = 0; let document = { data: { createdAt: "fixed", status: "pending" }, updateTime: "v1" };
  const store = createPushStore({ getDocument: async () => document,
    updateDocumentWrite: (_env, path, patch, fields, updateTime) => ({ path, patch, fields, updateTime }),
    commitWrites: async (_env, [write]) => {
      writes += 1;
      if (writes === 1) { document = { ...document, updateTime: "v2" }; throw Object.assign(new Error("conflict"), { status: 409 }); }
      assert.equal(write.updateTime, "v2"); document = { data: { ...document.data, ...write.patch }, updateTime: "v3" };
    },
  });
  await store.mutate(env, outboxPath, () => ({ status: "processing" }));
  assert.equal(writes, 2); assert.equal(document.data.createdAt, "fixed");
});
