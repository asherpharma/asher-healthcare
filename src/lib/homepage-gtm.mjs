const PRODUCTION_HOSTS = new Set(["asherhealthcare.in", "www.asherhealthcare.in"]);
const GENERAL_HASHES = new Set(["", "#top", "#main-content", "#services", "#care", "#doctors", "#moments-of-care", "#contact", "#faq", "#book-visit"]);
// Google's original installation source, unchanged except for our container ID.
// https://support.google.com/tagmanager/answer/14847097
// Keep privacy decisions outside this source; do not wrap or edit the IIFE.
export const GOOGLE_GTM_SOURCE = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-TQC7XR38');`;
const ORIGINAL_SCRIPT_ID = "asher-homepage-gtm-original";
const installedDocuments = new WeakSet();
const AD_ANNOTATION_KEYS = new Set(["gclid", "gbraid", "wbraid", "gad_source", "gad_campaignid"]);
export const HOMEPAGE_CONSENT_KEY = "asher.homepage.measurement.v1";
const CONSENT_MAX_AGE = 180 * 24 * 60 * 60 * 1000;

// No unknown fields, identities, click IDs or visit history are persisted.
function readPreference(win) {
  try {
    const value = JSON.parse(win.localStorage.getItem(HOMEPAGE_CONSENT_KEY));
    const now = Date.now();
    if (!value || Object.keys(value).sort().join(",") !== "choice,expiresAt,v" || value.v !== 1 ||
        !["accepted", "declined"].includes(value.choice) || !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= now || value.expiresAt > now + CONSENT_MAX_AGE) {
      win.localStorage.removeItem(HOMEPAGE_CONSENT_KEY);
      return null;
    }
    return value;
  } catch { return null; }
}

function advertisingAnnotations(location) {
  if (!location.search) return "";
  const entries = [...new URLSearchParams(location.search)];
  if (!entries.length || new Set(entries.map(([key]) => key)).size !== entries.length ||
      !entries.every(([key, value]) => AD_ANNOTATION_KEYS.has(key) &&
        (/^gad_/u.test(key) ? /^[0-9]{1,20}$/u.test(value) : /^[A-Za-z0-9_-]{1,256}$/u.test(value)))) return null;
  // These are opaque Google ad-click annotations, never free-text campaigns.
  return new URLSearchParams(entries.filter(([key]) => ["gclid", "gbraid", "wbraid"].includes(key))).toString();
}

function clearMeasurementStorage(win, doc) {
  try { win.localStorage.removeItem("_gcl_ls"); } catch {}
  try { win.sessionStorage?.removeItem("_gcl_ls"); } catch {}
  // Conversion Linker uses the root path; no cookie overrides are enabled.
  // Only cookies accessible on this homepage can be removed by JavaScript.
  const domains = new Set(["", win.location.hostname, "." + win.location.hostname, "asherhealthcare.in", ".asherhealthcare.in"]);
  try {
    const names = doc.cookie.split(";").map(part => part.trim().split("=")[0])
      .filter(name => /^_(?:gcl|gac)_[A-Za-z0-9_-]+$/u.test(name));
    for (const name of names) for (const domain of domains) {
      const removal = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; SameSite=Lax${domain ? "; Domain=" + domain : ""}`;
      doc.cookie = removal;
      doc.cookie = removal + "; Partitioned";
    }
  } catch {}
}

export function getHomepageConsent(win, nav) {
  if (!homepageGtmAllowed(win.location, nav)) return { eligible: false, choice: null };
  const controller = win.__asherHomepageConsentController;
  return { eligible: true, choice: controller ? controller.getChoice() : readPreference(win)?.choice ?? null };
}

export function setHomepageConsent(win, doc, nav, choice) {
  if (!["accepted", "declined"].includes(choice)) return;
  installHomepageGtm(win, doc, nav);
  win.__asherHomepageConsentController?.choose(choice);
}

// Loaded Google code cannot be removed safely. This document-scoped guard stops
// new transports immediately on withdrawal, before a clean-document reload.
// It also blocks unneeded Analytics/audience endpoints from implicit tag deps.
function guardGoogleTransports(win, allowed) {
  function blocked(raw) {
    let url;
    try { url = new URL(String(raw), win.location.href); } catch { return false; }
    const google = /(^|\.)(googletagmanager\.com|googleadservices\.com|doubleclick\.net|googlesyndication\.com|google-analytics\.com)$/iu.test(url.hostname) ||
      /(^|\.)google\.[a-z.]+$/iu.test(url.hostname);
    if (!google) return false;
    // Clinic directions embeds are not Ads measurement transports.
    if (/^\/(?:maps)(?:\/|$)/u.test(url.pathname) && /(^|\.)google\.[a-z.]+$/iu.test(url.hostname)) return false;
    if (!allowed()) return true;
    if (url.protocol !== "https:") return true;
    if (url.hostname === "www.googletagmanager.com") {
      return !((url.pathname === "/gtm.js" && url.searchParams.get("id") === "GTM-TQC7XR38") ||
        (["/gtag/js", "/gtag/destination"].includes(url.pathname) && url.searchParams.get("id") === "AW-18404988056"));
    }
    // Fail closed for implicit page-view, audience and Analytics pings. Only
    // the reviewed, labeled Call-link intent may use the conversion transport.
    const phoneEndpoint = (url.hostname === "www.googleadservices.com" && /^\/pagead\/conversion\/18404988056\/?$/u.test(url.pathname)) ||
      (url.hostname === "www.google.com" && /^\/pagead\/1p-conversion\/18404988056\/?$/u.test(url.pathname));
    return !(phoneEndpoint && url.searchParams.get("en") === "conversion" &&
      url.searchParams.get("label") === "WvCgCOHZrpwdEJipl8hE" &&
      url.searchParams.get("npa") === "1" && url.searchParams.get("rdp") === "1");
  }
  if (typeof win.fetch === "function") {
    const fetch = win.fetch.bind(win);
    win.fetch = (input, init) => blocked(input?.url ?? input) ? Promise.reject(new Error("Optional measurement is disabled.")) : fetch(input, init);
  }
  if (typeof win.navigator?.sendBeacon === "function") {
    const beacon = win.navigator.sendBeacon.bind(win.navigator);
    try { win.navigator.sendBeacon = (url, data) => blocked(url) ? false : beacon(url, data); } catch {}
  }
  const xhr = win.XMLHttpRequest?.prototype;
  if (xhr) {
    const targets = new WeakMap(); const open = xhr.open; const send = xhr.send;
    xhr.open = function(method, url, ...args) { targets.set(this, url); return open.call(this, method, url, ...args); };
    xhr.send = function(...args) { if (blocked(targets.get(this))) return this.abort(); return send.apply(this, args); };
  }
  for (const type of [win.HTMLImageElement, win.HTMLScriptElement, win.HTMLIFrameElement]) {
    const prototype = type?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "src");
    if (descriptor?.configurable && descriptor.set) Object.defineProperty(prototype, "src", {
      ...descriptor, set(value) { if (!blocked(value)) descriptor.set.call(this, value); },
    });
  }
  const element = win.Element?.prototype;
  if (element?.setAttribute) {
    const setAttribute = element.setAttribute;
    element.setAttribute = function(name, value) {
      if (String(name).toLowerCase() === "src" && /^(IMG|SCRIPT|IFRAME)$/u.test(this.tagName) && blocked(value)) return;
      return setAttribute.call(this, name, value);
    };
  }
}

// Fragments keep the doctor choice out of server URLs and referrers. Drop all
// other legacy query parameters when forwarding to the untracked booking page.
export function legacyBookingDestination(location) {
  if (location.pathname !== "/") return null;
  const query = new URLSearchParams(location.search);
  const fragmentDoctor = location.hash.match(/^#appointment-(pediatrics|obg)$/u)?.[1];
  const queryDoctor = query.get("care");
  const doctor = fragmentDoctor ?? (queryDoctor === "pediatrics" || queryDoctor === "obg" ? queryDoctor : null);
  if (doctor) return `/book#appointment-${doctor}`;
  if (location.hash === "#visit" || location.hash === "#journey") return `/book${location.hash}`;
  if (/^#appointment(?:-|$)/u.test(location.hash) || query.has("care")) return "/book";
  return null;
}

export function homepageGtmAllowed(location, navigator) {
  return location.protocol === "https:" && PRODUCTION_HOSTS.has(location.hostname) &&
    location.pathname === "/" && advertisingAnnotations(location) !== null && GENERAL_HASHES.has(location.hash) &&
    navigator.doNotTrack !== "1" && navigator.globalPrivacyControl !== true;
}

export function crossesHomepageBoundary(documentPath, nextPath) {
  return documentPath !== nextPath && (documentPath === "/" || nextPath === "/");
}

export function leaveTaggedErrorPage(win) {
  if (win.__asherHomepageGtmLoaded) win.location.replace("/?untracked=1");
}

// An executed tag manager cannot be unloaded by removing a script node. Every
// transition away from its approved document must therefore load a new document.
export function installHomepageGtm(win, doc, nav) {
  const legacy = legacyBookingDestination(win.location);
  if (legacy) {
    win.location.replace(legacy);
    return;
  }
  if (!homepageGtmAllowed(win.location, nav) || installedDocuments.has(doc) || win.__asherHomepageGtmDocument === doc) return;
  installedDocuments.add(doc);
  // The parser bootstrap and hydrated bundle are separate module instances.
  // Share the exact document identity so they cannot install two containers.
  win.__asherHomepageGtmDocument = doc;
  // Keep recognized click IDs only in this closure while a choice is pending.
  // Removing them now prevents accidental pre-consent propagation by links.
  let annotations = advertisingAnnotations(win.location);
  const replaceState = win.history.replaceState.bind(win.history);
  if (win.location.search) replaceState(null, "", "/" + win.location.hash);
  let preference = readPreference(win);
  let choice = preference?.choice ?? null;
  let expiresAt = preference?.expiresAt ?? 0;
  let persisted = Boolean(preference);
  let leaving = false;
  let unsafeSavedAcceptance = false;
  let expiryTimer;
  // The existing native conversion template reads document.title directly,
  // independently of gtag page_title. Use the same neutral brand here too.
  function keepNeutralTitle() {
    // At parser time the server-rendered title may not have been parsed yet.
    // Do not create a second title node ahead of it.
    if (doc.querySelector?.("title") === null) return;
    if (doc.title !== "Asher Healthcare") doc.title = "Asher Healthcare";
  }
  keepNeutralTitle();
  // Next's metadata sits outside the route-content boundary. Keep it neutral
  // while this tagged document is leaving, including delayed conversion work.
  if (typeof win.MutationObserver === "function") {
    const titleGuard = new win.MutationObserver(keepNeutralTitle);
    titleGuard.observe(doc.head, { childList: true, subtree: true, characterData: true });
  }

  function destination(raw) {
    const url = new URL(raw, win.location.href);
    if (url.origin !== win.location.origin) return null;
    const booking = legacyBookingDestination(url);
    if (booking) return new URL(booking, url.origin);
    if (homepageGtmAllowed(url, nav)) return null;
    // A hash-only navigation normally reuses the same document. A fixed marker
    // makes unknown fragments load an untracked document instead.
    if (url.pathname === "/" && url.search === "") url.search = "?untracked=1";
    return url;
  }

  function onClick(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target?.closest?.("a[href]");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const next = destination(link.href);
    if (!next) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopMeasurement();
    leaving = true;
    win.location.assign(next.href);
  }
  doc.addEventListener("click", onClick, true);

  for (const method of ["pushState", "replaceState"]) {
    const original = win.history[method].bind(win.history);
    win.history[method] = function (state, unused, url) {
      if (url != null) {
        const next = destination(String(url));
        if (next) {
          stopMeasurement();
          leaving = true;
          win.location[method === "replaceState" ? "replace" : "assign"](next.href);
          return;
        }
      }
      return original(state, unused, url);
    };
  }

  function enforce() {
    keepNeutralTitle();
    const booking = legacyBookingDestination(win.location);
    if (booking) { stopMeasurement(); leaving = true; win.location.replace(booking); }
    else if (!homepageGtmAllowed(win.location, nav)) {
      stopMeasurement();
      leaving = true;
      notify();
      win.location.reload();
    } else if (choice === "accepted" && (Date.now() >= expiresAt ||
        (persisted && readPreference(win)?.choice !== "accepted"))) revoke(false);
  }
  win.addEventListener("hashchange", enforce, true);
  win.addEventListener("popstate", enforce, true);
  win.addEventListener("pageshow", (event = {}) => {
    // Back/forward may restore an old Google-loaded document from BFCache.
    // Never reactivate its detached/leaving controller or stale listeners.
    if (event.persisted && leaving) win.location.reload();
    else enforce();
  }, true);
  doc.addEventListener("visibilitychange", enforce);

  // Permit only the existing Google tag, conversion linker, call-click tag and
  // their native link/URL variables. Custom scripts, remarketing tags and form
  // listeners cannot be enabled by a later container edit alone.
  // https://developers.google.com/tag-platform/tag-manager/restrict
  win.dataLayer = win.dataLayer || [];
  win.dataLayer.push({ "gtm.allowlist": ["googtag", "gclidw", "awct", "lcl", "e", "v", "u", "f", "aev"] });
  function command() { win.dataLayer.push(arguments); }
  // Google's Basic Consent Mode: queue defaults but load no Google code until
  // an affirmative, unexpired preference exists. Personalization stays denied.
  command("consent", "default", {
    ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied",
    ad_personalization: "denied", personalization_storage: "denied",
  });
  command("set", {
    allow_ad_personalization_signals: false, allow_google_signals: false,
    allow_enhanced_conversions: false, ads_data_redaction: true, url_passthrough: false,
    restricted_data_processing: true,
    send_page_view: false,
    linker: { domains: [], decorate_forms: false, accept_incoming: false },
    page_location: "https://asherhealthcare.in/", page_referrer: "", page_title: "Asher Healthcare",
  });
  win.gtag = command;

  function allowed() {
    return !leaving && choice === "accepted" && Date.now() < expiresAt &&
      homepageGtmAllowed(win.location, nav) && (!persisted || readPreference(win)?.choice === "accepted");
  }
  guardGoogleTransports(win, allowed);
  function notify() {
    if (typeof win.Event === "function") win.dispatchEvent(new win.Event("asher:measurement-consent"));
  }
  function stopMeasurement() {
    choice = "declined";
    command("consent", "update", {
      ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
      analytics_storage: "denied", personalization_storage: "denied",
    });
    clearMeasurementStorage(win, doc);
    annotations = "";
    if (win.location.pathname === "/" && GENERAL_HASHES.has(win.location.hash) && advertisingAnnotations(win.location) !== null) {
      replaceState(null, "", "/" + win.location.hash);
    }
  }
  function revoke(saveChoice) {
    if (leaving) return;
    if (saveChoice) save("declined");
    stopMeasurement();
    if (!saveChoice) choice = readPreference(win)?.choice === "declined" ? "declined" : null;
    notify();
    if (win.__asherHomepageGtmLoaded) {
      leaving = true;
      // Moving to a fresh document evicts timers/listeners installed by Google.
      win.location.replace("/" + (unsafeSavedAcceptance ? "?untracked=1" : "") + (GENERAL_HASHES.has(win.location.hash) ? win.location.hash : ""));
    }
  }
  function scheduleExpiry() {
    if (expiryTimer != null) win.clearTimeout?.(expiryTimer);
    if (typeof win.setTimeout === "function" && choice === "accepted") {
      // Browser timers cap around 24.8 days. Recheck instead of expiring early.
      expiryTimer = win.setTimeout(() => {
        enforce();
        if (allowed()) scheduleExpiry();
      }, Math.min(2147483647, Math.max(1, expiresAt - Date.now())));
    }
  }
  function save(next) {
    choice = next;
    expiresAt = Date.now() + CONSENT_MAX_AGE;
    preference = { v: 1, choice, expiresAt };
    try {
      win.localStorage.setItem(HOMEPAGE_CONSENT_KEY, JSON.stringify(preference));
      persisted = readPreference(win)?.choice === next;
    } catch { persisted = false; }
    if (next === "declined" && !persisted) {
      try { win.localStorage.removeItem(HOMEPAGE_CONSENT_KEY); } catch {}
      // Never let an unreadable/unremovable old acceptance restart Google on
      // the withdrawal reload. The untracked marker is deliberately excluded.
      try { unsafeSavedAcceptance = win.localStorage.getItem(HOMEPAGE_CONSENT_KEY) !== null; }
      catch { unsafeSavedAcceptance = true; }
    }
  }
  function startMeasurement() {
    if (!allowed() || win.__asherHomepageGtmLoaded) return;
    // Restore only validated click IDs after acceptance. Native Conversion
    // Linker can then read them. Unknown keys/free text never enter this path.
    if (annotations) replaceState(null, "", "/?" + annotations + win.location.hash);
    command("set", { page_location: "https://asherhealthcare.in/" + (annotations ? "?" + annotations : "") });
    command("consent", "update", {
      ad_storage: "granted", ad_user_data: "granted", ad_personalization: "denied",
      analytics_storage: "denied", personalization_storage: "denied",
    });
    win.__asherHomepageGtmLoaded = true;
    const script = doc.createElement("script");
    script.id = ORIGINAL_SCRIPT_ID;
    script.textContent = GOOGLE_GTM_SOURCE;
    doc.head.appendChild(script);
    scheduleExpiry();
  }
  win.__asherHomepageConsentController = {
    document: doc,
    getChoice: () => choice,
    choose(next) {
      if (leaving || !homepageGtmAllowed(win.location, nav)) return;
      if (next === "declined") revoke(true);
      else if (next === "accepted") { save(next); startMeasurement(); notify(); }
    },
  };
  win.addEventListener("storage", event => {
    if (event.key === HOMEPAGE_CONSENT_KEY || event.key === null) {
      if (choice === "accepted" && readPreference(win)?.choice !== "accepted") revoke(false);
      else enforce();
    }
  });
  if (choice === "accepted") startMeasurement();
  else clearMeasurementStorage(win, doc);
}

// Build-time only: emit the same reviewed runtime, not a second hand-maintained
// snippet. The export adapter places this source only in the homepage HTML.
export function createHomepageGtmBootstrap() {
  const declarations = [
    `const PRODUCTION_HOSTS = new Set(${JSON.stringify([...PRODUCTION_HOSTS])});`,
    `const GENERAL_HASHES = new Set(${JSON.stringify([...GENERAL_HASHES])});`,
    `const AD_ANNOTATION_KEYS = new Set(${JSON.stringify([...AD_ANNOTATION_KEYS])});`,
    `const GOOGLE_GTM_SOURCE = ${JSON.stringify(GOOGLE_GTM_SOURCE)};`,
    `const ORIGINAL_SCRIPT_ID = ${JSON.stringify(ORIGINAL_SCRIPT_ID)};`,
    `const HOMEPAGE_CONSENT_KEY = ${JSON.stringify(HOMEPAGE_CONSENT_KEY)};`,
    `const CONSENT_MAX_AGE = ${CONSENT_MAX_AGE};`,
    "const installedDocuments = new WeakSet();",
  ];
  return [
    "(function(){\"use strict\";",
    ...declarations,
    readPreference.toString(),
    advertisingAnnotations.toString(),
    clearMeasurementStorage.toString(),
    guardGoogleTransports.toString(),
    legacyBookingDestination.toString(),
    homepageGtmAllowed.toString(),
    installHomepageGtm.toString(),
    "installHomepageGtm(window, document, navigator);",
    "})();",
  ].join("\n");
}
