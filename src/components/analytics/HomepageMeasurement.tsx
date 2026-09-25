"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const PHONE_HREF = "tel:+919019263709";
const DIRECTIONS_HREF = "https://maps.app.goo.gl/cvFLUCkF6nRPAHUx5";
const ENDPOINT = "/api/analytics/homepage";
const PRODUCTION_HOSTS = new Set(["asherhealthcare.in", "www.asherhealthcare.in"]);
type HomepageEvent = "homepage_view" | "call_click" | "directions_click";

// In-memory flags only: no persistent identifier, cookie or browser storage.
let homepageCounted = false;
const lastClick = { call_click: 0, directions_click: 0 };

function measurementAllowed() {
  const privacyNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
  return (
    window.location.protocol === "https:" &&
    PRODUCTION_HOSTS.has(window.location.hostname) &&
    window.location.pathname === "/" &&
    document.visibilityState === "visible" &&
    navigator.doNotTrack !== "1" &&
    privacyNavigator.globalPrivacyControl !== true
  );
}

function count(event: HomepageEvent) {
  if (!measurementAllowed()) return;
  // Fixed enum only. Never include the page URL, referrer, form contents or link text.
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      keepalive: true,
      mode: "same-origin",
    }).catch(() => {});
  } catch {
    // Measurement must never delay or break calling, directions or booking.
  }
}

export function HomepageMeasurement() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/") return;

    function countView() {
      if (homepageCounted || !measurementAllowed()) return;
      homepageCounted = true;
      count("homepage_view");
    }

    function onClick(event: MouseEvent) {
      if (!event.isTrusted || event.defaultPrevented || !measurementAllowed()) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      const href = link?.getAttribute("href");
      const kind = href === PHONE_HREF
        ? "call_click"
        : href === DIRECTIONS_HREF ? "directions_click" : null;
      if (!kind) return;
      const now = performance.now();
      if (lastClick[kind] && now - lastClick[kind] < 1500) return;
      lastClick[kind] = now;
      count(kind);
    }

    countView();
    document.addEventListener("visibilitychange", countView);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("visibilitychange", countView);
      document.removeEventListener("click", onClick);
    };
  }, [pathname]);

  return null;
}
