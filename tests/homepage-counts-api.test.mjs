import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHomepageCountHandler } from "../functions/api/analytics/homepage.js";
import { createHomepageReportHandler } from "../functions/api/admin/homepage-counts.js";
import {
  assertHomepageOrigin,
  getHomepageCounts,
  HOMEPAGE_BODY_LIMIT,
  HOMEPAGE_DAILY_LIMIT,
  HOMEPAGE_EVENTS,
  HOMEPAGE_MAX_ATTEMPTS,
  HOMEPAGE_REPORT_CONCURRENCY,
  homepageDate,
  incrementHomepageCount,
  readHomepageEvent,
} from "../server/analytics/homepage-counts.js";
import { HttpError } from "../server/razorpay/http.js";

const ORIGIN = "https://asherhealthcare.in";
const ENV = { FIREBASE_PROJECT_ID: "aggregate-test-only" };
const NOW = new Date("2026-09-25T10:00:00.000Z");

function post(body = { event: "homepage_view" }, options = {}) {
  const { origin = ORIGIN, path = "/api/analytics/homepage", headers = {}, ...rest } = options;
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...rest,
  });
}

function get(path = "/api/admin/homepage-counts", headers = {}) {
  return new Request(`${ORIGIN}${path}`, {
    headers: { "Sec-Fetch-Site": "same-origin", Authorization: "Bearer test-only", ...headers },
  });
}

function store(initial = null) {
  let revision = 1;
  let document = initial ? { data: structuredClone(initial), updateTime: "revision-1" } : null;
  const reads = [];
  const writes = [];
  return {
    reads,
    writes,
    document: () => structuredClone(document),
    dependencies: {
      async getDocument(env, path) {
        assert.equal(env, ENV);
        reads.push(path);
        return structuredClone(document);
      },
      async commitWrites(env, batch) {
        assert.equal(env, ENV);
        assert.equal(batch.length, 1);
        const write = batch[0];
        if (
          (write.currentDocument.exists === false && document)
          || (write.currentDocument.updateTime && write.currentDocument.updateTime !== document?.updateTime)
        ) throw new HttpError(409, "test conflict");
        writes.push(structuredClone(write));
        revision += 1;
        document = {
          data: Object.fromEntries(Object.entries(write.update.fields).map(([key, value]) => [key, Number(value.integerValue)])),
          updateTime: `revision-${revision}`,
        };
      },
    },
  };
}

test("public POST accepts only the three fixed event names and never passes request details to storage", async () => {
  const calls = [];
  const handler = createHomepageCountHandler({
    now: () => NOW,
    async incrementHomepageCount(...args) { calls.push(args); },
  });
  for (const event of HOMEPAGE_EVENTS) {
    const response = await handler({ request: post({ event }, { headers: { "User-Agent": "test-sensitive-user-agent", "CF-Connecting-IP": "192.0.2.1" } }), env: ENV });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(await response.text(), "");
    assert.deepEqual(calls.at(-1), [ENV, event, NOW]);
  }
});

test("public endpoint rejects other methods, untrusted origins, preview hosts and cross-site fetches", async () => {
  let writes = 0;
  const handler = createHomepageCountHandler({ async incrementHomepageCount() { writes += 1; } });
  for (const request of [
    new Request(`${ORIGIN}/api/analytics/homepage`),
    post(undefined, { headers: { Origin: "https://evil.example" } }),
    post(undefined, { headers: { Origin: "null" } }),
    post(undefined, { origin: "https://preview.asher-healthcare.pages.dev" }),
    post(undefined, { origin: "http://asherhealthcare.in" }),
    post(undefined, { headers: { "Sec-Fetch-Site": "cross-site" } }),
    post(undefined, { headers: { "Sec-Fetch-Site": "same-site" } }),
  ]) {
    const response = await handler({ request, env: ENV });
    assert.ok([403, 405].includes(response.status));
  }
  const missingOrigin = post();
  missingOrigin.headers.delete("Origin");
  assert.equal((await handler({ request: missingOrigin, env: ENV })).status, 403);
  assert.equal(writes, 0);
});

test("www works only as its own same origin, and testing origins require explicit injection", () => {
  assert.doesNotThrow(() => assertHomepageOrigin(post(undefined, { origin: "https://www.asherhealthcare.in" })));
  assert.throws(() => assertHomepageOrigin(post(undefined, { headers: { Origin: "https://www.asherhealthcare.in" } })), { status: 403 });
  const localRequest = post(undefined, { origin: "http://127.0.0.1:4318" });
  assert.throws(() => assertHomepageOrigin(localRequest), { status: 403 });
  assert.doesNotThrow(() => assertHomepageOrigin(localRequest, { allowedOrigins: ["http://127.0.0.1:4318"] }));
});

test("GPC and DNT suppress server recording before parsing any event body", async () => {
  let writes = 0;
  const handler = createHomepageCountHandler({ async incrementHomepageCount() { writes += 1; } });
  for (const headers of [{ "Sec-GPC": "1" }, { DNT: "1" }]) {
    const response = await handler({ request: post("not json", { headers }), env: ENV });
    assert.equal(response.status, 204);
  }
  assert.equal(writes, 0);
});

test("malformed, extra-field, unsupported, credential-bearing and query payloads never reach storage", async () => {
  let writes = 0;
  const handler = createHomepageCountHandler({ async incrementHomepageCount() { writes += 1; } });
  const requests = [
    ...[{}, [], null, 1, "invalid json", { event: "appointment" }, { event: { name: "call_click" } }, { event: "call_click", patient: "private" }, { event: "call_click", url: "private" }, { event: "call_click", visitorId: "private" }].map((body) => post(body)),
    post(undefined, { path: "/api/analytics/homepage?gclid=private" }),
    post(undefined, { headers: { Cookie: "private=value" } }),
    post(undefined, { headers: { Authorization: "Bearer private" } }),
    post(undefined, { headers: { "Content-Type": "text/plain" } }),
    post(undefined, { headers: { "Content-Type": "application/jsonp" } }),
    post(undefined, { headers: { "Content-Encoding": "gzip" } }),
    post(undefined, { headers: { "Content-Length": "999999" } }),
    post(undefined, { headers: { "Content-Length": "invalid" } }),
    post(" ".repeat(HOMEPAGE_BODY_LIMIT + 1)),
  ];
  for (const request of requests) {
    const response = await handler({ request, env: ENV });
    assert.ok([400, 413, 415].includes(response.status));
    assert.doesNotMatch(await response.text(), /private|gclid|visitorId|patient/iu);
  }
  assert.equal(writes, 0);
});

test("stream reader cancels oversized requests without trusting Content-Length", async () => {
  let cancelled = false;
  let produced = 0;
  const request = new Request(`${ORIGIN}/api/analytics/homepage`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": "1" },
    duplex: "half",
    body: new ReadableStream({
      pull(controller) {
        produced += 1;
        controller.enqueue(new Uint8Array(128));
      },
      cancel() { cancelled = true; },
    }),
  });
  await assert.rejects(readHomepageEvent(request), { status: 413 });
  assert.equal(cancelled, true);
  assert.ok(produced <= 4);
});

test("JSON charset is accepted, but empty and invalid UTF-8 bodies are rejected", async () => {
  assert.equal(await readHomepageEvent(post({ event: "call_click" }, { headers: { "Content-Type": "application/json; charset=utf-8" } })), "call_click");
  await assert.rejects(readHomepageEvent(post("")), { status: 400 });
  const request = post(undefined, { body: new Uint8Array([0xff]) });
  await assert.rejects(readHomepageEvent(request), { status: 400 });
});

test("only daily integer aggregates are written, with no raw request or visitor data", async () => {
  const memory = store();
  await incrementHomepageCount(ENV, "call_click", NOW, memory.dependencies);
  await incrementHomepageCount(ENV, "homepage_view", NOW, memory.dependencies);
  assert.deepEqual(memory.document().data, { homepage_view: 1, call_click: 1, directions_click: 0 });
  assert.deepEqual(memory.reads, ["homepageMetrics/2026-09-25", "homepageMetrics/2026-09-25"]);
  for (const write of memory.writes) {
    assert.deepEqual(Object.keys(write.update.fields).sort(), [...HOMEPAGE_EVENTS].sort());
    assert.match(write.update.name, /\/homepageMetrics\/2026-09-25$/u);
    assert.doesNotMatch(JSON.stringify(write), /patient|cookie|userAgent|visitor|fingerprint|gclid|timestamp|192\.0\.2\.1/iu);
    for (const value of Object.values(write.update.fields)) assert.deepEqual(Object.keys(value), ["integerValue"]);
  }
  assert.deepEqual(memory.writes[0].currentDocument, { exists: false });
  assert.deepEqual(memory.writes[1].currentDocument, { updateTime: "revision-2" });
  assert.deepEqual(memory.writes[1].updateMask.fieldPaths, HOMEPAGE_EVENTS);
});

test("clinic day changes at IST midnight, not UTC midnight", () => {
  assert.equal(homepageDate(new Date("2026-09-25T18:29:59.999Z")), "2026-09-25");
  assert.equal(homepageDate(new Date("2026-09-25T18:30:00.000Z")), "2026-09-26");
  assert.throws(() => homepageDate(new Date("invalid")), { status: 503 });
});

test("CAS retries preserve simultaneous updates without lost counts", async () => {
  const memory = store();
  const results = await Promise.all(HOMEPAGE_EVENTS.map((event) => incrementHomepageCount(ENV, event, NOW, memory.dependencies)));
  assert.ok(results.every((result) => result.recorded));
  assert.deepEqual(memory.document().data, { homepage_view: 1, call_click: 1, directions_click: 1 });
  assert.equal(memory.writes.length, 3);
});

test("daily global cap prevents extra writes, including racing requests", async () => {
  const memory = store({ homepage_view: HOMEPAGE_DAILY_LIMIT - 1, call_click: 0, directions_click: 0 });
  const results = await Promise.all(HOMEPAGE_EVENTS.map((event) => incrementHomepageCount(ENV, event, NOW, memory.dependencies)));
  assert.equal(results.filter((result) => result.recorded).length, 1);
  assert.equal(memory.writes.length, 1);
  assert.equal(Object.values(memory.document().data).reduce((sum, count) => sum + count), HOMEPAGE_DAILY_LIMIT);
  assert.deepEqual(await incrementHomepageCount(ENV, "call_click", NOW, memory.dependencies), { recorded: false });
  assert.equal(memory.writes.length, 1);
});

test("retries are bounded and invalid aggregate data fails closed", async () => {
  let attempts = 0;
  await assert.rejects(incrementHomepageCount(ENV, "call_click", NOW, {
    async getDocument() { return null; },
    async commitWrites() { attempts += 1; throw new HttpError(409, "conflict"); },
  }), { status: 503 });
  assert.equal(attempts, HOMEPAGE_MAX_ATTEMPTS);
  await assert.rejects(incrementHomepageCount(ENV, "call_click", NOW, {
    async getDocument() { return { data: { homepage_view: 0, call_click: 0, directions_click: 0 } }; },
    async commitWrites() { assert.fail("An existing aggregate must have a CAS revision."); },
  }), { status: 503 });
  for (const data of [
    { homepage_view: -1, call_click: 0, directions_click: 0 },
    { homepage_view: 1.5, call_click: 0, directions_click: 0 },
    { homepage_view: 0, call_click: 0 },
    { homepage_view: 0, call_click: 0, directions_click: 0, patient: "private" },
    { homepage_view: HOMEPAGE_DAILY_LIMIT + 1, call_click: 0, directions_click: 0 },
  ]) {
    const memory = store(data);
    await assert.rejects(incrementHomepageCount(ENV, "call_click", NOW, memory.dependencies), { status: 503 });
    assert.equal(memory.writes.length, 0);
  }
});

test("public failures never expose internal errors or log request-bearing exceptions", async () => {
  const handler = createHomepageCountHandler({ async incrementHomepageCount() { throw new Error("private-database-request-details"); } });
  const response = await handler({ request: post(), env: ENV });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Measurement temporarily unavailable." });
  for (const filename of ["../server/analytics/homepage-counts.js", "../functions/api/analytics/homepage.js", "../functions/api/admin/homepage-counts.js"]) {
    const source = readFileSync(new URL(filename, import.meta.url), "utf8");
    assert.doesNotMatch(source, /console\.(?:log|error|warn|info)|CF-Connecting-IP|User-Agent|X-Forwarded-For/u);
  }
});

test("admin report authenticates before storage and accepts browser same-origin GET", async () => {
  const calls = [];
  const handler = createHomepageReportHandler({
    async requireAdminStaff(request, env) {
      assert.equal(request.headers.get("Authorization"), "Bearer test-only");
      assert.equal(env, ENV);
      calls.push("auth");
      return { uid: "private-admin-id", role: "admin" };
    },
    now: () => NOW,
    async getHomepageCounts(...args) { calls.push(args); return { totals: {} }; },
  });
  const response = await handler({ request: get(), env: ENV });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.deepEqual(calls, ["auth", [ENV, 7, NOW]]);
  assert.doesNotMatch(await response.text(), /private-admin-id/u);
});

test("admin report rejects absent auth, nonadmins, bad origins, methods and unbounded ranges", async () => {
  let reads = 0;
  const base = {
    async requireAdminStaff() { return { role: "admin" }; },
    async getHomepageCounts() { reads += 1; return {}; },
  };
  for (const role of ["doctor", "reception", null]) {
    const handler = createHomepageReportHandler({ ...base, async requireAdminStaff() { return { role }; } });
    assert.equal((await handler({ request: get(), env: ENV })).status, 403);
  }
  const unsigned = createHomepageReportHandler({ ...base, async requireAdminStaff() { throw new HttpError(401, "private auth details"); } });
  assert.equal((await unsigned({ request: get(), env: ENV })).status, 401);
  const handler = createHomepageReportHandler(base);
  for (const request of [
    get("/api/admin/homepage-counts?days=365"),
    get("/api/admin/homepage-counts?days=7&days=30"),
    get("/api/admin/homepage-counts?visitor=private"),
    get("/api/admin/homepage-counts?days=30&extra=1"),
    get("/api/admin/homepage-counts", { Origin: "https://evil.example" }),
    get("/api/admin/homepage-counts", { "Sec-Fetch-Site": "cross-site" }),
    new Request(`${ORIGIN}/api/admin/homepage-counts`),
    post(undefined, { path: "/api/admin/homepage-counts" }),
  ]) {
    assert.ok([400, 403, 405].includes((await handler({ request, env: ENV })).status));
  }
  assert.equal(reads, 0);
});

test("reports have bounded 7/30 day reads, ascending IST dates and no misleading attribution", async () => {
  for (const days of [7, 30]) {
    const paths = [];
    const report = await getHomepageCounts(ENV, days, NOW, {
      async getDocument(env, path) {
        assert.equal(env, ENV);
        paths.push(path);
        return path.endsWith("2026-09-25") ? { data: { homepage_view: 5, call_click: 2, directions_click: 1 } } : null;
      },
    });
    assert.equal(paths.length, days);
    assert.ok(paths.every((path) => /^homepageMetrics\/\d{4}-\d{2}-\d{2}$/u.test(path)));
    assert.equal(report.timezone, "Asia/Kolkata");
    assert.equal(report.days, days);
    assert.equal(report.rows.length, days);
    assert.equal(report.rows.at(-1).date, "2026-09-25");
    assert.deepEqual(report.rows.map(({ date }) => date), report.rows.map(({ date }) => date).sort());
    assert.deepEqual(report.rows[0], { date: days === 7 ? "2026-09-19" : "2026-08-27", homepage_view: 0, call_click: 0, directions_click: 0 });
    assert.deepEqual(report.totals, { homepage_view: 5, call_click: 2, directions_click: 1 });
    assert.match(report.note, /not unique visitors, completed calls, visits, appointments or Google Ads conversions/u);
  }
});

test("report reads use bounded parallel batches and preserve chronological results", async () => {
  let active = 0;
  let peak = 0;
  let started = 0;
  const completionDates = [];
  const report = await getHomepageCounts(ENV, 30, NOW, {
    async getDocument(env, path) {
      assert.equal(env, ENV);
      const index = started;
      started += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, (HOMEPAGE_REPORT_CONCURRENCY - index % HOMEPAGE_REPORT_CONCURRENCY) * 3));
      active -= 1;
      completionDates.push(path.slice("homepageMetrics/".length));
      return { data: { homepage_view: index, call_click: 0, directions_click: 0 } };
    },
  });
  assert.equal(started, 30);
  assert.equal(peak, HOMEPAGE_REPORT_CONCURRENCY);
  assert.equal(active, 0);
  const dates = report.rows.map(({ date }) => date);
  assert.deepEqual(dates, [...dates].sort());
  assert.notDeepEqual(completionDates, dates);
  assert.deepEqual(report.rows.map(({ homepage_view }) => homepage_view), Array.from({ length: 30 }, (_, index) => index));
  assert.equal(report.totals.homepage_view, 435);
});

test("current Firestore rules deny unknown collections without making homepageMetrics client-readable", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/u);
  assert.doesNotMatch(rules, /match \/homepageMetrics/u);
});
