"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import styles from "./AdsClickMeasurement.module.css";

const CONSENT_STORAGE_KEY = "asher_ads_measurement_consent_v1";
const SCRIPT_ID = "asher-google-ads-tag";
const PHONE_HREF = "tel:+919019263709";
const DIRECTIONS_HREF = "https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5";
const NEUTRAL_PAGE_CONTEXT = {
  page_location: "https://asherhealthcare.in/",
  page_referrer: "",
  page_title: "Asher Healthcare",
} as const;

const adsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? "";
const phoneClickLabel =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_PHONE_CLICK_LABEL ?? "";
const directionsClickLabel =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_DIRECTIONS_CLICK_LABEL ?? "";
const measurementEnabled =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_CLICK_MEASUREMENT_ENABLED === "true";

const adsIdPattern = /^AW-\d+$/u;
const conversionLabelPattern = /^[A-Za-z0-9_-]+$/u;
const isConfigured =
  measurementEnabled &&
  adsIdPattern.test(adsId) &&
  conversionLabelPattern.test(phoneClickLabel) &&
  conversionLabelPattern.test(directionsClickLabel);

const initialDocumentLocation =
  typeof window === "undefined"
    ? null
    : {
        hash: window.location.hash,
        pathname: window.location.pathname,
        search: window.location.search,
      };
const allowedPublicPaths = new Set(["/"]);
const allowedQueryKeys = new Set([
  "gad_campaignid",
  "gad_source",
  "gbraid",
  "gclid",
  "wbraid",
]);
const allowedHashes = new Set([
  "",
  "#appointment",
  "#care",
  "#clinic",
  "#contact",
  "#doctors",
  "#journey",
  "#main-content",
  "#services",
  "#top",
]);

type ConsentChoice = "granted" | "denied";

declare global {
  interface Window {
    __asherAdsClickMeasurementEnabled?: boolean;
    dataLayer?: IArguments[];
    gtag?: (...args: unknown[]) => void;
  }
}

function isAllowedPublicPath(pathname: string) {
  return allowedPublicPaths.has(pathname);
}

function hasOnlyAllowedQueryKeys(searchParams: {
  keys(): IterableIterator<string>;
}) {
  return Array.from(searchParams.keys()).every((key) => allowedQueryKeys.has(key));
}

function hasAllowedHomepageUrlContext() {
  return (
    window.location.pathname === "/" &&
    hasOnlyAllowedQueryKeys(new URLSearchParams(window.location.search)) &&
    allowedHashes.has(window.location.hash)
  );
}

function hasAllowedInitialHomepageUrlContext() {
  return Boolean(
    initialDocumentLocation &&
      initialDocumentLocation.pathname === "/" &&
      hasOnlyAllowedQueryKeys(
        new URLSearchParams(initialDocumentLocation.search),
      ) &&
      allowedHashes.has(initialDocumentLocation.hash),
  );
}

function initializeAdsMeasurement() {
  if (
    !isConfigured ||
    readStoredChoice() !== "granted" ||
    !hasAllowedInitialHomepageUrlContext() ||
    !hasAllowedHomepageUrlContext() ||
    window.__asherAdsClickMeasurementEnabled
  ) {
    return Boolean(window.__asherAdsClickMeasurementEnabled);
  }

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // Google documents this exact queue shape for gtag.js.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };

  const gtag = window.gtag;

  // These defaults are queued locally before the Google script is inserted.
  // No request to Google is possible until the visitor has already opted in.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  gtag("set", "allow_ad_personalization_signals", false);
  gtag("set", "allow_google_signals", false);
  gtag("set", "allow_interest_groups", false);
  gtag("set", "ads_data_redaction", true);
  gtag("set", NEUTRAL_PAGE_CONTEXT);
  gtag("consent", "update", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  gtag("js", new Date());
  gtag("config", adsId, {
    ...NEUTRAL_PAGE_CONTEXT,
    allow_ad_personalization_signals: false,
    allow_google_signals: false,
    allow_interest_groups: false,
    send_page_view: false,
  });

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(adsId)}`;
  document.head.appendChild(script);

  window.__asherAdsClickMeasurementEnabled = true;
  return true;
}

function clearAdsCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=", 1)[0]?.trim();
    if (!name?.startsWith("_gcl_")) continue;

    const expiry = "expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = `${name}=; ${expiry}; path=/; SameSite=Lax`;
    document.cookie = `${name}=; ${expiry}; path=/; domain=.asherhealthcare.in; SameSite=Lax`;
  }
}

function readStoredChoice(): ConsentChoice | null {
  try {
    const storedChoice = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return storedChoice === "granted"
      ? "granted"
      : storedChoice === "denied"
        ? "denied"
        : null;
  } catch {
    return null;
  }
}

function storeChoice(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

function stopLoadedMeasurement() {
  storeChoice("denied");
  window.__asherAdsClickMeasurementEnabled = false;
  clearAdsCookies();
  window.location.reload();
}

export function AdsClickMeasurement() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isReady, setIsReady] = useState(false);
  const [hashReady, setHashReady] = useState(false);
  const [hashAllowed, setHashAllowed] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [tagEnabled, setTagEnabled] = useState(false);
  const blockedHere = !isAllowedPublicPath(pathname);
  const queryAllowed = hasOnlyAllowedQueryKeys(searchParams);
  const tagBlocked = blockedHere || !queryAllowed || !hashReady || !hashAllowed;
  const documentBoundaryChanged = Boolean(
    initialDocumentLocation &&
      (initialDocumentLocation.pathname === "/") !== (pathname === "/"),
  );

  useEffect(() => {
    if (!isConfigured) return;

    const forceHomepageDocumentBoundary = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.origin);
      const currentIsHomepage = window.location.pathname === "/";
      const destinationIsHomepage = destination.pathname === "/";
      const destinationHasAllowedHomepageContext =
        destinationIsHomepage &&
        hasOnlyAllowedQueryKeys(destination.searchParams) &&
        allowedHashes.has(destination.hash);
      const crossesHomepageBoundary =
        currentIsHomepage !== destinationIsHomepage;
      const entersUnsafeHomepageContext =
        currentIsHomepage &&
        destinationIsHomepage &&
        !destinationHasAllowedHomepageContext;
      if (
        destination.origin !== window.location.origin ||
        (!crossesHomepageBoundary && !entersUnsafeHomepageContext)
      ) {
        return;
      }

      event.preventDefault();
      if (entersUnsafeHomepageContext) {
        if (window.__asherAdsClickMeasurementEnabled) {
          stopLoadedMeasurement();
        }
        return;
      }
      window.location.assign(destination.toString());
    };

    document.addEventListener("click", forceHomepageDocumentBoundary, true);
    return () => {
      document.removeEventListener("click", forceHomepageDocumentBoundary, true);
    };
  }, []);

  useEffect(() => {
    if (!isConfigured || !documentBoundaryChanged) return;

    // This is a fallback for programmatic routing. Normal homepage boundary
    // links are converted to a full document navigation by the capture above.
    window.location.reload();
  }, [documentBoundaryChanged]);

  useEffect(() => {
    const updateHashSafety = () => {
      setHashAllowed(allowedHashes.has(window.location.hash));
      setHashReady(true);
    };

    updateHashSafety();
    window.addEventListener("hashchange", updateHashSafety);
    return () => window.removeEventListener("hashchange", updateHashSafety);
  }, []);

  useEffect(() => {
    if (
      documentBoundaryChanged ||
      !tagBlocked ||
      !window.__asherAdsClickMeasurementEnabled
    ) {
      return;
    }

    // A root layout survives client-side navigation. This fallback unloads an
    // already-loaded tag if code navigates without using the link guard below.
    stopLoadedMeasurement();
  }, [documentBoundaryChanged, tagBlocked]);

  useEffect(() => {
    if (
      !isConfigured ||
      blockedHere ||
      !hashReady ||
      (queryAllowed && hashAllowed) ||
      !initialDocumentLocation ||
      initialDocumentLocation.pathname !== "/"
    ) {
      return;
    }

    const contextChanged =
      initialDocumentLocation.search !== window.location.search ||
      initialDocumentLocation.hash !== window.location.hash;
    if (!contextChanged) return;

    if (window.__asherAdsClickMeasurementEnabled) {
      stopLoadedMeasurement();
      return;
    }
    window.location.reload();
  }, [blockedHere, hashAllowed, hashReady, queryAllowed]);

  useEffect(() => {
    if (!isConfigured || blockedHere) return;

    // This browser-only read intentionally completes the post-hydration state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(readStoredChoice());
    setIsReady(true);
  }, [blockedHere]);

  useEffect(() => {
    if (!isReady || tagBlocked || choice !== "granted") return;

    // Tag initialization is the external system synchronized by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTagEnabled(initializeAdsMeasurement());
  }, [choice, isReady, tagBlocked]);

  useEffect(() => {
    const handleStoredChoice = (event: StorageEvent) => {
      if (
        (event.key !== CONSENT_STORAGE_KEY && event.key !== null) ||
        event.newValue === "granted"
      ) {
        return;
      }

      if (window.__asherAdsClickMeasurementEnabled) {
        stopLoadedMeasurement();
        return;
      }

      setChoice("denied");
      setPreferencesOpen(false);
    };

    window.addEventListener("storage", handleStoredChoice);
    return () => window.removeEventListener("storage", handleStoredChoice);
  }, []);

  useEffect(() => {
    const recheckRestoredPage = (event: PageTransitionEvent) => {
      if (!event.persisted) return;

      const restoredChoice = readStoredChoice();
      if (restoredChoice === "granted") return;

      if (window.__asherAdsClickMeasurementEnabled) {
        stopLoadedMeasurement();
        return;
      }

      setChoice(restoredChoice === "denied" ? "denied" : null);
      setPreferencesOpen(false);
    };

    window.addEventListener("pageshow", recheckRestoredPage);
    return () => window.removeEventListener("pageshow", recheckRestoredPage);
  }, []);

  useEffect(() => {
    if (!tagEnabled || tagBlocked || choice !== "granted") return;

    const recordFixedClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      const href = anchor?.getAttribute("href");
      const label =
        href === PHONE_HREF
          ? phoneClickLabel
          : href === DIRECTIONS_HREF
            ? directionsClickLabel
            : null;

      if (
        !label ||
        readStoredChoice() !== "granted" ||
        !hasAllowedHomepageUrlContext() ||
        !window.__asherAdsClickMeasurementEnabled ||
        !window.gtag
      ) {
        return;
      }

      window.gtag("event", "conversion", {
        ...NEUTRAL_PAGE_CONTEXT,
        send_to: `${adsId}/${label}`,
      });
    };

    document.addEventListener("click", recordFixedClick);
    return () => {
      document.removeEventListener("click", recordFixedClick);
    };
  }, [choice, tagBlocked, tagEnabled]);

  if (!isConfigured || blockedHere || !isReady) return null;

  const saveChoice = (nextChoice: ConsentChoice) => {
    if (nextChoice === "granted") {
      if (!storeChoice(nextChoice)) {
        setChoice("denied");
        setPreferencesOpen(false);
        return;
      }
    } else {
      storeChoice(nextChoice);
    }
    setChoice(nextChoice);
    setPreferencesOpen(false);
  };

  const stopMeasurement = () => {
    stopLoadedMeasurement();
  };

  const showPanel = choice === null || preferencesOpen;

  return (
    <>
      {showPanel ? (
        <section
          aria-labelledby="asher-cookie-title"
          aria-describedby="asher-cookie-summary"
          className={styles.panel}
          role="dialog"
        >
          <div className={styles.copy}>
            <div className={styles.heading}>
              <svg className={styles.cookie} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M20.5 13a5 5 0 0 1-5.5-5.5A5 5 0 0 1 10 3a9 9 0 1 0 10.5 10Z" />
                <circle cx="8" cy="10" r=".8" /><circle cx="8" cy="16" r=".8" /><circle cx="14" cy="16" r=".8" />
              </svg>
              <h2 id="asher-cookie-title">Your cookie choices</h2>
            </div>
            <p id="asher-cookie-summary">
              Optional Google Ads cookies help us measure homepage call and
              directions clicks. Google receives homepage and technical
              information. No personalised ads. Booking works either way.
            </p>
            <details className={styles.details}>
              <summary>About these cookies</summary>
              <p>
              If you accept, this homepage immediately loads Google Ads
              measurement. Google may use cookies and receives this homepage
              address and title, plus technical browser, network and
              advertising-click information. Clicking the clinic
              phone or directions link sends a separate click-measurement event.
              We do not intentionally send appointment-form or medical details,
              and we do not use this for personalised ads. Declining does not
              affect the site.
              </p>
              <p>These controls apply only to optional Google Ads measurement,
                not essential site cookies or separate Cloudflare analytics.</p>
              <a href="/privacy">Read the privacy policy</a>
            </details>
          </div>
          <div className={styles.actions}>
            {choice === "granted" ? (
              <>
                <button
                  className={styles.secondary}
                  onClick={stopMeasurement}
                  type="button"
                >
                  Reject optional
                </button>
                <button
                  className={styles.primary}
                  onClick={() => setPreferencesOpen(false)}
                  type="button"
                >
                  Keep accepted
                </button>
              </>
            ) : (
              <>
                <button
                  className={styles.primary}
                  onClick={() => saveChoice("granted")}
                  type="button"
                >
                  Accept cookies
                </button>
                <button
                  className={styles.secondary}
                  onClick={() => saveChoice("denied")}
                  type="button"
                >
                  Reject optional
                </button>
              </>
            )}
          </div>
        </section>
      ) : (
        <button
          className={styles.preferences}
          onClick={() => setPreferencesOpen(true)}
          type="button"
        >
          Cookie settings
        </button>
      )}
    </>
  );
}
