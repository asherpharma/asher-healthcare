import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// OFFLINE component tests only. The DOM, React hooks and Google script insertion
// are mocked; passing these tests does not establish browser/network privacy.
const source = readFileSync(new URL("../src/components/analytics/AdsClickMeasurement.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
const consentKey = "asher_ads_measurement_consent_v1";
const phone = "tel:+919019263709";
const directions = "https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5";
const neutral = {
  page_location: "https://asherhealthcare.in/",
  page_referrer: "",
  page_title: "Asher Healthcare",
};

function harness({
  url = "https://asherhealthcare.in/", choice, configured = true, storageFails = false,
  revokeAfterInitialConsentRead = false, revokeAfterConsentWrite = false,
} = {}) {
  let currentUrl = new URL(url);
  const storage = new Map(choice === undefined ? [] : [[consentKey, choice]]);
  const scripts = [];
  const commandsAtInsertion = [];
  const cookieWrites = [];
  const assignments = [];
  let reloads = 0;
  let consentReads = 0;
  const states = [];
  const effects = [];
  let cursor = 0;
  let dirty = true;
  let tree;
  const pending = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const listen = (map, name, fn) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(fn);
  };
  const unlisten = (map, name, fn) => map.get(name)?.delete(fn);
  const emit = (map, name, event) => {
    for (const fn of [...(map.get(name) ?? [])]) fn(event);
  };
  class Element {
    constructor(anchor) { this.anchor = anchor; }
    closest(selector) { return selector === "a[href]" ? this.anchor ?? null : null; }
  }
  class Anchor extends Element {
    constructor(href, attributes = {}) {
      super();
      this.rawHref = href;
      this.anchor = this;
      this.target = attributes.target ?? "";
      this.attributes = attributes;
    }
    get href() { return new URL(this.rawHref, currentUrl).href; }
    getAttribute(name) { return name === "href" ? this.rawHref : this.attributes[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  }
  const window = {
    localStorage: {
      getItem(key) {
        if (storageFails) throw new Error("storage unavailable");
        const stored = storage.get(key) ?? null;
        if (key === consentKey && ++consentReads === 1 && revokeAfterInitialConsentRead) {
          // Model revocation after the hydration read, before the effect that
          // initializes Google; the React choice still contains the old value.
          storage.set(key, "denied");
        }
        return stored;
      },
      setItem(key, value) {
        if (storageFails) throw new Error("storage unavailable");
        storage.set(key, value);
        if (key === consentKey && value === "granted" && revokeAfterConsentWrite) {
          // Model another tab withdrawing immediately after this tab's opt-in,
          // before its storage event arrives and before initialization runs.
          storage.set(key, "denied");
        }
      },
    },
    location: {
      get href() { return currentUrl.href; },
      get pathname() { return currentUrl.pathname; },
      get search() { return currentUrl.search; },
      get hash() { return currentUrl.hash; },
      get origin() { return currentUrl.origin; },
      reload() { reloads++; },
      assign(destination) { assignments.push(destination); },
    },
    addEventListener: (name, fn) => listen(windowListeners, name, fn),
    removeEventListener: (name, fn) => unlisten(windowListeners, name, fn),
  };
  const document = {
    title: "Synthetic private page title",
    referrer: "https://example.invalid/private-referrer",
    createElement(type) { assert.equal(type, "script"); return {}; },
    head: { appendChild(script) {
      scripts.push(script);
      commandsAtInsertion.push((window.dataLayer ?? []).map((entry) => [...entry]));
    } },
    get cookie() { return "_gcl_aw=test; unrelated=keep"; },
    set cookie(value) { cookieWrites.push(value); },
    addEventListener: (name, fn) => listen(documentListeners, name, fn),
    removeEventListener: (name, fn) => unlisten(documentListeners, name, fn),
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value) => {
        const next = typeof value === "function" ? value(states[index]) : value;
        if (!Object.is(states[index], next)) { states[index] = next; dirty = true; }
      }];
    },
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = effects[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        pending.push(() => {
          previous?.cleanup?.();
          effects[index] = { deps, cleanup: callback() };
        });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, window, document, Element, HTMLAnchorElement: Anchor,
    URL, URLSearchParams, console,
    process: { env: configured ? {
      NEXT_PUBLIC_GOOGLE_ADS_CLICK_MEASUREMENT_ENABLED: "true",
      NEXT_PUBLIC_GOOGLE_ADS_ID: "AW-123456789",
      NEXT_PUBLIC_GOOGLE_ADS_PHONE_CLICK_LABEL: "phone_test_label",
      NEXT_PUBLIC_GOOGLE_ADS_DIRECTIONS_CLICK_LABEL: "directions_test_label",
    } : {} },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "next/navigation") return {
        usePathname: () => currentUrl.pathname,
        useSearchParams: () => currentUrl.searchParams,
      };
      if (name.endsWith(".module.css")) return {};
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  // This is a module-evaluation watchdog, not a behavior/performance assertion.
  // Leave headroom for the shared Windows host being busy with unrelated work.
  vm.runInContext(compiled, context, { timeout: 10000 });
  const flush = () => {
    for (let pass = 0; dirty || pending.length; pass++) {
      assert.ok(pass < 20, "mock React render/effects should settle");
      if (dirty) {
        dirty = false;
        cursor = 0;
        tree = module.exports.AdsClickMeasurement();
      }
      for (const run of pending.splice(0)) run();
    }
  };
  const flatten = (node) => Array.isArray(node)
    ? node.flatMap(flatten)
    : node && typeof node === "object"
      ? [node, ...flatten(node.props?.children)] : [];
  flush();
  return {
    window, scripts, commandsAtInsertion, storage, cookieWrites, assignments,
    get reloads() { return reloads; },
    get tree() { return tree; },
    get commands() { return (window.dataLayer ?? []).map((entry) => [...entry]); },
    get conversions() { return this.commands.filter(([command, name]) => command === "event" && name === "conversion"); },
    button(text) {
      const button = flatten(tree).find((node) => node.type === "button" && node.props.children === text);
      assert.ok(button, `button ${text} should exist`);
      button.props.onClick();
      flush();
    },
    click(href, { child = false, ...attributes } = {}) {
      const anchor = new Anchor(href, attributes);
      const event = {
        target: child ? new Element(anchor) : anchor,
        button: 0, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
      };
      emit(documentListeners, "click", event);
      flush();
      return event;
    },
    storageEvent(key, newValue) {
      if (key === null) storage.clear();
      else if (newValue === null) storage.delete(key);
      else storage.set(key, newValue);
      emit(windowListeners, "storage", { key, newValue });
      flush();
    },
    pageshow(persisted = true) {
      emit(windowListeners, "pageshow", { persisted });
      flush();
    },
    navigate(url, { rerender = true } = {}) {
      currentUrl = new URL(url);
      if (rerender) { dirty = true; emit(windowListeners, "hashchange", {}); flush(); }
    },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  };
}

test("no Google script or events before consent, after decline, or without configuration", () => {
  for (const options of [{}, { choice: "denied" }, { configured: false, choice: "granted" }]) {
    const app = harness(options);
    app.click(phone);
    app.click(directions);
    assert.equal(app.scripts.length, 0);
    assert.equal(app.commands.length, 0);
  }
  const app = harness();
  app.button("Decline");
  assert.equal(app.storage.get(consentKey), "denied");
  assert.equal(app.scripts.length, 0);
  assert.equal(app.click(phone).defaultPrevented, false, "declining preserves links");
});

test("initialization rereads consent instead of trusting a stale hydration or opt-in choice", () => {
  const staleHydration = harness({ choice: "granted", revokeAfterInitialConsentRead: true });
  assert.equal(staleHydration.storage.get(consentKey), "denied");
  assert.equal(staleHydration.scripts.length, 0);
  assert.equal(staleHydration.commands.length, 0);
  const staleOptIn = harness({ revokeAfterConsentWrite: true });
  staleOptIn.button("Allow measurement");
  assert.equal(staleOptIn.storage.get(consentKey), "denied");
  assert.equal(staleOptIn.scripts.length, 0);
  assert.equal(staleOptIn.commands.length, 0);
});

test("opt-in queues official Arguments commands with neutral context before script insertion", () => {
  const app = harness({ url: "https://asherhealthcare.in/?gclid=synthetic#contact" });
  app.button("Allow measurement");
  assert.equal(app.scripts.length, 1);
  assert.equal(app.scripts[0].referrerPolicy, "no-referrer");
  assert.equal(app.scripts[0].src, "https://www.googletagmanager.com/gtag/js?id=AW-123456789");
  for (const command of app.window.dataLayer) assert.equal(Object.prototype.toString.call(command), "[object Arguments]");
  const normalized = JSON.parse(JSON.stringify(app.commands));
  assert.deepEqual(JSON.parse(JSON.stringify(app.commandsAtInsertion[0])), normalized,
    "all initialization commands must already be queued before any Google script is appended");
  assert.deepEqual(normalized[0], ["consent", "default", {
    ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied",
  }]);
  const contextIndex = normalized.findIndex(([command, payload]) => command === "set" && payload?.page_location);
  const configIndex = normalized.findIndex(([command]) => command === "config");
  assert.ok(contextIndex >= 0 && contextIndex < configIndex);
  assert.deepEqual(normalized[contextIndex], ["set", neutral]);
  for (const signal of ["allow_ad_personalization_signals", "allow_google_signals", "allow_interest_groups"]) {
    assert.ok(normalized.some(([command, key, value]) => command === "set" && key === signal && value === false));
  }
  assert.doesNotMatch(JSON.stringify(normalized), /synthetic|private-referrer|private page title|general-care-lab-tests/);
  app.button("Measurement preferences");
  app.button("Keep measurement on");
  assert.equal(app.scripts.length, 1, "rerenders must not duplicate script initialization");
});

test("only exact clinic phone/directions links emit minimal intent events and preserve navigation", () => {
  const app = harness({ choice: "granted" });
  for (const href of ["tel:9019263709", "tel:+919999999999", `${directions}?private=data`, "https://wa.me/919019263709", "/#appointment"]) app.click(href);
  assert.equal(app.conversions.length, 0);
  assert.equal(app.click(phone, { child: true }).defaultPrevented, false);
  assert.equal(app.click(directions).defaultPrevented, false);
  assert.deepEqual(JSON.parse(JSON.stringify(app.conversions)), [
    ["event", "conversion", { ...neutral, send_to: "AW-123456789/phone_test_label" }],
    ["event", "conversion", { ...neutral, send_to: "AW-123456789/directions_test_label" }],
  ]);
  app.storage.set(consentKey, "denied");
  app.click(phone);
  assert.equal(app.conversions.length, 2, "current storage is checked even before a storage event");
});

test("withdrawal blocks later clicks, clears only ad cookies, and reloads to unload Google", () => {
  const app = harness({ choice: "granted" });
  app.button("Measurement preferences");
  app.button("Stop measurement");
  assert.equal(app.storage.get(consentKey), "denied");
  assert.equal(app.window.__asherAdsClickMeasurementEnabled, false);
  assert.equal(app.reloads, 1);
  assert.ok(app.cookieWrites.length > 0);
  assert.ok(app.cookieWrites.every((value) => value.startsWith("_gcl_aw=")));
  app.click(phone);
  assert.equal(app.conversions.length, 0);
});

test("cross-tab withdrawal or storage clearing stops measurement; unrelated changes do not", () => {
  for (const [key, value] of [[consentKey, "denied"], [consentKey, null], [null, null]]) {
    const app = harness({ choice: "granted" });
    app.storageEvent("unrelated", "denied");
    assert.equal(app.reloads, 0);
    app.storageEvent(key, value);
    assert.equal(app.reloads, 1);
    app.click(directions);
    assert.equal(app.conversions.length, 0);
  }
});

test("sensitive paths, unknown queries and unknown fragments fail closed even with stored consent", () => {
  for (const suffix of ["/patient", "/admin", "/api/appointments", "/unknown", "/privacy", "/care/general-care-lab-tests", "/care/pediatrics", "/care/womens-health", "/care/unknown-sensitive-path", "/?care=pediatrics", "/?patient=synthetic", "/#synthetic-private-fragment"]) {
    const app = harness({ url: `https://asherhealthcare.in${suffix}`, choice: "granted" });
    app.click(phone);
    assert.equal(app.scripts.length, 0, suffix);
    assert.equal(app.conversions.length, 0, suffix);
  }
});

test("a newly unsafe browser URL blocks immediate clicks before React updates, then unloads the tag", () => {
  for (const url of [
    "https://asherhealthcare.in/?patient=synthetic",
    "https://asherhealthcare.in/care/pediatrics",
    "https://asherhealthcare.in/privacy",
  ]) {
    const app = harness({ choice: "granted" });
    app.navigate(url, { rerender: false });
    app.click(phone);
    assert.equal(app.conversions.length, 0, url);
    app.navigate(url);
    assert.ok(app.reloads >= 1, url);
    app.click(directions);
    assert.equal(app.conversions.length, 0, "no intent event while clean-document navigation is pending");
  }
});

test("a document initially loaded on a care page cannot start Google after a client-side return home", () => {
  const app = harness({ choice: "granted", url: "https://asherhealthcare.in/care/pediatrics" });
  assert.equal(app.scripts.length, 0);
  app.navigate("https://asherhealthcare.in/#appointment");
  assert.equal(app.scripts.length, 0, "a clean homepage document must be loaded before Google can initialize");
  assert.ok(app.reloads >= 1, "client-side boundary bypass must request a clean document");
});

test("a document with an initially unsafe homepage query or fragment stays unmeasured after URL normalization", () => {
  for (const suffix of ["?patient=synthetic", "?care=pediatrics#appointment", "#synthetic-private-fragment"]) {
    const app = harness({ choice: "granted", url: `https://asherhealthcare.in/${suffix}` });
    assert.equal(app.scripts.length, 0, suffix);
    app.navigate("https://asherhealthcare.in/#appointment");
    app.click(phone);
    app.click(directions);
    assert.equal(app.scripts.length, 0, `normalizing ${suffix} does not create a clean document`);
    assert.equal(app.commands.length, 0, suffix);
    assert.equal(app.conversions.length, 0, suffix);
  }
});

test("restored cached homepage rechecks revoked or cleared consent and stops a previously loaded tag", () => {
  for (const choice of ["denied", null]) {
    const app = harness({ choice: "granted" });
    if (choice === null) app.storage.delete(consentKey);
    else app.storage.set(consentKey, choice);
    app.pageshow();
    assert.equal(app.reloads, 1);
    assert.equal(app.window.__asherAdsClickMeasurementEnabled, false);
    app.click(phone);
    assert.equal(app.conversions.length, 0);
  }
  const allowed = harness({ choice: "granted" });
  allowed.pageshow();
  assert.equal(allowed.reloads, 0);
  assert.equal(allowed.scripts.length, 1, "restoring a consented page must not insert a duplicate tag");
});

test("homepage boundary navigation is a full document navigation regardless of consent", () => {
  for (const choice of [undefined, "denied", "granted"]) {
    for (const path of ["/care/pediatrics", "/care/womens-health", "/care/general-care-lab-tests", "/privacy", "/patient"]) {
      const home = harness({ choice });
      assert.equal(home.click(path).defaultPrevented, true, `homepage to ${path}; ${choice}`);
      assert.deepEqual(home.assignments, [`https://asherhealthcare.in${path}`]);
      assert.equal(home.conversions.length, 0);
      const other = harness({ choice, url: `https://asherhealthcare.in${path}` });
      assert.equal(other.click("/#appointment").defaultPrevented, true, `${path} to homepage; ${choice}`);
      assert.deepEqual(other.assignments, ["https://asherhealthcare.in/#appointment"]);
      assert.equal(other.scripts.length, 0);
    }
  }
});

test("unsafe same-homepage query links fail closed without changing the document URL", () => {
  for (const choice of [undefined, "denied", "granted"]) {
    for (const destination of ["/?patient=synthetic", "/?care=pediatrics#appointment"]) {
      const app = harness({ choice });
      const event = app.click(destination, { child: true });
      assert.equal(event.defaultPrevented, true, `${destination}; ${choice}`);
      assert.equal(app.assignments.length, 0);
      assert.equal(app.window.location.href, "https://asherhealthcare.in/");
      assert.equal(app.reloads, choice === "granted" ? 1 : 0,
        "an already loaded tag is stopped by reloading the unchanged safe URL");
      assert.equal(app.conversions.length, 0);
    }
  }
});

test("unsafe fragment-only links fail closed without assigning a same-document URL", () => {
  for (const choice of [undefined, "denied", "granted"]) {
    for (const [url, destination] of [
      ["https://asherhealthcare.in/", "#synthetic-private-fragment"],
      ["https://asherhealthcare.in/", "/#synthetic-private-fragment"],
      ["https://asherhealthcare.in/?gclid=synthetic", "/?gclid=synthetic#synthetic-private-fragment"],
    ]) {
      const app = harness({ choice, url });
      const event = app.click(destination, { child: true });
      assert.equal(event.defaultPrevented, true, `${destination}; ${choice}`);
      assert.equal(app.assignments.length, 0, "assigning only a fragment does not unload an existing Google tag");
      assert.equal(app.window.location.href, url);
      assert.equal(app.reloads, choice === "granted" ? 1 : 0,
        "only an already loaded tag requires a reload of the unchanged safe URL");
      assert.equal(app.conversions.length, 0);
    }
  }
});

test("safe homepage hash links remain usable without forcing a document reload", () => {
  for (const hash of ["#appointment", "#care", "#clinic", "#contact", "#doctors", "#journey", "#main-content", "#services", "#top"]) {
    const app = harness({ choice: "granted" });
    assert.equal(app.click(`/${hash}`).defaultPrevented, false, hash);
    assert.equal(app.assignments.length, 0);
    app.navigate(`https://asherhealthcare.in/${hash}`);
    app.click(phone);
    assert.equal(app.conversions.length, 1, hash);
    assert.equal(app.reloads, 0, hash);
  }
});

test("unmount cleanup removes conversion click handlers", () => {
  const app = harness({ choice: "granted" });
  app.unmount();
  app.click(phone);
  assert.equal(app.conversions.length, 0);
});

test("inaccessible consent storage fails closed on explicit opt-in", () => {
  const app = harness({ storageFails: true });
  app.button("Allow measurement");
  assert.equal(app.scripts.length, 0);
  assert.equal(app.conversions.length, 0);
});
