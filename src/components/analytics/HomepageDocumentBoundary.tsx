"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { crossesHomepageBoundary } from "@/lib/homepage-gtm.mjs";

export default function HomepageDocumentBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [documentPath] = useState(pathname);
  const crossing = crossesHomepageBoundary(documentPath, pathname);
  useEffect(() => {
    if (crossing) window.location.reload();
  }, [crossing]);
  // Defense in depth for future Next Link/router changes: never mount a booking
  // form or private workspace in a document that executed the homepage loader.
  return crossing ? null : children;
}
