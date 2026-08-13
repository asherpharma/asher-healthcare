"use client";

import { firestore } from "@/firebase/config";
import {
  cloneServiceCatalog,
  DEFAULT_SERVICE_CATALOG,
  normalizeServiceCatalog,
} from "@/lib/service-catalog";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";

export function useServiceCatalog() {
  const [catalog, setCatalog] = useState(() => cloneServiceCatalog(DEFAULT_SERVICE_CATALOG));
  const [loading, setLoading] = useState(Boolean(firestore));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firestore) return;
    return onSnapshot(
      doc(firestore, "clinicSettings", "serviceCatalog"),
      (snapshot) => {
        setCatalog(normalizeServiceCatalog(snapshot.data()));
        setLoading(false);
        setError("");
      },
      () => {
        setLoading(false);
        setError("Live consultation services and fees could not be refreshed.");
      },
    );
  }, []);

  return { catalog, loading, error };
}
