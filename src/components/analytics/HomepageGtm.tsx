"use client";

import { useEffect } from "react";
import { installHomepageGtm } from "@/lib/homepage-gtm.mjs";

export default function HomepageGtm() {
  useEffect(() => {
    installHomepageGtm(window, document, navigator);
  }, []);
  // No unconditional noscript iframe: it cannot apply URL, host or DNT/GPC
  // checks. Booking and calling remain available without this container.
  return null;
}
