const PRODUCTION_HOSTS = new Set(["asherhealthcare.in", "www.asherhealthcare.in"]);
const GENERAL_HASHES = new Set(["", "#top", "#main-content", "#services", "#care", "#doctors", "#moments-of-care", "#contact", "#faq", "#book-visit"]);
const SCRIPT_ID = "asher-homepage-gtm";
const installedDocuments = new WeakSet();
const AD_ANNOTATION_KEYS = new Set(["gclid", "gbraid", "wbraid", "gad_source", "gad_campaignid"]);

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
    location.pathname === "/" && location.search === "" && GENERAL_HASHES.has(location.hash) &&
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
  // Ads arrivals can carry opaque click annotations. Discard a strictly known
  // annotation-only query BEFORE loading Google; never retain or forward IDs.
  // Unknown, medical, booking, UTM and debug/auth parameters remain excluded.
  if (win.location.protocol === "https:" && PRODUCTION_HOSTS.has(win.location.hostname) &&
      win.location.pathname === "/" && GENERAL_HASHES.has(win.location.hash) && win.location.search) {
    const entries = [...new URLSearchParams(win.location.search)];
    const keys = new Set(entries.map(([key]) => key));
    if (entries.length > 0 && keys.size === entries.length && entries.every(([key, value]) =>
      AD_ANNOTATION_KEYS.has(key) && /^[A-Za-z0-9_-]{1,256}$/u.test(value))) {
      win.history.replaceState(null, "", "/" + win.location.hash);
    }
  }
  if (!homepageGtmAllowed(win.location, nav) || installedDocuments.has(doc)) return;
  installedDocuments.add(doc);
  win.__asherHomepageGtmLoaded = true;
  // The existing native conversion template reads document.title directly,
  // independently of gtag page_title. Use the same neutral brand here too.
  function keepNeutralTitle() {
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
    win.location.assign(next.href);
  }
  doc.addEventListener("click", onClick, true);

  for (const method of ["pushState", "replaceState"]) {
    const original = win.history[method].bind(win.history);
    win.history[method] = function (state, unused, url) {
      if (url != null) {
        const next = destination(String(url));
        if (next) {
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
    if (booking) win.location.replace(booking);
    else if (!homepageGtmAllowed(win.location, nav)) win.location.reload();
  }
  win.addEventListener("hashchange", enforce, true);
  win.addEventListener("popstate", enforce, true);
  win.addEventListener("pageshow", enforce, true);
  doc.addEventListener("visibilitychange", enforce);

  // Permit only the existing Google tag, conversion linker, call-click tag and
  // their native link/URL variables. Custom scripts, remarketing tags and form
  // listeners cannot be enabled by a later container edit alone.
  // https://developers.google.com/tag-platform/tag-manager/restrict
  win.dataLayer = win.dataLayer || [];
  win.dataLayer.push({ "gtm.allowlist": ["googtag", "gclidw", "awct", "lcl", "e", "v", "u", "f", "aev"] });
  function command() { win.dataLayer.push(arguments); }
  // Never infer or grant visitor advertising consent. These defaults precede
  // container initialization, and remain denied (there is no consent popup).
  command("consent", "default", {
    ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied",
    ad_personalization: "denied", personalization_storage: "denied",
  });
  command("set", {
    allow_ad_personalization_signals: false, allow_google_signals: false,
    allow_enhanced_conversions: false, ads_data_redaction: true, url_passthrough: false,
    restricted_data_processing: true,
    page_location: "https://asherhealthcare.in/", page_referrer: "", page_title: "Asher Healthcare",
  });
  win.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = doc.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = "https://www.googletagmanager.com/gtm.js?id=GTM-TQC7XR38";
  doc.head.appendChild(script);
  // Listeners deliberately live for this document's lifetime, including React
  // remounts and BFCache restores; the WeakSet prevents duplicate installation.
}
