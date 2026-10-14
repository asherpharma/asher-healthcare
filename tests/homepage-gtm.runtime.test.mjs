import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { crossesHomepageBoundary, homepageGtmAllowed, installHomepageGtm, legacyBookingDestination, leaveTaggedErrorPage } from "../src/lib/homepage-gtm.mjs";

function harness(url = "https://asherhealthcare.in/", privacy = {}) {
  let current = new URL(url);
  const actions = [];
  const scripts = [];
  const handlers = new Map();
  const document = {
    head: { appendChild: script => scripts.push(script) },
    createElement: name => ({ name }),
    addEventListener: (name, fn) => handlers.set(`doc:${name}`, fn),
  };
  const location = {
    get protocol() { return current.protocol; }, get hostname() { return current.hostname; },
    get pathname() { return current.pathname; }, get search() { return current.search; },
    get hash() { return current.hash; }, get href() { return current.href; }, get origin() { return current.origin; },
    assign: href => actions.push(["assign", href]), replace: href => actions.push(["replace", href]),
    reload: () => actions.push(["reload"]),
  };
  const history = Object.fromEntries(["pushState", "replaceState"].map(method => [method, (state, unused, href) => {
    if (href != null) current = new URL(href, current);
    actions.push([method, href]);
  }]));
  const window = {
    location, history, addEventListener: (name, fn) => handlers.set(name, fn),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, options) {
        assert.equal(target, document.head);
        assert.deepEqual(options, { childList: true, subtree: true, characterData: true });
        handlers.set("head:mutation", this.callback);
      }
    },
  };
  const navigator = { doNotTrack: "0", globalPrivacyControl: false, ...privacy };
  return {
    window, document, navigator, scripts, actions, handlers,
    install: () => installHomepageGtm(window, document, navigator),
    move: href => { current = new URL(href, current); },
    click: (href, extras = {}) => {
      let prevented = false;
      const link = { href: new URL(href, current).href, hasAttribute: () => false, target: "", ...extras.link };
      handlers.get("doc:click")?.({ button: 0, preventDefault: () => { prevented = true; }, stopImmediatePropagation() {}, target: { closest: () => link }, ...extras });
      return prevented;
    },
  };
}

test("the loader is limited to the HTTPS production homepage without parameters", () => {
  for (const url of [
    "https://asherhealthcare.in/book", "https://asherhealthcare.in/book#appointment-obg",
    "https://asherhealthcare.in/care/pediatrics", "https://asherhealthcare.in/care/womens-health",
    "https://asherhealthcare.in/care/general-care-lab-tests", "https://asherhealthcare.in/admin/settings",
    "https://asherhealthcare.in/portal/login", "https://asherhealthcare.in/privacy", "https://asherhealthcare.in/404",
    "https://asherhealthcare.in/?patient=private", "https://asherhealthcare.in/?source=installed-app",
    "https://asherhealthcare.in/#unknown-patient-context", "http://asherhealthcare.in/",
    "https://feature-test.asher-healthcare.pages.dev/", "https://evil-asherhealthcare.in/", "http://localhost/",
  ]) {
    const app = harness(url); app.install();
    assert.equal(app.scripts.length, 0, url);
    assert.equal(app.window.dataLayer, undefined, url);
  }
  for (const url of ["https://asherhealthcare.in/", "https://www.asherhealthcare.in/", "https://asherhealthcare.in/#top", "https://asherhealthcare.in/#contact"]) {
    const app = harness(url); app.install(); assert.equal(app.scripts.length, 1, url);
  }
});

test("legacy booking destinations preserve fragment priority and strip all other input", () => {
  for (const [suffix, expected] of [
    ["#appointment", "/book"], ["#appointment-pediatrics", "/book#appointment-pediatrics"],
    ["#appointment-obg", "/book#appointment-obg"], ["?care=obg#appointment", "/book#appointment-obg"],
    ["?care=pediatrics#appointment-obg", "/book#appointment-obg"],
    ["?care=obg&phone=private&reason=private", "/book#appointment-obg"],
    ["?care=invalid", "/book"], ["#appointment-unknown", "/book"], ["#visit", "/book#visit"],
  ]) {
    const app = harness(`https://asherhealthcare.in/${suffix}`);
    assert.equal(legacyBookingDestination(app.window.location), expected);
    app.install();
    assert.deepEqual(app.actions, [["replace", expected]]);
    assert.equal(app.scripts.length, 0);
    assert.equal(app.window.dataLayer, undefined);
  }
  assert.equal(legacyBookingDestination(new URL("https://asherhealthcare.in/book?care=obg")), null);
});

test("opaque ad arrivals are cleaned before Google initialization without retaining click identifiers", () => {
  for (const suffix of ["?gclid=Opaque_test-1", "?wbraid=Opaque_1&gad_source=1", "?gbraid=Opaque-1&gad_campaignid=12345#top"]) {
    const app = harness(`https://asherhealthcare.in/${suffix}`); app.install();
    assert.equal(app.window.location.search, ""); assert.equal(app.scripts.length, 1);
    assert.equal(app.actions[0][0], "replaceState");
    assert.ok(!JSON.stringify(app.window.dataLayer).includes("Opaque"));
  }
  for (const suffix of ["?gclid=Opaque&patient=private", "?gclid=one&gclid=two", "?gclid=contains%20words", "?utm_campaign=medical", "?gtm_preview=env-1", "?gad_source="]) {
    const app = harness(`https://asherhealthcare.in/${suffix}`); app.install();
    assert.equal(app.scripts.length, 0); assert.equal(app.actions.length, 0);
  }
  const booking = harness("https://asherhealthcare.in/?gclid=Opaque&care=obg#appointment"); booking.install();
  assert.deepEqual(booking.actions, [["replace", "/book#appointment-obg"]]);
  assert.equal(booking.scripts.length, 0);
});

test("DNT and GPC skip Google entirely; restoring a page after opting out reloads it", () => {
  for (const privacy of [{ doNotTrack: "1" }, { globalPrivacyControl: true }]) {
    const app = harness(undefined, privacy); app.install();
    assert.equal(app.scripts.length, 0); assert.equal(app.window.dataLayer, undefined);
  }
  const app = harness(); app.install(); app.navigator.globalPrivacyControl = true;
  app.handlers.get("pageshow")();
  assert.deepEqual(app.actions, [["reload"]]);
  assert.equal(homepageGtmAllowed(app.window.location, app.navigator), false);
});

test("installation is once per document with denied privacy defaults before the approved native tags", () => {
  const app = harness(); app.install(); app.install();
  assert.equal(app.scripts.length, 1);
  const script = app.scripts[0];
  assert.equal(script.name, "script"); assert.equal(script.async, true);
  assert.equal(script.referrerPolicy, "no-referrer");
  assert.equal(app.document.title, "Asher Healthcare");
  assert.equal(script.src, "https://www.googletagmanager.com/gtm.js?id=GTM-TQC7XR38");
  assert.deepEqual(app.window.dataLayer[0], { "gtm.allowlist": ["googtag", "gclidw", "awct", "lcl", "e", "v", "u", "f", "aev"] });
  const consent = Array.from(app.window.dataLayer[1]);
  assert.deepEqual(consent.slice(0, 2), ["consent", "default"]);
  assert.ok(Object.values(consent[2]).every(value => value === "denied"));
  const settings = Array.from(app.window.dataLayer[2])[1];
  assert.equal(settings.allow_ad_personalization_signals, false);
  assert.equal(settings.allow_enhanced_conversions, false);
  assert.equal(settings.ads_data_redaction, true);
  assert.equal(settings.restricted_data_processing, true);
  assert.equal(settings.url_passthrough, false);
  assert.equal(settings.page_location, "https://asherhealthcare.in/");
  assert.equal(settings.page_referrer, "");
  assert.equal(settings.page_title, "Asher Healthcare");
  assert.deepEqual(Object.keys(app.window.dataLayer[3]), ["gtm.start", "event"]);
  assert.equal(app.window.dataLayer[3].event, "gtm.js");
  assert.equal(app.window.dataLayer.length, 4);
});

test("tagged document metadata remains neutral while navigation and BFCache callbacks settle", () => {
  const app = harness(); app.install();
  app.document.title = "Excluded medical page";
  app.handlers.get("head:mutation")();
  assert.equal(app.document.title, "Asher Healthcare");
  app.document.title = "Restored sensitive title";
  app.handlers.get("pageshow")();
  assert.equal(app.document.title, "Asher Healthcare");
  assert.equal(app.scripts.length, 1);
  const excluded = harness("https://asherhealthcare.in/book"); excluded.install();
  assert.equal(excluded.handlers.has("head:mutation"), false);
});

test("native and keyboard-generated booking clicks load a new document without changing the home URL", () => {
  const app = harness(); app.install();
  assert.equal(app.click("/book#appointment-obg"), true);
  assert.deepEqual(app.actions, [["assign", "https://asherhealthcare.in/book#appointment-obg"]]);
  assert.equal(app.window.location.href, "https://asherhealthcare.in/");
  app.actions.length = 0;
  assert.equal(app.click("#appointment-obg"), true);
  assert.deepEqual(app.actions, [["assign", "https://asherhealthcare.in/book#appointment-obg"]]);
  for (const extras of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { link: { target: "_blank" } }, { link: { hasAttribute: () => true } }]) {
    app.actions.length = 0; assert.equal(app.click("/book", extras), false); assert.equal(app.actions.length, 0);
  }
  assert.equal(app.click("tel:+919019263709"), false);
  assert.equal(app.click("https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5"), false);
  assert.equal(app.click("#top"), false);
  assert.equal(app.click("#main-content"), false);
});

test("programmatic navigation cannot reuse the tagged document for booking or private pages", () => {
  for (const method of ["pushState", "replaceState"]) {
    for (const path of ["/book#appointment-obg", "/admin/login", "/portal/login", "/care/pediatrics", "/?care=obg#appointment"]) {
      const app = harness(); app.install(); app.window.history[method]({}, "", path);
      assert.equal(app.actions[0][0], method === "replaceState" ? "replace" : "assign");
      assert.equal(app.window.location.pathname, "/");
      assert.ok(!app.actions[0][1].includes("?care="));
    }
  }
  const app = harness(); app.install(); app.window.history.pushState({}, "", "#unknown-context");
  assert.deepEqual(app.actions, [["assign", "https://asherhealthcare.in/?untracked=1#unknown-context"]]);
});

test("back/forward, direct hash changes, and BFCache checks force the boundary", () => {
  for (const event of ["popstate", "hashchange", "pageshow"]) {
    const app = harness(); app.install(); app.move("/book#appointment-obg"); app.handlers.get(event)();
    assert.deepEqual(app.actions, [["reload"]]);
  }
  const app = harness(); app.install(); app.move("#appointment-pediatrics"); app.handlers.get("hashchange")();
  assert.deepEqual(app.actions, [["replace", "/book#appointment-pediatrics"]]);
  for (const [initial, next, expected] of [["/", "/book", true], ["/book", "/", true], ["/", "/care/pediatrics", true], ["/", "/", false], ["/admin", "/admin/patients", false]]) {
    assert.equal(crossesHomepageBoundary(initial, next), expected);
  }
});

test("homepage and booking are separated in the route tree without an unconditional Google fallback", () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.doesNotMatch(read("src/app/page.tsx"), /AppointmentCTA|<form/u);
  assert.match(read("src/app/page.tsx"), /<HomepageGtm \/>/u);
  assert.match(read("src/app/page.tsx"), /title: \{ absolute: "Asher Healthcare" \}/u);
  assert.match(read("src/app/book/page.tsx"), /<AppointmentCTA \/>/u);
  assert.doesNotMatch(read("src/app/book/page.tsx"), /HomepageGtm|googletagmanager/u);
  assert.match(read("src/app/book/page.tsx"), /canonical: "\/book"/u);
  assert.match(read("src/app/layout.tsx"), /<HomepageDocumentBoundary>\{children\}<\/HomepageDocumentBoundary>/u);
  assert.doesNotMatch(read("src/app/layout.tsx"), /<HomepageGtm|googletagmanager/u);
  assert.doesNotMatch(read("src/components/analytics/HomepageGtm.tsx"), /<iframe|ns\.html/u);
  for (const path of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
    assert.match(read(path), /leaveTaggedErrorPage\(window\)/u);
  }
});

test("error recovery leaves a tagged document without replaying any appointment action", () => {
  const app = harness(); leaveTaggedErrorPage(app.window); assert.equal(app.actions.length, 0);
  app.install(); leaveTaggedErrorPage(app.window);
  assert.deepEqual(app.actions, [["replace", "/?untracked=1"]]);
  const recovery = harness("https://asherhealthcare.in/?untracked=1");
  recovery.install(); leaveTaggedErrorPage(recovery.window);
  assert.equal(recovery.scripts.length, 0); assert.equal(recovery.actions.length, 0);
});
