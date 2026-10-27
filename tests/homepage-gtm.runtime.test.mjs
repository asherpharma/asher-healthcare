import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  crossesHomepageBoundary, homepageGtmAllowed, installHomepageGtm, legacyBookingDestination,
  leaveTaggedErrorPage, createHomepageGtmBootstrap, GOOGLE_GTM_SOURCE,
  getHomepageConsent, setHomepageConsent,
} from "../src/lib/homepage-gtm.mjs";

// Independently retain Google's published source: two generated exports could
// otherwise agree while silently changing the provider's installation code.
const originalGoogleSource = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-TQC7XR38');`;
const PREFERENCE_KEY = "asher.homepage.measurement.v1";
const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
const choiceRecord = (choice = "accepted", expiresAt = Date.now() + MAX_AGE) => ({ v: 1, choice, expiresAt });
const plain = value => JSON.parse(JSON.stringify(value));

function harness(url = "https://asherhealthcare.in/", privacy = {}, options = {}) {
  let current = new URL(url);
  const actions = [], scripts = [], inlineScripts = [], providerRuns = [], operations = [], nodes = [];
  const cookieWrites = [], transportRequests = [], handlers = new Map(), timers = new Map();
  const storage = new Map(Object.entries(options.storage ?? {}));
  const sessionStorage = new Map(Object.entries(options.sessionStorage ?? {}));
  const cookieJar = new Map(Object.entries(options.cookies ?? {}));
  let nextTimer = 0;
  let window, navigator;
  class Element {
    constructor(name) { this.name = name; this.tagName = name.toUpperCase(); }
    setAttribute(name, value) { transportRequests.push(["attribute", this.tagName, name, value]); }
  }
  const elementTypes = Object.fromEntries(["image", "script", "iframe"].map(name => {
    class TypedElement extends Element { constructor() { super(name === "image" ? "img" : name); } }
    Object.defineProperty(TypedElement.prototype, "src", {
      configurable: true,
      get() { return this._src; },
      set(value) { this._src = value; transportRequests.push(["src", this.tagName, value]); },
    });
    return [name, TypedElement];
  }));
  class XMLHttpRequest {
    open(method, url) { this.url = url; this.method = method; }
    send() { transportRequests.push(["xhr", this.url]); }
    abort() { this.aborted = true; }
  }
  const head = {
    appendChild(script) {
      script.parentNode = head; nodes.push(script);
      assert.equal(script.src, undefined, "Only the unchanged provider source creates the external loader.");
      inlineScripts.push(script); operations.push(["appendInline", script.id]);
      providerRuns.push({ source: script.textContent, dataLayerBefore: plain(window.dataLayer ?? []) });
      runInNewContext(script.textContent, { window, document, navigator, URL, URLSearchParams });
      return script;
    },
    insertBefore(script, reference) {
      const index = nodes.indexOf(reference);
      assert.ok(index >= 0, "Google inserts before an existing script node.");
      assert.equal(reference.parentNode, head);
      script.parentNode = head; nodes.splice(index, 0, script); scripts.push(script);
      operations.push(["insertExternal", script.src]); return script;
    },
  };
  nodes.push({ name: "script", id: "parser-bootstrap-fixture", parentNode: head });
  const document = {
    head, visibilityState: "visible",
    createElement: name => elementTypes[name] ? new elementTypes[name]() : new Element(name),
    getElementsByTagName: name => nodes.filter(node => node.name === name),
    getElementById: id => nodes.find(node => node.id === id) ?? null,
    addEventListener: (name, fn) => handlers.set(`doc:${name}`, fn),
    dispatchEvent: event => { handlers.get(`doc:${event.type}`)?.(event); return true; },
  };
  Object.defineProperty(document, "cookie", {
    get: () => [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; "),
    set: value => {
      cookieWrites.push(value);
      const [pair] = value.split(";"); const index = pair.indexOf("="); const name = pair.slice(0, index).trim();
      if (/max-age\s*=\s*0|expires\s*=\s*(?:Thu, 01 Jan 1970|Thu, 1 Jan 1970)/iu.test(value)) cookieJar.delete(name);
      else cookieJar.set(name, pair.slice(index + 1));
    },
  });
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
  const localStorage = {
    getItem: key => { if (options.storageUnavailable) throw new Error("Storage unavailable"); return storage.get(key) ?? null; },
    setItem: (key, value) => { if (options.storageUnavailable) throw new Error("Storage unavailable"); storage.set(key, String(value)); },
    removeItem: key => { if (options.storageUnavailable) throw new Error("Storage unavailable"); storage.delete(key); },
  };
  class Event { constructor(type) { this.type = type; } }
  window = {
    location, history, localStorage,
    sessionStorage: { removeItem: key => sessionStorage.delete(key), getItem: key => sessionStorage.get(key) ?? null },
    Event, CustomEvent: Event, Element, XMLHttpRequest,
    HTMLImageElement: elementTypes.image, HTMLScriptElement: elementTypes.script, HTMLIFrameElement: elementTypes.iframe,
    fetch: (input, init) => { transportRequests.push(["fetch", input, init]); return Promise.resolve({ ok: true }); },
    addEventListener: (name, fn) => handlers.set(name, fn),
    dispatchEvent: event => { handlers.get(event.type)?.(event); return true; },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearInterval: id => timers.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, observeOptions) {
        assert.equal(target, document.head);
        assert.deepEqual({ ...observeOptions }, { childList: true, subtree: true, characterData: true });
        handlers.set("head:mutation", this.callback);
      }
    },
  };
  navigator = {
    doNotTrack: "0", globalPrivacyControl: false,
    sendBeacon: (url, data) => { transportRequests.push(["beacon", url, data]); return true; },
    ...privacy,
  };
  window.navigator = navigator;
  return {
    window, document, navigator, scripts, inlineScripts, providerRuns, operations, actions, handlers,
    storage, sessionStorage, cookieJar, cookieWrites, transportRequests, timers,
    install: () => installHomepageGtm(window, document, navigator),
    consent: () => plain(getHomepageConsent(window, navigator)),
    choose: choice => setHomepageConsent(window, document, navigator, choice),
    move: href => { current = new URL(href, current); },
    bootstrap: () => runInNewContext(createHomepageGtmBootstrap(), { window, document, navigator, URL, URLSearchParams }),
    event: (name, extras = {}) => handlers.get(name)?.({ type: name, ...extras }),
    click: (href, extras = {}) => {
      let prevented = false;
      const link = { href: new URL(href, current).href, hasAttribute: () => false, target: "", ...extras.link };
      handlers.get("doc:click")?.({ button: 0, preventDefault: () => { prevented = true; }, stopImmediatePropagation() {}, target: { closest: () => link }, ...extras });
      return prevented;
    },
  };
}
function acceptedHarness(url, privacy = {}, options = {}) {
  return harness(url, privacy, { ...options, storage: { ...options.storage, [PREFERENCE_KEY]: JSON.stringify(choiceRecord()) } });
}
function commands(app, action) {
  return (app.window.dataLayer ?? []).filter(entry => entry[0] === "consent" && entry[1] === action).map(entry => plain(entry[2]));
}
function assertDenied(value) {
  assert.deepEqual(value, { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", personalization_storage: "denied" });
}
function assertAccepted(value) {
  assert.deepEqual(value, { ad_storage: "granted", analytics_storage: "denied", ad_user_data: "granted", ad_personalization: "denied", personalization_storage: "denied" });
}
function assertFreshDocument(app) {
  assert.ok(app.actions.some(action => action[0] === "reload" || (action[0] === "replace" && /^\/(?:#|\?untracked=1|$)/u.test(action[1]))), "Revocation must immediately leave the executed Google document.");
}

test("an eligible first visit has denied defaults but makes no Google request before a choice", () => {
  const app = harness(); app.install();
  assert.deepEqual(app.consent(), { eligible: true, choice: null });
  assert.equal(app.scripts.length, 0); assert.equal(app.inlineScripts.length, 0);
  assert.notEqual(app.window.__asherHomepageGtmLoaded, true);
  assert.equal(app.storage.size, 0, "Showing a choice does not write acceptance or visitor identifiers.");
  assertDenied(commands(app, "default")[0]); assert.equal(commands(app, "update").length, 0);
});

test("only affirmative consent executes Google's independently verified original source", () => {
  assert.equal(GOOGLE_GTM_SOURCE, originalGoogleSource);
  const app = harness(); app.install(); app.choose("accepted");
  assert.equal(app.inlineScripts.length, 1); assert.equal(app.inlineScripts[0].id, "asher-homepage-gtm-original");
  assert.equal(app.inlineScripts[0].textContent, originalGoogleSource);
  assert.deepEqual(app.operations.map(operation => operation[0]), ["appendInline", "insertExternal"]);
  assert.equal(app.scripts.length, 1);
  assert.equal(app.scripts[0].src, "https://www.googletagmanager.com/gtm.js?id=GTM-TQC7XR38");
  assert.equal(app.scripts[0].id, undefined); assert.equal(app.scripts[0].referrerPolicy, undefined);
  assert.equal(app.window.__asherHomepageGtmLoaded, true); assertAccepted(commands(app, "update")[0]);
});

test("accepted return visits restore consent after defaults and privacy settings, before one container starts", () => {
  const app = acceptedHarness(); app.install(); app.install(); app.choose("accepted");
  assert.equal(app.scripts.length, 1); assert.equal(app.inlineScripts.length, 1); assert.equal(app.providerRuns.length, 1);
  const before = app.providerRuns[0].dataLayerBefore;
  assert.deepEqual(before[0], { "gtm.allowlist": ["googtag", "gclidw", "awct", "lcl", "e", "v", "u", "f", "aev"] });
  const defaultIndex = before.findIndex(entry => entry[0] === "consent" && entry[1] === "default");
  const settingsIndex = before.findIndex(entry => entry[0] === "set");
  const updateIndex = before.findIndex(entry => entry[0] === "consent" && entry[1] === "update");
  assert.ok(defaultIndex >= 0 && settingsIndex > defaultIndex && updateIndex > settingsIndex);
  assertDenied(before[defaultIndex][2]); assertAccepted(before[updateIndex][2]);
  assert.ok(before.every(entry => !("gtm.start" in entry)), "Consent precedes the provider's gtm.js event.");
  const settings = before[settingsIndex][1];
  for (const key of ["allow_ad_personalization_signals", "allow_google_signals", "allow_enhanced_conversions", "url_passthrough"]) assert.equal(settings[key], false, key);
  assert.equal(settings.ads_data_redaction, true); assert.equal(settings.restricted_data_processing, true);
  assert.equal(settings.page_location, "https://asherhealthcare.in/");
  assert.equal(settings.page_referrer, ""); assert.equal(settings.page_title, "Asher Healthcare");
  assert.equal(app.window.dataLayer.filter(entry => entry.event === "gtm.js").length, 1);
  assert.equal(app.document.title, "Asher Healthcare");
});

test("decline is a durable preference and never starts Google, including on a return visit", () => {
  const app = harness(); app.install(); app.choose("declined");
  const record = JSON.parse(app.storage.get(PREFERENCE_KEY));
  assert.deepEqual(Object.keys(record).sort(), ["choice", "expiresAt", "v"]);
  assert.equal(record.v, 1); assert.equal(record.choice, "declined");
  assert.ok(record.expiresAt > Date.now() + MAX_AGE - 5000 && record.expiresAt <= Date.now() + MAX_AGE);
  assert.deepEqual(app.consent(), { eligible: true, choice: "declined" });
  assert.equal(app.scripts.length, 0); assert.equal(app.providerRuns.length, 0);
  assert.equal(commands(app, "update").some(value => value.ad_storage === "granted"), false);
  const returning = harness(undefined, {}, { storage: Object.fromEntries(app.storage) }); returning.install();
  assert.deepEqual(returning.consent(), { eligible: true, choice: "declined" }); assert.equal(returning.scripts.length, 0);
});

test("preference storage contains no identity or click identifier and expires within 180 days", () => {
  const app = harness("https://asherhealthcare.in/?gclid=Opaque_test-1"); app.install(); app.choose("accepted");
  assert.deepEqual([...app.storage.keys()], [PREFERENCE_KEY]);
  const raw = app.storage.get(PREFERENCE_KEY), record = JSON.parse(raw);
  assert.deepEqual(Object.keys(record).sort(), ["choice", "expiresAt", "v"]);
  assert.equal(record.choice, "accepted"); assert.equal(record.v, 1); assert.ok(Number.isSafeInteger(record.expiresAt));
  assert.ok(record.expiresAt > Date.now() + MAX_AGE - 5000 && record.expiresAt <= Date.now() + MAX_AGE);
  assert.doesNotMatch(raw, /Opaque|gclid|phone|patient|email/u);
});

test("malformed, stale, overlong and extra-field preference records fail closed", () => {
  const invalid = [
    "not-json", "null", "[]", '"accepted"', "{}", JSON.stringify({ choice: "accepted" }),
    JSON.stringify({ ...choiceRecord(), v: 2 }), JSON.stringify({ ...choiceRecord(), choice: "granted" }),
    JSON.stringify({ ...choiceRecord(), expiresAt: "tomorrow" }), JSON.stringify(choiceRecord("accepted", Date.now() - 1)),
    JSON.stringify(choiceRecord("accepted", Date.now() + MAX_AGE + 60_000)),
    JSON.stringify({ ...choiceRecord(), patient: "must-not-be-accepted" }),
    JSON.stringify({ ...choiceRecord(), expiresAt: null }), JSON.stringify({ ...choiceRecord(), expiresAt: 1.5 }),
  ];
  for (const raw of invalid) {
    const app = harness(undefined, {}, { storage: { [PREFERENCE_KEY]: raw } }); app.install();
    assert.deepEqual(app.consent(), { eligible: true, choice: null }, raw); assert.equal(app.scripts.length, 0, raw);
  }
  const unavailable = harness(undefined, {}, { storageUnavailable: true });
  assert.doesNotThrow(() => unavailable.install());
  assert.deepEqual(unavailable.consent(), { eligible: true, choice: null }); assert.equal(unavailable.scripts.length, 0);
});

test("invalid consent inputs cannot infer permission or persist a misleading preference", () => {
  for (const invalid of [undefined, null, true, false, "granted", "accept", "", { choice: "accepted" }]) {
    const app = harness(); app.install();
    try { app.choose(invalid); } catch (error) { assert.ok(error instanceof Error); }
    assert.equal(app.scripts.length, 0, String(invalid)); assert.notEqual(app.consent().choice, "accepted");
  }
});

test("DNT and GPC override even stored acceptance and never offer an eligible grant", () => {
  for (const privacy of [{ doNotTrack: "1" }, { globalPrivacyControl: true }]) {
    const app = acceptedHarness(undefined, privacy); app.install(); app.choose("accepted");
    assert.equal(app.consent().eligible, false); assert.equal(app.scripts.length, 0); assert.equal(app.inlineScripts.length, 0);
    assert.equal(homepageGtmAllowed(app.window.location, app.navigator), false);
  }
  for (const signal of ["globalPrivacyControl", "doNotTrack"]) {
    const app = acceptedHarness(); app.install(); app.navigator[signal] = signal === "doNotTrack" ? "1" : true;
    app.event("pageshow"); assertFreshDocument(app); assertDenied(commands(app, "update").at(-1));
  }
});

test("withdrawing denies measurement, removes only accessible Ads cookies and exits the tagged document immediately", () => {
  const app = acceptedHarness(undefined, {}, {
    cookies: { _gcl_aw: "ad", _gcl_au: "ad", "_gac_UA-123-1": "ad", authToken: "private", firebaseSession: "private" },
    storage: { _gcl_ls: "ads", unrelatedSetting: "keep" }, sessionStorage: { _gcl_ls: "ads", unrelatedSetting: "keep" },
  });
  app.install(); app.choose("declined");
  assertDenied(commands(app, "update").at(-1)); assertFreshDocument(app);
  assert.equal(JSON.parse(app.storage.get(PREFERENCE_KEY)).choice, "declined");
  assert.equal(app.storage.has("_gcl_ls"), false); assert.equal(app.storage.get("unrelatedSetting"), "keep");
  assert.equal(app.sessionStorage.has("_gcl_ls"), false); assert.equal(app.sessionStorage.get("unrelatedSetting"), "keep");
  assert.equal(app.cookieJar.get("authToken"), "private"); assert.equal(app.cookieJar.get("firebaseSession"), "private");
  for (const key of ["_gcl_aw", "_gcl_au", "_gac_UA-123-1"]) assert.equal(app.cookieJar.has(key), false, key);
  assert.ok(app.cookieWrites.length > 0);
  assert.ok(app.cookieWrites.every(value => /^_(?:gcl_|gac_)/u.test(value)), "Never clear login or unrelated cookies.");
  assert.equal(app.scripts.length, 1, "Withdrawal never initializes a second container.");
});

test("cross-tab revocation or clearing storage cannot leave a consented document running", () => {
  for (const next of [JSON.stringify(choiceRecord("declined")), null, JSON.stringify(choiceRecord("accepted", Date.now() - 1)), "invalid"]) {
    const app = acceptedHarness(); app.install();
    if (next === null) app.storage.delete(PREFERENCE_KEY); else app.storage.set(PREFERENCE_KEY, next);
    app.event("storage", { key: PREFERENCE_KEY, newValue: next, storageArea: app.window.localStorage });
    assertDenied(commands(app, "update").at(-1)); assertFreshDocument(app);
  }
  const cleared = acceptedHarness(); cleared.install(); cleared.storage.clear();
  cleared.event("storage", { key: null, newValue: null, storageArea: cleared.window.localStorage }); assertFreshDocument(cleared);
});

test("acceptance in another tab is not auto-applied to a pending document", () => {
  const app = harness(); app.install();
  const raw = JSON.stringify(choiceRecord()); app.storage.set(PREFERENCE_KEY, raw);
  app.event("storage", { key: PREFERENCE_KEY, newValue: raw, storageArea: app.window.localStorage });
  assert.equal(app.scripts.length, 0, "Cross-tab acceptance requires a new eligible document or an explicit local choice.");
});

test("storage-unavailable, memory-only acceptance still honors a cross-tab revocation signal", () => {
  const app = harness(undefined, {}, { storageUnavailable: true }); app.install(); app.choose("accepted");
  assert.equal(app.scripts.length, 1, "An explicit local choice may apply for this document even when it cannot be saved.");
  assert.equal(app.storage.size, 0);
  app.event("storage", { key: PREFERENCE_KEY, newValue: JSON.stringify(choiceRecord("declined")) });
  assertDenied(commands(app, "update").at(-1)); assertFreshDocument(app);
});

test("a failed preference write cannot silently restore an older acceptance after withdrawal", () => {
  const app = acceptedHarness(); app.install();
  app.window.localStorage.setItem = () => { throw new Error("Writes denied"); };
  app.window.localStorage.removeItem = () => { throw new Error("Removal denied"); };
  app.choose("declined");
  assertDenied(commands(app, "update").at(-1));
  assert.deepEqual(app.actions.at(-1), ["replace", "/?untracked=1"]);
  const next = harness("https://asherhealthcare.in/?untracked=1", {}, { storage: Object.fromEntries(app.storage) }); next.install();
  assert.equal(next.scripts.length, 0); assert.equal(next.consent().eligible, false);
});

test("consent expiry is rechecked on BFCache restore and page visibility", () => {
  for (const name of ["pageshow", "doc:visibilitychange"]) {
    const app = acceptedHarness(); app.install();
    app.storage.set(PREFERENCE_KEY, JSON.stringify(choiceRecord("accepted", Date.now() - 1)));
    app.event(name, { persisted: true }); assertDenied(commands(app, "update").at(-1)); assertFreshDocument(app);
  }
});

test("long-lived consent uses browser-safe expiry timers instead of overflowing to immediate expiry", () => {
  const app = acceptedHarness(); app.install();
  assert.equal(app.timers.size, 1);
  for (const { delay } of app.timers.values()) assert.ok(delay > 0 && delay <= 2147483647);
  app.choose("declined"); assertFreshDocument(app);
});

test("transport guards block Google before consent and after withdrawal without blocking clinic requests", async () => {
  const app = harness(); app.install();
  const approvedConversion = "https://www.googleadservices.com/pagead/conversion/18404988056/?label=WvCgCOHZrpwdEJipl8hE&en=conversion&npa=1&rdp=1";
  async function assertGoogleBlocked() {
    const count = app.transportRequests.length;
    await assert.rejects(app.window.fetch(approvedConversion), /measurement is disabled/u);
    assert.equal(app.navigator.sendBeacon(approvedConversion, "fixture"), false);
    for (const name of ["image", "script", "iframe"]) {
      const element = app.document.createElement(name);
      element.src = approvedConversion;
      assert.equal(element.src, undefined);
      element.setAttribute("src", approvedConversion);
    }
    const request = new app.window.XMLHttpRequest(); request.open("GET", approvedConversion); request.send();
    assert.equal(request.aborted, true); assert.equal(app.transportRequests.length, count);
  }
  await assertGoogleBlocked();
  await app.window.fetch("https://asherhealthcare.in/api/homepage-metrics", { method: "POST" });
  assert.equal(app.transportRequests.at(-1)[1], "https://asherhealthcare.in/api/homepage-metrics");
  app.choose("accepted");
  assert.equal(app.navigator.sendBeacon(approvedConversion, "fixture"), true);
  app.choose("declined"); await assertGoogleBlocked();
  await app.window.fetch("https://asherhealthcare.in/api/homepage-metrics", { method: "POST" });
  assert.equal(app.transportRequests.at(-1)[1], "https://asherhealthcare.in/api/homepage-metrics");
});

test("accepted transport permits only reviewed IDs and labeled nonpersonalized Call intent, not Analytics or audiences", async () => {
  const app = acceptedHarness(); app.install();
  for (const url of [
    "https://www.google-analytics.com/g/collect?v=2&tid=G-UNAPPROVED",
    "https://www.googletagmanager.com/gtag/js?id=G-UNAPPROVED",
    "https://www.googletagmanager.com/gtm.js?id=GTM-OTHER",
    "https://www.googleadservices.com/pagead/conversion/18404988056/?label=OTHER&en=conversion&npa=1&rdp=1",
    "https://www.googleadservices.com/pagead/conversion/18404988056/?label=WvCgCOHZrpwdEJipl8hE",
    "https://www.googleadservices.com/pagead/conversion/999/?label=WvCgCOHZrpwdEJipl8hE&en=conversion&npa=1&rdp=1",
    "https://www.googleadservices.com/pagead/conversion/18404988056/?label=WvCgCOHZrpwdEJipl8hE&npa=1&rdp=1",
    "https://www.googleadservices.com/pagead/conversion/18404988056/?label=WvCgCOHZrpwdEJipl8hE&en=page_view&npa=1&rdp=1",
    "http://www.googleadservices.com/pagead/conversion/18404988056/?label=WvCgCOHZrpwdEJipl8hE&en=conversion&npa=1&rdp=1",
    "https://evil.google.com/pagead/1p-conversion/18404988056/?label=WvCgCOHZrpwdEJipl8hE&en=conversion&npa=1&rdp=1",
    "https://www.google.com/pagead/viewthroughconversion/18404988056/?label=WvCgCOHZrpwdEJipl8hE&en=conversion&npa=1&rdp=1",
    "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/18404988056/?npa=1&rdp=1",
    "https://www.google.com/ccm/collect?en=page_view",
  ]) await assert.rejects(app.window.fetch(url), /measurement is disabled/u, url);
  for (const url of [
    "https://www.googletagmanager.com/gtm.js?id=GTM-TQC7XR38",
    "https://www.googletagmanager.com/gtag/js?id=AW-18404988056",
    "https://www.googleadservices.com/pagead/conversion/18404988056/?label=WvCgCOHZrpwdEJipl8hE&en=conversion&npa=1&rdp=1",
    "https://www.google.com/pagead/1p-conversion/18404988056/?label=WvCgCOHZrpwdEJipl8hE&en=conversion&npa=1&rdp=1",
  ]) assert.equal((await app.window.fetch(url)).ok, true, url);
});

test("explicit Google Maps embeds stay independent from optional advertising consent", async () => {
  const app = harness(); app.install();
  const mapsUrl = "https://www.google.com/maps?q=Asher+Healthcare&output=embed";
  const iframe = app.document.createElement("iframe"); iframe.src = mapsUrl;
  assert.equal(iframe.src, mapsUrl);
  assert.equal((await app.window.fetch(mapsUrl)).ok, true);
  assert.equal(app.scripts.length, 0, "The separate user-requested map must not grant Google Ads consent.");
});

test("consent and loader stay excluded from private, service, booking, unknown-context and preview pages", () => {
  for (const url of [
    "https://asherhealthcare.in/book", "https://asherhealthcare.in/book#appointment-obg",
    "https://asherhealthcare.in/care/pediatrics", "https://asherhealthcare.in/care/womens-health",
    "https://asherhealthcare.in/care/general-care-lab-tests", "https://asherhealthcare.in/admin/settings",
    "https://asherhealthcare.in/staff", "https://asherhealthcare.in/patient", "https://asherhealthcare.in/portal/login",
    "https://asherhealthcare.in/privacy", "https://asherhealthcare.in/404",
    "https://asherhealthcare.in/?patient=private", "https://asherhealthcare.in/?source=installed-app",
    "https://asherhealthcare.in/?_dbg=1", "https://asherhealthcare.in/?gtm_debug=x",
    "https://asherhealthcare.in/#unknown-patient-context", "http://asherhealthcare.in/",
    "https://feature-test.asher-healthcare.pages.dev/", "https://evil-asherhealthcare.in/", "http://localhost/",
  ]) {
    const app = acceptedHarness(url); app.install(); app.choose("accepted");
    assert.equal(app.consent().eligible, false, url); assert.equal(app.scripts.length, 0, url);
    assert.equal(app.inlineScripts.length, 0, url); assert.equal(app.window.dataLayer, undefined, url);
  }
  for (const suffix of ["", "#top", "#main-content", "#services", "#care", "#doctors", "#moments-of-care", "#contact", "#faq", "#book-visit"]) {
    const app = acceptedHarness(`https://asherhealthcare.in/${suffix}`); app.install(); assert.equal(app.scripts.length, 1, suffix);
  }
  const www = acceptedHarness("https://www.asherhealthcare.in/"); www.install(); assert.equal(www.scripts.length, 1);
});

test("legacy booking destinations preserve fragment priority and strip all other input without measurement", () => {
  for (const [suffix, expected] of [
    ["#appointment", "/book"], ["#appointment-pediatrics", "/book#appointment-pediatrics"],
    ["#appointment-obg", "/book#appointment-obg"], ["?care=obg#appointment", "/book#appointment-obg"],
    ["?care=pediatrics#appointment-obg", "/book#appointment-obg"],
    ["?care=obg&phone=private&reason=private", "/book#appointment-obg"],
    ["?care=invalid", "/book"], ["#appointment-unknown", "/book"], ["#visit", "/book#visit"],
  ]) {
    const app = acceptedHarness(`https://asherhealthcare.in/${suffix}`);
    assert.equal(legacyBookingDestination(app.window.location), expected); app.install();
    assert.deepEqual(app.actions, [["replace", expected]]); assert.equal(app.scripts.length, 0); assert.equal(app.window.dataLayer, undefined);
  }
  assert.equal(legacyBookingDestination(new URL("https://asherhealthcare.in/book?care=obg")), null);
});

test("opaque click IDs wait only in memory until consent and only approved IDs are restored for native attribution", () => {
  for (const suffix of ["?gclid=Opaque_test-1", "?wbraid=Opaque_1&gad_source=1", "?gbraid=Opaque-1&gad_campaignid=12345#top"]) {
    const app = harness(`https://asherhealthcare.in/${suffix}`); app.install();
    assert.equal(app.window.location.search, ""); assert.equal(app.scripts.length, 0); assert.equal(app.actions[0][0], "replaceState");
    assert.equal(app.storage.size, 0); assert.doesNotMatch(JSON.stringify(app.window.dataLayer), /Opaque/u);
    app.choose("accepted");
    const query = new URLSearchParams(app.window.location.search);
    assert.equal(query.size, 1); assert.ok([...query.keys()].every(key => ["gclid", "gbraid", "wbraid"].includes(key)));
    assert.equal(query.values().next().value.startsWith("Opaque"), true); assert.equal(app.scripts.length, 1);
    assert.doesNotMatch(app.storage.get(PREFERENCE_KEY), /Opaque/u);
    assert.equal(app.providerRuns[0].dataLayerBefore.find(entry => entry[0] === "set")[1].page_location, "https://asherhealthcare.in/");
  }
});

test("declining an ad arrival discards attribution before any later change of preference", () => {
  const app = harness("https://asherhealthcare.in/?gclid=Opaque_private"); app.install(); app.choose("declined");
  assert.equal(app.window.location.search, ""); assert.equal(app.scripts.length, 0);
  app.choose("accepted"); assert.equal(app.window.location.search, ""); assert.doesNotMatch(app.storage.get(PREFERENCE_KEY), /Opaque/u);
});

test("unknown, mixed, duplicate, free-text and malformed annotations never broaden eligibility", () => {
  for (const suffix of [
    "?gclid=Opaque&patient=private", "?gclid=one&gclid=two", "?gclid=contains%20words",
    "?utm_campaign=medical", "?gtm_preview=env-1", "?gad_source=", "?gad_source=words", "?gad_campaignid=medical",
    "?gclid=Opaque&_dbg=1", "?gclid=", `?gclid=${"a".repeat(257)}`, "?gclid=Opaque&reason=sensitive", "?gclid=Opaque#private-health-context",
  ]) {
    const app = acceptedHarness(`https://asherhealthcare.in/${suffix}`); app.install(); app.choose("accepted");
    assert.equal(app.scripts.length, 0, suffix); assert.equal(app.inlineScripts.length, 0, suffix); assert.equal(app.window.dataLayer, undefined, suffix);
  }
});

test("parser bootstrap and hydrated consent API share one installation before and after acceptance", () => {
  const app = harness(); app.bootstrap(); const listener = app.handlers.get("doc:click");
  app.install(); assert.equal(app.scripts.length, 0); assert.equal(app.handlers.get("doc:click"), listener);
  app.choose("accepted"); app.install();
  assert.equal(app.scripts.length, 1); assert.equal(app.providerRuns[0].source, originalGoogleSource);
  assert.equal(app.window.dataLayer.filter(entry => entry.event === "gtm.js").length, 1);
  assert.equal(app.window.__asherHomepageGtmDocument, app.document);
  const returning = acceptedHarness(); returning.bootstrap(); returning.install();
  assert.equal(returning.scripts.length, 1); assertAccepted(commands(returning, "update")[0]);
});

test("generated parser bootstrap applies exclusions and privacy signals before any provider source", () => {
  for (const [url, privacy] of [
    ["https://asherhealthcare.in/#appointment", {}], ["https://asherhealthcare.in/?care=pediatrics#appointment-obg", {}],
    ["https://asherhealthcare.in/book", {}], ["https://asherhealthcare.in/admin/login", {}],
    ["https://asherhealthcare.in/?patient=private", {}], ["https://preview.asher-healthcare.pages.dev/", {}],
    ["https://asherhealthcare.in/", { doNotTrack: "1" }], ["https://asherhealthcare.in/", { globalPrivacyControl: true }],
  ]) {
    const app = acceptedHarness(url, privacy); app.bootstrap(); app.install();
    assert.equal(app.scripts.length, 0, url); assert.equal(app.window.dataLayer, undefined, url);
  }
});

test("neutral metadata and fresh-document guards exist even while consent is pending", () => {
  for (const accepted of [false, true]) {
    const app = accepted ? acceptedHarness() : harness(); app.document.title = "";
    app.document.querySelector = () => null; app.install(); assert.equal(app.document.title, "");
    app.document.querySelector = () => ({}); app.document.title = "Medical context";
    app.event("head:mutation"); assert.equal(app.document.title, "Asher Healthcare");
    app.document.title = "Restored sensitive title"; app.event("pageshow"); assert.equal(app.document.title, "Asher Healthcare");
    assert.equal(app.click("/book#appointment-obg"), true);
    assert.deepEqual(app.actions.at(-1), ["assign", "https://asherhealthcare.in/book#appointment-obg"]);
    assertDenied(commands(app, "update").at(-1));
  }
});

test("booking clicks leave the document; Call and known general anchors retain native behavior", () => {
  const app = acceptedHarness(); app.install(); assert.equal(app.click("#appointment-obg"), true);
  assert.deepEqual(app.actions.at(-1), ["assign", "https://asherhealthcare.in/book#appointment-obg"]);
  assertDenied(commands(app, "update").at(-1));
  assert.equal(app.window.location.href, "https://asherhealthcare.in/");
  for (const extras of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { link: { target: "_blank" } }, { link: { hasAttribute: () => true } }]) {
    app.actions.length = 0; assert.equal(app.click("/book", extras), false); assert.equal(app.actions.length, 0);
  }
  for (const href of ["tel:+919019263709", "https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5", "#top", "#main-content"]) assert.equal(app.click(href), false);
});

test("programmatic navigation cannot reuse a pending or accepted homepage for booking or private context", () => {
  for (const accepted of [false, true]) for (const method of ["pushState", "replaceState"]) {
    for (const path of ["/book#appointment-obg", "/admin/login", "/portal/login", "/care/pediatrics", "/?care=obg#appointment", "/?patient=private"]) {
      const app = accepted ? acceptedHarness() : harness(); app.install(); app.window.history[method]({}, "", path);
      assert.equal(app.actions.at(-1)[0], method === "replaceState" ? "replace" : "assign");
      assert.equal(app.window.location.pathname, "/"); assert.ok(!app.actions.at(-1)[1].includes("?care="));
      assertDenied(commands(app, "update").at(-1));
    }
  }
  const app = acceptedHarness(); app.install(); app.window.history.pushState({}, "", "#unknown-context");
  assert.deepEqual(app.actions.at(-1), ["assign", "https://asherhealthcare.in/?untracked=1#unknown-context"]);
});

test("back/forward, direct hash changes and BFCache enforce homepage isolation", () => {
  for (const event of ["popstate", "hashchange", "pageshow"]) {
    const app = acceptedHarness(); app.install(); app.move("/book#appointment-obg"); app.event(event); assert.deepEqual(app.actions, [["reload"]]);
  }
  const app = acceptedHarness(); app.install(); app.move("#appointment-pediatrics"); app.event("hashchange");
  assert.deepEqual(app.actions, [["replace", "/book#appointment-pediatrics"]]);
  for (const [initial, next, expected] of [["/", "/book", true], ["/book", "/", true], ["/", "/care/pediatrics", true], ["/", "/", false], ["/admin", "/admin/patients", false]]) assert.equal(crossesHomepageBoundary(initial, next), expected);
});

test("BFCache cannot restore a noninteractive leaving consent controller after a page departure", () => {
  const app = acceptedHarness(); app.install(); app.click("/book");
  app.actions.length = 0; app.event("pageshow", { persisted: true });
  assert.ok(app.actions.some(action => action[0] === "reload"), "A restored leaving controller must start fresh, not keep a stale disabled state.");
});

test("homepage consent stays out of global/private routes without a no-JavaScript bypass", () => {
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
  for (const path of ["src/app/error.tsx", "src/app/global-error.tsx"]) assert.match(read(path), /leaveTaggedErrorPage\(window\)/u);
});

test("error recovery leaves a consented document without replaying any appointment action", () => {
  const app = harness(); app.install(); leaveTaggedErrorPage(app.window); assert.equal(app.actions.length, 0);
  app.choose("accepted"); leaveTaggedErrorPage(app.window); assert.deepEqual(app.actions, [["replace", "/?untracked=1"]]);
  const recovery = acceptedHarness("https://asherhealthcare.in/?untracked=1"); recovery.install(); leaveTaggedErrorPage(recovery.window);
  assert.equal(recovery.scripts.length, 0); assert.equal(recovery.actions.length, 0);
});
