"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import {
  AlertTriangle,
  CheckCircle2,
  CloudCog,
  LoaderCircle,
  RefreshCw,
  ServerCog,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type ServiceHealth = {
  status: "operational" | "configured" | "attention";
  mode?: "live" | "test" | "unknown" | "unconfigured";
};
type HealthResponse = {
  checkedAt: string;
  responseTimeMs: number;
  release: string;
  services: {
    database: ServiceHealth;
    authentication: ServiceHealth;
    payments: ServiceHealth;
    clinicalReports: ServiceHealth;
  };
  error?: string;
};

const serviceLabels: Record<keyof HealthResponse["services"], string> = {
  database: "Patient database",
  authentication: "Staff authentication",
  payments: "Payment gateway",
  clinicalReports: "Secure lab reports",
};

export default function SystemHealthPanel() {
  const { user } = useStaff();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    setLoading(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/health", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json() as HealthResponse;
      if (!response.ok) throw new Error(result.error || "System health could not be checked.");
      if (activeRequest.current === controller) setHealth(result);
    } catch (healthError) {
      if (activeRequest.current !== controller) return;
      setHealth(null);
      setError(
        healthError instanceof DOMException && healthError.name === "AbortError"
          ? "The system readiness check timed out. Please try again."
          : healthError instanceof Error
            ? healthError.message
            : "System health could not be checked.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }, [user]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(refreshTimer);
      activeRequest.current?.abort();
    };
  }, [refresh]);

  return (
    <section className="rounded-3xl bg-[#233A59] p-5 text-white shadow-lg shadow-[#233A59]/10 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#D4B678]"><CloudCog size={17} />Operations centre</p>
          <h2 className="mt-2 text-2xl font-bold">System readiness</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">A private database check plus configuration readiness for staff login, billing, and secure laboratory reports.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#233A59] disabled:opacity-60">
          {loading ? <LoaderCircle size={17} className="animate-spin" /> : <RefreshCw size={17} />}
          Check now
        </button>
      </div>

      {error ? (
        <p className="mt-5 flex items-start gap-2 rounded-2xl bg-red-400/15 px-4 py-3 text-sm font-semibold text-red-100"><AlertTriangle size={18} className="mt-0.5 shrink-0" />{error}</p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {health ? Object.entries(health.services).map(([key, service]) => {
          const healthy = service.status !== "attention";
          return (
            <article key={key} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
              <div className="flex items-center justify-between gap-3">
                <ServerCog size={20} className="text-[#D4B678]" />
                {healthy ? <CheckCircle2 size={18} className="text-emerald-300" /> : <AlertTriangle size={18} className="text-amber-300" />}
              </div>
              <p className="mt-4 text-sm font-bold">{serviceLabels[key as keyof HealthResponse["services"]]}</p>
              <p className={`mt-1 text-xs font-semibold ${healthy ? "text-emerald-200" : "text-amber-200"}`}>
                {key === "database" && healthy
                  ? "Operational"
                  : key === "payments" && service.mode === "test"
                    ? "TEST mode · payments are not live"
                    : key === "payments" && service.mode === "unknown"
                      ? "Payment key mode needs review"
                      : key === "payments" && service.mode === "live"
                        ? "LIVE mode"
                        : healthy
                          ? "Configured"
                          : "Needs configuration"}
              </p>
            </article>
          );
        }) : Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-white/10" />)}
      </div>

      {health ? (
        <p className="mt-5 text-xs text-white/55">Checked {new Date(health.checkedAt).toLocaleString("en-IN")} · Database response {health.responseTimeMs} ms · Release {health.release.slice(0, 12)}</p>
      ) : null}
    </section>
  );
}
