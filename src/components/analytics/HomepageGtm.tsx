"use client";

import { useEffect } from "react";
import { installHomepageGtm } from "@/lib/homepage-gtm.mjs";

export default function HomepageGtm() {
  useEffect(() => {
    // The initial homepage HTML bootstraps before hydration. This adopts its
    // document marker; it is also a safe fallback for local development.
    // The separate privacy preflight runs Google's original source unchanged.
    installHomepageGtm(window, document, navigator);
  }, []);
  // The export adapter emits the explicitly approved homepage-only noscript
  // fallback. This component never adds it to other routes or SPA documents.
  return null;
}
