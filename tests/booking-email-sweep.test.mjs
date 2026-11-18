import test from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createBookingEmailSweepHandler } from "../functions/api/internal/booking-email-sweep.js";
import scheduler, { requestBookingEmailSweep } from "../booking-email-scheduler/index.mjs";

const URL = "https://asherhealthcare.in/api/internal/booking-email-sweep";
const SECRET = "t".repeat(43);
const NOW = 1_800_000_000_000;
const PROJECT_ID = "asher-healthcare-clinic";
const PREFIX = `projects/${PROJECT_ID}/databases/(default)/documents/appointmentEmailOutbox/`;
const ENV = { FIREBASE_PROJECT_ID: PROJECT_ID, BOOKING_ALERT_EMAIL_SWEEP_SECRET: SECRET };

function request(url = URL, init = {}) {
  return new Request(url, { method: "POST", headers: { Authorization: `Bearer ${SECRET}` }, ...init });
}

function fixture(overrides = {}) {
  const calls = [];
  const handler = createBookingEmailSweepHandler({
    compare(left, right) {
      assert.equal(left.byteLength, 43);
      assert.equal(right.byteLength, 43);
      return timingSafeEqual(left, right);
    },
    readiness(env, now) {
      calls.push(["ready", env, now]);
      return true;
    },
    async accessToken(env) {
      calls.push(["token", env]);
      return "synthetic-datastore-token";
    },
    async fetchRequest(url, init) {
      calls.push(["query", url, init]);
      return Response.json([{ document: { name: PREFIX + "appointment01" } }]);
    },
    async deliver(env, id, options) {
      calls.push(["deliver", env, id, options]);
    },
    now: () => NOW,
    ...overrides,
  });
  return { calls, run: (req = request(), env = ENV) => handler({ request: req, env }) };
}

async function blankStatus(response, status) {
  assert.equal(response.status, status);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
}

test("sweep ignores unauthorized, noncanonical and non-empty requests before touching the outbox", async () => {
  const { run, calls } = fixture();
  const rejected = [
    request(URL, { method: "GET" }),
    request(URL, { method: "OPTIONS" }),
    request(URL, { headers: {} }),
    request(URL, { headers: { Authorization: "Bearer short" } }),
    request(URL, { headers: { Authorization: `Bearer ${"u".repeat(43)}` } }),
    request(URL, { headers: { Authorization: `Bearer ${SECRET}, Bearer ${SECRET}` } }),
    request(URL, { headers: { Authorization: `Bearer ${SECRET}`, Origin: "https://asherhealthcare.in" } }),
    request(URL, { body: '{"id":"arbitrary","to":"arbitrary"}' }),
    request(URL + "?id=arbitrary"),
    request(URL + "/"),
    request(URL.replace("https:", "http:")),
    request(URL.replace("asherhealthcare.in", "www.asherhealthcare.in")),
    request(URL.replace("asherhealthcare.in", "asher-healthcare.pages.dev")),
    request(URL.replace("asherhealthcare.in", "asherhealthcare.in:444")),
  ];
  for (const req of rejected) await blankStatus(await run(req), 404);
  await blankStatus(await run(request(), { ...ENV, BOOKING_ALERT_EMAIL_SWEEP_SECRET: "" }), 404);
  assert.deepEqual(calls, []);
});

test("valid sweep authentication still requires production Firebase and email readiness", async () => {
  const { run, calls } = fixture({ readiness: () => false });
  await blankStatus(await run(), 503);
  assert.deepEqual(calls, []);
  const ready = fixture();
  await blankStatus(await ready.run(request(), { ...ENV, FIREBASE_PROJECT_ID: "asher-healthcare-qa" }), 503);
  assert.deepEqual(ready.calls, []);
});

test("sweep queries only due event names and dispatches with an abort signal", async () => {
  const { run, calls } = fixture();
  await blankStatus(await run(), 204);
  assert.deepEqual(calls[0], ["ready", ENV, NOW]);
  assert.deepEqual(calls[1], ["token", ENV]);
  const [, queryUrl, init] = calls[2];
  assert.equal(queryUrl, `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.equal(init.headers.Authorization, "Bearer synthetic-datastore-token");
  assert.equal(init.headers["Content-Type"], "application/json");
  const field = { fieldPath: "nextAttemptAt" };
  assert.deepEqual(JSON.parse(init.body), {
    structuredQuery: {
      select: { fields: [{ fieldPath: "__name__" }] },
      from: [{ collectionId: "appointmentEmailOutbox" }],
      where: { compositeFilter: { op: "AND", filters: [
        { fieldFilter: { field, op: "GREATER_THAN", value: { integerValue: "0" } } },
        { fieldFilter: { field, op: "LESS_THAN_OR_EQUAL", value: { integerValue: String(NOW) } } },
      ] } },
      orderBy: [{ field, direction: "ASCENDING" }],
      limit: 4,
    },
  });
  assert.deepEqual(calls[3], ["deliver", ENV, "appointment01", { signal: init.signal }]);
  assert.equal(init.signal.aborted, false);
});

test("sweep filters out foreign paths and duplicates, and caps concurrent dispatch", async () => {
  let active = 0;
  let peak = 0;
  const started = [];
  const { run } = fixture({
    async fetchRequest() {
      return Response.json([
        {},
        ...[
          PREFIX + "appointment01",
          PREFIX + "appointment01",
          PREFIX + "appointment02",
          PREFIX + "nested/invalid",
          PREFIX + "..",
          PREFIX + "invalid?path",
          PREFIX.replace(PROJECT_ID, "other-project") + "foreign",
          PREFIX.replace("appointmentEmailOutbox", "patients") + "private-id",
          PREFIX + "appointment03",
          PREFIX + "appointment04",
          PREFIX + "appointment05",
        ].map((name) => ({ document: { name } })),
      ]);
    },
    async deliver(_env, id) {
      started.push(id);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
    },
  });
  await blankStatus(await run(), 204);
  assert.deepEqual(started, ["appointment01", "appointment02", "appointment03", "appointment04"]);
  assert.equal(peak, 2);
});

test("sweep fails quietly on query problems and attempts other jobs after one fails", async () => {
  const brokenQuery = fixture({
    async fetchRequest() {
      return new Response("Private upstream response body.", { status: 503 });
    },
  });
  await blankStatus(await brokenQuery.run(), 503);
  assert.deepEqual(brokenQuery.calls.map(([type]) => type), ["ready", "token"]);

  const attempted = [];
  const brokenJob = fixture({
    async fetchRequest() {
      return Response.json(["one", "two", "three"].map((id) => ({ document: { name: PREFIX + id } })));
    },
    async deliver(_env, id) {
      attempted.push(id);
      if (id === "one") throw new Error("Private provider response body.");
    },
  });
  await blankStatus(await brokenJob.run(), 503);
  assert.deepEqual(attempted, ["one", "two", "three"]);
});

test("sweep never follows a Firestore redirect or uses its response body", async () => {
  let requests = 0;
  const { run, calls } = fixture({
    async fetchRequest(_url, init) {
      requests += 1;
      assert.equal(init.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "https://other.example" } });
    },
  });
  await blankStatus(await run(), 503);
  assert.equal(requests, 1);
  assert.deepEqual(calls.map(([type]) => type), ["ready", "token"]);
});

test("sweep deadline interrupts even a stalled token request and never dispatches afterwards", async () => {
  const stop = new AbortController();
  let finishToken;
  const { run, calls } = fixture({
    createSignal: () => stop.signal,
    accessToken: () => new Promise((resolve) => {
      finishToken = resolve;
      stop.abort();
    }),
  });
  await blankStatus(await run(), 503);
  finishToken("late-synthetic-token");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map(([type]) => type), ["ready"]);
});

test("sweep stops launching jobs once the shared deadline is past", async () => {
  const stop = new AbortController();
  const started = [];
  const { run } = fixture({
    createSignal: () => stop.signal,
    async fetchRequest() {
      return Response.json(["one", "two", "three"].map((id) => ({ document: { name: PREFIX + id } })));
    },
    async deliver(_env, id, { signal }) {
      assert.equal(signal, stop.signal);
      started.push(id);
      stop.abort();
    },
  });
  await blankStatus(await run(), 503);
  assert.deepEqual(started, ["one"]);
});

test("cron Worker has no public handler and its checked-in config starts without cron triggers", async () => {
  assert.deepEqual(Object.keys(scheduler), ["scheduled"]);
  const config = await readFile(new globalThis.URL("../booking-email-scheduler/wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"workers_dev": false/u);
  assert.match(config, /"preview_urls": false/u);
  assert.doesNotMatch(config, /"crons"\s*:/u);
});

test("cron Worker posts only to the fixed endpoint with the secret and no payload", async () => {
  let called = 0;
  const stop = new AbortController();
  await requestBookingEmailSweep({ ...ENV, BOOKING_ALERT_EMAIL_SWEEP_URL: "https://other.example" }, {
    createSignal: () => stop.signal,
    async fetchRequest(url, init) {
      called += 1;
      assert.equal(url, URL);
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "manual");
      assert.deepEqual(init.headers, { Authorization: `Bearer ${SECRET}` });
      assert.equal(init.signal, stop.signal);
      assert.equal(init.body, undefined);
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(called, 1);
});

test("cron rejects missing secret, unexpected success, redirects, failures and aborted attempts", async () => {
  let called = false;
  await assert.rejects(requestBookingEmailSweep({}, {
    fetchRequest() { called = true; },
  }), { message: "Booking email scheduler is not configured." });
  assert.equal(called, false);
  const failure = { message: "Booking email sweep request failed." };
  for (const status of [200, 301, 302, 404, 503]) {
    let requests = 0;
    await assert.rejects(requestBookingEmailSweep(ENV, {
      async fetchRequest(_url, init) {
        requests += 1;
        assert.equal(init.redirect, "manual");
        return new Response(null, { status, headers: { Location: "https://other.example" } });
      },
    }), failure);
    assert.equal(requests, 1);
  }
  await assert.rejects(requestBookingEmailSweep(ENV, {
    fetchRequest: async () => { throw new Error(SECRET); },
  }), failure);
  await assert.rejects(requestBookingEmailSweep(ENV, {
    createSignal: () => AbortSignal.abort(),
    fetchRequest() { called = true; },
  }), failure);
  assert.equal(called, false);
});
