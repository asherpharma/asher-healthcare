import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_EMAIL_OUTBOX, bookingEmailReadiness, createBookingEmailDeliveryService, prepareBookingEmailOutbox,
  bookingEmailTestReady, sendBookingEmailTest,
} from "../server/notifications/email-delivery.js";

const TICK = Date.parse("2026-11-18T09:00:00.000Z");
const ORIGIN = "https://asherhealthcare.in";
const ID = "0123456789abcdeffedcba9876543210";
const OUTBOX_PATH = `${BOOKING_EMAIL_OUTBOX}/${ID}`;
const BOOKING_PATH = `appointments/${ID}`;
const ENV = {
  FIREBASE_PROJECT_ID: "asher-healthcare-clinic",
  BOOKING_ALERT_EMAIL_ENABLED: "true",
  BOOKING_ALERT_EMAIL_ACTIVATED_AT: "2026-11-18T08:00:00.000Z",
  BOOKING_ALERT_RESEND_API_KEY: "re_fake_booking_email_fixture",
  BOOKING_ALERT_EMAIL_SWEEP_SECRET: Buffer.alloc(32, 44).toString("base64url"),
};
const OUTBOX = { appointmentId: ID, requestOrigin: ORIGIN, createdAt: new Date(TICK).toISOString(), status: "pending", nextAttemptAt: TICK };
const BOOKING = {
  source: "website", status: "requested", createdBy: "public-website", privacyAccepted: true,
  requestOrigin: ORIGIN, createdAt: OUTBOX.createdAt, patientName: "Maya D’Costa\r\n\u202eExample.test", phone: "+91 (00000) 01234",
  doctorId: "pediatrics", preferredDate: "2026-11-19", preferredTime: "17:30",
  reason: "Private test reason should never leave database", patientId: "private-fixture-id", appointmentId: ID,
};
const ACCEPTED = () => Response.json({ id: "814fc7bd-180d-4c58-9caf-831fe007642d" });

test("preflight is time-limited, disabled for active bookings, and sends only a fixed synthetic specimen", async () => {
  const env = {
    FIREBASE_PROJECT_ID: ENV.FIREBASE_PROJECT_ID, BOOKING_ALERT_RESEND_API_KEY: ENV.BOOKING_ALERT_RESEND_API_KEY,
    BOOKING_ALERT_EMAIL_ENABLED: "false", BOOKING_ALERT_EMAIL_TEST_UNTIL: "2026-11-18T09:30:00Z",
  };
  const sends = [];
  const opts = { now: () => TICK, async fetchRequest(url, request) { sends.push([url, request]); return ACCEPTED(); } };
  for (const overrides of [
    { BOOKING_ALERT_EMAIL_ENABLED: undefined }, { BOOKING_ALERT_EMAIL_ENABLED: "true" },
    { BOOKING_ALERT_EMAIL_TEST_UNTIL: new Date(TICK).toISOString() }, { BOOKING_ALERT_EMAIL_TEST_UNTIL: "invalid" },
    { BOOKING_ALERT_EMAIL_TEST_UNTIL: new Date(TICK + 3_600_001).toISOString() },
    { BOOKING_ALERT_EMAIL_TEST_UNTIL: undefined }, { BOOKING_ALERT_RESEND_API_KEY: undefined },
    { FIREBASE_PROJECT_ID: "asher-healthcare-qa" },
  ]) {
    assert.equal(bookingEmailTestReady({ ...env, ...overrides }, TICK), false);
    assert.equal(await sendBookingEmailTest({ ...env, ...overrides }, opts), false);
  }
  assert.equal(sends.length, 0);
  assert.equal(bookingEmailReadiness(env, TICK), false);
  assert.equal(await sendBookingEmailTest(env, opts), true);
  assert.equal(await sendBookingEmailTest(env, opts), true);
  assert.equal(sends.length, 2);
  const [url, request] = sends[0];
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(request.redirect, "manual");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["Idempotency-Key"], sends[1][1].headers["Idempotency-Key"]);
  assert.equal(request.body, sends[1][1].body);
  const body = JSON.parse(request.body);
  assert.equal(body.subject, "[TEST] Asher Healthcare booking email — no appointment");
  assert.equal(body.from, "booking-alerts@notify.asherhealthcare.in");
  assert.deepEqual(body.to, ["asherhealthcare100@gmail.com"]);
  assert.match(body.text, /^TEST ONLY: Fictional details/u);
  assert.match(body.text, /Patient: Clinic Delivery Test\nBooking mobile: 0000000000\nDoctor: Dr\. Lt Col Shafi Ahamad\nAppointment: 4 January 2030 at 5:30 PM IST/u);
  assert.equal(await sendBookingEmailTest(env, { now: () => TICK, fetchRequest: () => new Response(null, { status: 302 }) }), false);
});

function harness({ outbox = OUTBOX, booking = BOOKING, answer = ACCEPTED, budgetMs, mutationFailure } = {}) {
  let now = TICK;
  const records = new Map([[OUTBOX_PATH, { ...outbox }], [BOOKING_PATH, { ...booking }]]);
  const sends = [];
  const gets = [];
  const service = createBookingEmailDeliveryService({
    now: () => now,
    budgetMs,
    store: {
      async get(_env, path) {
        gets.push(path);
        const data = records.get(path);
        return data ? { data } : null;
      },
      async mutate(_env, path, transition, check) {
        check();
        const current = records.get(path);
        const patch = transition(current);
        if (!patch) return current;
        check();
        if (mutationFailure?.(patch)) throw new Error("test-internal failure is not returned");
        const next = { ...current, ...patch };
        records.set(path, next);
        return next;
      },
    },
    async fetch(url, options) {
      assert.equal(this, undefined, "use Cloudflare native fetch without a dependency-object receiver");
      assert.equal(records.get(OUTBOX_PATH).status, "processing");
      assert.ok(records.get(OUTBOX_PATH).nextAttemptAt > now, "a due sweep must not claim a live lease");
      assert.match(records.get(OUTBOX_PATH).payloadHash, /^[a-f0-9]{64}$/u, "pin private payload digest before first send");
      sends.push({ url, ...options });
      return answer(url, options);
    },
  });
  return {
    records, sends, gets,
    run(env = ENV, id = ID, options) { return service.deliver(env, id, options); },
    advance(ms) { now += ms; },
    state() { return records.get(OUTBOX_PATH); },
  };
}

test("email readiness is production-only, independent of push, and requires a real-shaped key and sweep secret", () => {
  assert.equal(bookingEmailReadiness(ENV, TICK), true);
  assert.equal(bookingEmailReadiness({ ...ENV, BOOKING_ALERT_EMAIL_ACTIVATED_AT: "2026-11-18T08:00:00Z" }, TICK), true);
  assert.equal(bookingEmailReadiness({ ...ENV, BOOKING_ALERT_EMAIL_ACTIVATED_AT: new Date(TICK).toISOString() }, TICK), true);
  for (const overrides of [
    { FIREBASE_PROJECT_ID: "asher-healthcare-qa" }, { BOOKING_ALERT_EMAIL_ENABLED: "TRUE" },
    { BOOKING_ALERT_EMAIL_ENABLED: undefined }, { BOOKING_ALERT_EMAIL_ENABLED: false },
    { BOOKING_ALERT_RESEND_API_KEY: undefined }, { BOOKING_ALERT_RESEND_API_KEY: "re_replace_me_with_a_key" },
    { BOOKING_ALERT_RESEND_API_KEY: " re_fake_booking_email_fixture " }, { BOOKING_ALERT_RESEND_API_KEY: "re_abc" },
    { BOOKING_ALERT_EMAIL_SWEEP_SECRET: "missing" }, { BOOKING_ALERT_EMAIL_SWEEP_SECRET: "x".repeat(42) + "=" },
    { BOOKING_ALERT_EMAIL_ACTIVATED_AT: "2026-11-18T09:00:00.001Z" },
    { BOOKING_ALERT_EMAIL_ACTIVATED_AT: "2026-11-18T08:00:00+00:00" },
    { BOOKING_ALERT_EMAIL_ACTIVATED_AT: "2026-10-32T08:00:00Z" },
    { BOOKING_ALERT_EMAIL_ACTIVATED_AT: "2026-11-18T08:00:00.0Z" },
  ]) assert.equal(bookingEmailReadiness({ ...ENV, ...overrides }, TICK), false, JSON.stringify(overrides));
});

test("outbox write is create-only and copies no details from the website booking", () => {
  for (const canonical of [ORIGIN, "https://www.asherhealthcare.in"]) {
    const entry = prepareBookingEmailOutbox(ENV, new Request(`${canonical}/api/appointments/book`), {
      appointmentId: ID, source: "website", now: new Date(TICK), ...BOOKING,
    });
    assert.equal(entry.currentDocument.exists, false);
    assert.match(entry.update.name, new RegExp(`/${BOOKING_EMAIL_OUTBOX}/${ID}$`, "u"));
    assert.deepEqual(entry.update.fields, {
      appointmentId: { stringValue: ID }, requestOrigin: { stringValue: canonical },
      createdAt: { timestampValue: OUTBOX.createdAt }, status: { stringValue: "pending" }, nextAttemptAt: { integerValue: String(TICK) },
    });
  }
  for (const url of ["https://feature-preview.asher-healthcare.pages.dev", "https://asherhealthcare.in.evil.test", "http://asherhealthcare.in", "not a URL"]) {
    assert.equal(prepareBookingEmailOutbox(ENV, { url }, { appointmentId: ID, source: "website", now: new Date(TICK) }), null);
  }
  for (const source of ["walk-in", "phone", "reception"]) {
    assert.equal(prepareBookingEmailOutbox(ENV, { url: ORIGIN }, { appointmentId: ID, source, now: new Date(TICK) }), null);
  }
});

test("on an active saved request, sends only the approved booking details to the fixed mailbox", async () => {
  const h = harness();
  assert.deepEqual(await h.run(), { status: "accepted" });
  assert.deepEqual(h.gets, [BOOKING_PATH]);
  const [{ url, method, headers, body, redirect }] = h.sends;
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(method, "POST");
  assert.equal(redirect, "manual");
  assert.equal(headers.Authorization, `Bearer ${ENV.BOOKING_ALERT_RESEND_API_KEY}`);
  assert.match(headers["Idempotency-Key"], /^asher-pages-booking-email-v1\/[a-f0-9]{64}$/u);
  assert.ok(!headers["Idempotency-Key"].includes(ID));
  assert.deepEqual(JSON.parse(body), {
    from: "booking-alerts@notify.asherhealthcare.in", to: ["asherhealthcare100@gmail.com"],
    subject: "Asher Healthcare — new website appointment request",
    text: "A new appointment request was submitted on the Asher Healthcare website.\n\nPatient: Maya D’Costa Example. test\nBooking mobile: +910000001234\nDoctor: Dr. Lt Col Shafi Ahamad\nAppointment: 19 November 2026 at 5:30 PM IST (India time)\n\nSign in to review it: https://asherhealthcare.in/admin/appointments",
  });
  assert.equal(h.state().nextAttemptAt, null);
  assert.equal(h.state().reason, "accepted_by_provider");
  assert.doesNotMatch(JSON.stringify(h.state()), /Maya|01234(?!56789)|Private test|Shafi|17:30|private-fixture-id|814fc7bd/u);
  assert.doesNotMatch(body, /Private test|private-fixture-id|0123456789abcdef|[?&]utm_/u);
});

test("advancing a website request through an active clinic status does not suppress its alert", async () => {
  for (const status of ["confirmed", "checked_in", "waiting", "in_consultation"]) {
    const h = harness({ booking: { ...BOOKING, status, doctorId: "obg", preferredTime: "20:30", patientName: "Drishti Patil" } });
    assert.deepEqual(await h.run(), { status: "accepted" });
    assert.match(JSON.parse(h.sends[0].body).text, /Dr\. Shaik Reshma\nAppointment: 19 November 2026 at 8:30 PM IST/u);
  }
});

test("invalid, cancelled, previously inactive, preview, fabricated or mismatched records never send", async () => {
  for (const booking of [
    { ...BOOKING, privacyAccepted: false }, { ...BOOKING, source: "reception" }, { ...BOOKING, createdBy: "staff-id" },
    { ...BOOKING, status: "cancelled" }, { ...BOOKING, status: "completed" }, { ...BOOKING, status: "no_show" },
    { ...BOOKING, status: "Checked_in" }, { ...BOOKING, createdAt: "2026-11-18T07:59:59Z" },
    { ...BOOKING, requestOrigin: "https://preview.pages.dev" }, { ...BOOKING, requestOrigin: "https://www.asherhealthcare.in" },
    { ...BOOKING, createdAt: new Date(TICK - 1).toISOString() },
  ]) {
    const h = harness({ booking });
    assert.deepEqual(await h.run(), { status: "skipped" });
    assert.equal(h.state().reason, "not_website_request");
    assert.equal(h.state().nextAttemptAt, null);
    assert.equal(h.sends.length, 0);
  }
  const h = harness({ outbox: { ...OUTBOX, requestOrigin: "https://preview.pages.dev" } });
  assert.deepEqual(await h.run(), { status: "skipped" });
  assert.equal(h.gets.length, 0);
  assert.equal(h.sends.length, 0);
  const disabled = harness();
  assert.deepEqual(await disabled.run({ ...ENV, FIREBASE_PROJECT_ID: "asher-healthcare-qa" }), { status: "skipped" });
  assert.deepEqual(await disabled.run(ENV, "foo/bar"), { status: "skipped" });
  assert.equal(disabled.state().status, "pending");
});

test("form-valid unusual names or mobile values preserve the alert but fall back for the affected field", async () => {
  // The booking handler checks name length >= 2 and strips formatting before
  // counting phone digits; these records can be legitimate saved web bookings.
  for (const patientName of ["23", "A1", "A".repeat(77) + ".R."]) {
    const h = harness({ booking: { ...BOOKING, patientName } });
    assert.deepEqual(await h.run(), { status: "accepted" });
    assert.match(JSON.parse(h.sends[0].body).text, /\nPatient: See appointment desk\nBooking mobile: \+910000001234\n/u);
  }
  const h = harness({ booking: { ...BOOKING, patientName: "Asha Roy", phone: "x0000001234" } });
  assert.deepEqual(await h.run(), { status: "accepted" });
  assert.match(JSON.parse(h.sends[0].body).text, /\nPatient: Asha Roy\nBooking mobile: See appointment desk\n/u);
  assert.doesNotMatch(h.sends[0].body, /0000001234/u);
});

test("malformed trusted doctor, date and time fields are held without exposure", async () => {
  for (const fields of [
    { doctorId: "https://fixture.test/doctor" }, { preferredDate: "2026-11-31" }, { preferredTime: "25:00" },
  ]) {
    const h = harness({ booking: { ...BOOKING, ...fields } });
    assert.deepEqual(await h.run(), { status: "needs_attention" });
    assert.equal(h.state().reason, "invalid_booking_fields");
    assert.equal(h.state().nextAttemptAt, null);
    assert.equal(h.sends.length, 0);
  }
});

test("concurrent and repeated initial/scheduled calls are mutually exclusive", async () => {
  const h = harness();
  const results = await Promise.all([h.run(), h.run(), h.run()]);
  assert.ok(results.some((entry) => entry.status === "accepted"));
  assert.ok(results.every((entry) => ["accepted", "processing"].includes(entry.status)));
  assert.deepEqual(await h.run(), { status: "accepted" });
  assert.equal(h.sends.length, 1);
});

test("temporary HTTP errors respect Retry-After and retry identical immutable payloads", async () => {
  let attempt = 0;
  const h = harness({ answer() {
    if (++attempt === 1) return new Response("not for logs", { status: 429, headers: { "Retry-After": "180" } });
    if (attempt === 2) return new Response("never logged", { status: 503, headers: { "Retry-After": new Date(TICK + 360_000).toUTCString() } });
    return ACCEPTED();
  } });
  assert.deepEqual(await h.run(), { status: "pending" });
  assert.equal(h.state().nextAttemptAt, TICK + 180_000);
  h.advance(179_999);
  assert.deepEqual(await h.run(), { status: "pending" });
  assert.equal(h.sends.length, 1);
  h.advance(1);
  assert.deepEqual(await h.run(), { status: "pending" });
  assert.equal(h.state().nextAttemptAt, TICK + 360_000);
  h.advance(180_000);
  assert.deepEqual(await h.run(), { status: "accepted" });
  assert.equal(h.sends.length, 3);
  assert.equal(new Set(h.sends.map((item) => item.headers["Idempotency-Key"])).size, 1);
  assert.equal(new Set(h.sends.map((item) => item.body)).size, 1);
});

test("an ambiguous successful provider send followed by failed persistence is recovered under the same key", async () => {
  let fail = true;
  const h = harness({ mutationFailure(patch) { return patch.status === "accepted" && fail; } });
  assert.deepEqual(await h.run(), { status: "processing" });
  assert.equal(h.sends.length, 1);
  assert.deepEqual(await h.run(), { status: "processing" });
  assert.equal(h.sends.length, 1);
  h.advance(45_000);
  fail = false;
  assert.deepEqual(await h.run(), { status: "accepted" });
  assert.equal(h.sends.length, 2);
  assert.equal(h.sends[0].headers["Idempotency-Key"], h.sends[1].headers["Idempotency-Key"]);
  assert.equal(h.sends[0].body, h.sends[1].body);
});

test("edits after first claim do not send changed details or reuse an idempotency key for a changed body", async () => {
  const h = harness({ answer() { return new Response(null, { status: 503 }); } });
  assert.deepEqual(await h.run(), { status: "pending" });
  h.records.set(BOOKING_PATH, { ...BOOKING, preferredTime: "17:45" });
  h.advance(60_000);
  assert.deepEqual(await h.run(), { status: "needs_attention" });
  assert.equal(h.state().reason, "booking_details_changed");
  assert.equal(h.state().nextAttemptAt, null);
  assert.equal(h.sends.length, 1);
});

test("an active status-only change keeps a fallback email attempt byte-identical across retry", async () => {
  const changed = { ...BOOKING, patientName: "23", phone: "x0000001234" };
  let attempt = 0;
  const h = harness({ booking: changed, answer: () => ++attempt === 1 ? new Response(null, { status: 503 }) : ACCEPTED() });
  assert.deepEqual(await h.run(), { status: "pending" });
  const digest = h.state().payloadHash;
  h.records.set(BOOKING_PATH, { ...changed, status: "waiting" });
  h.advance(60_000);
  assert.deepEqual(await h.run(), { status: "accepted" });
  assert.equal(h.state().payloadHash, digest);
  assert.equal(h.sends[0].body, h.sends[1].body);
  assert.match(JSON.parse(h.sends[1].body).text, /\nPatient: See appointment desk\nBooking mobile: See appointment desk\n/u);
});

test("a provider 409 in-flight conflict can retry, but a payload mismatch and rejected recipient stop", async () => {
  for (const [status, body, expected, code] of [
    [409, { name: "concurrent_idempotent_requests", message: "private provider string" }, "pending", "provider_409"],
    [409, { name: "invalid_idempotent_request", message: "private provider string" }, "needs_attention", "idempotency_payload_mismatch"],
    [403, { name: "restricted_api_key", message: "private provider string" }, "needs_attention", "provider_403"],
    [302, { message: "private provider string" }, "needs_attention", "provider_302"],
    [200, { id: "private provider string" }, "pending", "invalid_provider_response"],
    [200, { id: "a".repeat(5000) }, "pending", "invalid_provider_response"],
  ]) {
    const h = harness({ answer: () => Response.json(body, { status, headers: { Location: "https://invalid.fixture/" } }) });
    assert.deepEqual(await h.run(), { status: expected });
    assert.equal(h.state().reason, code);
    assert.doesNotMatch(JSON.stringify(h.state()), /private provider string|invalid.fixture/u);
    assert.equal(h.sends.length, 1);
  }
});

test("retry expiry and attempt maximum do not send duplicate alerts past the safe provider window", async () => {
  const h = harness({ answer: () => new Response(null, { status: 429, headers: { "Retry-After": String(20 * 3600) } }) });
  assert.deepEqual(await h.run(), { status: "needs_attention" });
  assert.equal(h.state().nextAttemptAt, null);
  h.advance(21 * 3600_000);
  assert.deepEqual(await h.run(), { status: "needs_attention" });
  assert.equal(h.sends.length, 1);
  for (const outbox of [OUTBOX, { ...OUTBOX, attempts: 12 }]) {
    const expired = harness({ outbox });
    if (!outbox.attempts) expired.advance(20 * 3600_000);
    assert.deepEqual(await expired.run(), { status: "needs_attention" });
    assert.equal(expired.state().reason, "retry_window_closed");
    assert.equal(expired.sends.length, 0);
  }
});

test("aborted scheduler run leaves a recoverable lease and never reports inbox delivery", async () => {
  const controller = new AbortController();
  const h = harness({ answer() { controller.abort(); return new Promise(() => {}); } });
  assert.deepEqual(await h.run(ENV, ID, { signal: controller.signal }), { status: "processing" });
  assert.equal(h.sends[0].signal.aborted, true);
  assert.equal(h.state().nextAttemptAt, TICK + 45_000);
  assert.equal(h.sends.length, 1);
  const beforeClaim = harness();
  assert.deepEqual(await beforeClaim.run(ENV, ID, { signal: controller.signal }), { status: "pending" });
  assert.equal(beforeClaim.state().attempts, undefined);
  assert.equal(beforeClaim.sends.length, 0);
});
