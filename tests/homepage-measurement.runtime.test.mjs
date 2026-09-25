import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/analytics/HomepageMeasurement.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ pathname = "/", hostname = "asherhealthcare.in", protocol = "https:", dnt, gpc, hidden = false, rejects = false, throws = false } = {}) {
  const handlers = new Map();
  const requests = [];
  let cleanup;
  let now = 5000;
  let hookPath = pathname;
  class Element {
    constructor(href) { this.href = href; }
    closest() { return this; }
    getAttribute(name) { return name === "href" ? this.href : null; }
  }
  const document = {
    visibilityState: hidden ? "hidden" : "visible",
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name, fn) => { if (handlers.get(name) === fn) handlers.delete(name); },
  };
  const window = { location: { pathname, hostname, protocol } };
  const navigator = { doNotTrack: dnt, globalPrivacyControl: gpc };
  const exports = {};
  const context = vm.createContext({
    exports, document, window, navigator, Element, performance: { now: () => now },
    fetch: (url, options) => {
      requests.push({ url, options });
      if (throws) throw new Error("blocked");
      return rejects ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: true });
    },
    require: (name) => {
      if (name === "react") return { useEffect: (fn) => { cleanup?.(); cleanup = fn(); } };
      if (name === "next/navigation") return { usePathname: () => hookPath };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  vm.runInContext(compiled, context);
  const render = () => exports.HomepageMeasurement();
  assert.equal(render(), null);
  return {
    requests, document, window, navigator, handlers, render,
    advance: (ms) => { now += ms; },
    move: (path) => { window.location.pathname = path; hookPath = path; render(); },
    click: (href, extras = {}) => handlers.get("click")?.({ target: new Element(href), isTrusted: true, defaultPrevented: false, ...extras }),
    visible: () => { document.visibilityState = "visible"; handlers.get("visibilitychange")?.(); },
    cleanup: () => cleanup?.(),
  };
}

test("automatic homepage request has only a fixed event and no cookies or referrer", () => {
  const app = harness();
  assert.equal(app.requests.length, 1);
  const { url, options } = app.requests[0];
  assert.equal(url, "/api/analytics/homepage");
  assert.equal(options.body, '{"event":"homepage_view"}');
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.mode, "same-origin");
  assert.equal(options.cache, "no-store");
  assert.equal(options.keepalive, true);
  assert.deepEqual(Object.keys(options.headers), ["Content-Type"]);
});

test("only exact clinic Call and Directions trusted clicks are counted without interception", () => {
  const app = harness();
  app.click("tel:+919019263709");
  app.click("https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5");
  app.click("tel:+919999999999");
  app.click("https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5?patient=private");
  app.click("/care/womens-health");
  app.click("tel:+919019263709", { isTrusted: false });
  app.click("tel:+919019263709", { defaultPrevented: true });
  assert.deepEqual(app.requests.map(r => JSON.parse(r.options.body).event), ["homepage_view", "call_click", "directions_click"]);
  assert.doesNotMatch(source, /preventDefault|stopPropagation|sendBeacon/u);
});

test("reload-independent in-memory dedupe limits rapid repeats without persistent identifiers", () => {
  const app = harness();
  app.render();
  app.visible();
  app.click("tel:+919019263709");
  app.click("tel:+919019263709");
  app.advance(1501);
  app.click("tel:+919019263709");
  assert.equal(app.requests.length, 3);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|randomUUID|Math\.random|userAgent/u);
});

test("medical pages, portals, previews and non-HTTPS hosts send nothing", () => {
  for (const pathname of ["/care/pediatrics", "/care/womens-health", "/privacy", "/admin", "/portal/login"]) {
    const app = harness({ pathname });
    app.click("tel:+919019263709");
    assert.equal(app.requests.length, 0, pathname);
  }
  for (const hostname of ["localhost", "127.0.0.1", "preview.asher-healthcare.pages.dev", "evil-asherhealthcare.in"]) assert.equal(harness({ hostname }).requests.length, 0);
  assert.equal(harness({ protocol: "http:" }).requests.length, 0);
  assert.equal(harness({ hostname: "www.asherhealthcare.in" }).requests.length, 1);
});

test("Do Not Track and Global Privacy Control suppress all counters", () => {
  for (const choice of [{ dnt: "1" }, { gpc: true }]) {
    const app = harness(choice);
    app.click("tel:+919019263709");
    assert.equal(app.requests.length, 0);
  }
  const app = harness();
  app.navigator.globalPrivacyControl = true;
  app.click("tel:+919019263709");
  assert.equal(app.requests.length, 1);
});

test("hidden pages wait until visible; navigation and cleanup stop later clicks", () => {
  const app = harness({ hidden: true });
  assert.equal(app.requests.length, 0);
  app.visible();
  assert.equal(app.requests.length, 1);
  app.move("/portal/login");
  app.click("tel:+919019263709");
  assert.equal(app.requests.length, 1);
  app.move("/");
  assert.equal(app.requests.length, 1);
  app.cleanup();
  assert.equal(app.handlers.size, 0);
});

test("network failures never block normal clinic navigation", async () => {
  assert.doesNotThrow(() => harness({ throws: true }).click("tel:+919019263709"));
  const app = harness({ rejects: true });
  app.click("https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5");
  await Promise.resolve();
  assert.equal(app.requests.length, 2);
});

test("active measurement contains no advertising scripts, page context or form extraction", () => {
  assert.doesNotMatch(source, /gtag|dataLayer|googletagmanager|createElement|document\.(?:title|referrer|forms)|location\.(?:href|search|hash)|FormData|querySelector|input|consent|AdsClickMeasurement/u);
  const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /<HomepageMeasurement \/>/u);
  assert.doesNotMatch(layout, /AdsClickMeasurement|GoogleAnalytics|GoogleTagManager/u);
});
