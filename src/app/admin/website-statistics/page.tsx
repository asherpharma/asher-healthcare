"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { BarChart3, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Counts = {
  homepage_view: number;
  call_click: number;
  directions_click: number;
};

type DailyCounts = Counts & { date: string };
type Report = { days: 7 | 30; timezone: "Asia/Kolkata"; rows: DailyCounts[]; totals: Counts };

const metrics = [
  { key: "homepage_view", label: "Homepage views", hint: "Page loads, not unique visitors" },
  { key: "call_click", label: "Call taps", hint: "Intent to call, not completed calls" },
  { key: "directions_click", label: "Directions taps", hint: "Intent to travel, not clinic visits" },
] as const;

function isCounts(value: unknown): value is Counts {
  if (!value || typeof value !== "object") return false;
  const counts = value as Record<string, unknown>;
  return metrics.every(({ key }) => Number.isSafeInteger(counts[key]) && Number(counts[key]) >= 0);
}

function isReport(value: unknown, days: 7 | 30): value is Report {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<Report>;
  return report.days === days
    && report.timezone === "Asia/Kolkata"
    && isCounts(report.totals)
    && Array.isArray(report.rows)
    && report.rows.length <= days
    && report.rows.every((row) => isCounts(row) && /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

function countLabel(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function WebsiteStatisticsReport() {
  const { user } = useStaff();
  const [days, setDays] = useState<7 | 30>(7);
  const [report, setReport] = useState<Report | null>(null);
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
    setReport(null);

    try {
      const token = await user.getIdToken();
      controller.signal.throwIfAborted();
      const response = await fetch(`/api/admin/homepage-counts?days=${days}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("Administrator access could not be verified. Please sign in again.");
        }
        throw new Error("Website statistics are unavailable right now. Please try again later.");
      }

      const result: unknown = await response.json();
      if (!isReport(result, days)) throw new Error("The statistics report could not be read. Please try again.");
      if (activeRequest.current === controller) setReport(result);
    } catch (requestError) {
      if (activeRequest.current !== controller) return;
      setError(
        controller.signal.aborted
          ? "The statistics request timed out. Please try again."
          : requestError instanceof Error
            ? requestError.message
            : "Website statistics could not be loaded.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }, [days, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      const request = activeRequest.current;
      activeRequest.current = null;
      request?.abort();
    };
  }, [refresh]);

  const currentReport = report?.days === days ? report : null;
  const rows = currentReport ? [...currentReport.rows].sort((a, b) => b.date.localeCompare(a.date)) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="rounded-3xl bg-[#233A59] p-5 text-white shadow-lg shadow-[#233A59]/10 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#D4B678]"><BarChart3 size={17} aria-hidden="true" />Administrator report</p>
            <h1 className="mt-2 text-2xl font-bold">Website statistics</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">Daily totals for the general clinic homepage only. No visitor profiles, patient details or individual activity history are included.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold">
              Period
              <select value={days} onChange={(event) => setDays(event.target.value === "30" ? 30 : 7)} className="mt-1 block min-h-11 rounded-xl border border-white/30 bg-white px-3 text-[#233A59] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4B678]">
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
              </select>
            </label>
            <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#233A59] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4B678] disabled:opacity-60">
              {loading ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />}
              Refresh
            </button>
          </div>
        </div>
      </section>

      <section aria-label="How to interpret these statistics" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-slate-700">
        <p className="font-bold text-[#233A59]">These are activity counts, not appointments or advertising conversions.</p>
        <p className="mt-1">Homepage views are not unique visitors; repeat views and taps can be counted. Call and directions taps do not confirm completed calls, booked appointments or clinic visits. These totals cannot identify visitors or show which Google ad led to an enquiry.</p>
      </section>

      {error ? <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">{error}</p> : null}

      <div aria-busy={loading}>
        {loading ? (
          <p role="status" className="flex items-center gap-2 rounded-2xl bg-white p-5 text-sm font-semibold text-[#233A59] ring-1 ring-slate-200"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" />Loading daily totals…</p>
        ) : currentReport ? (
          <>
            <section aria-label="Period totals" className="grid gap-4 sm:grid-cols-3">
              {metrics.map(({ key, label, hint }) => (
                <article key={key} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <p className="text-sm font-bold text-[#233A59]">{label}</p>
                  <p className="mt-3 text-3xl font-bold tabular-nums text-[#233A59]">{countLabel(currentReport.totals[key])}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
                </article>
              ))}
            </section>

            <section className="mt-5 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="px-5 py-5 sm:px-7">
                <h2 className="text-xl font-bold text-[#233A59]">Daily activity</h2>
                <p className="mt-1 text-sm text-slate-500">Last {days} days, including today. Clinic dates use India Standard Time (IST).</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <caption className="sr-only">Daily homepage views, call taps and directions taps in IST</caption>
                  <thead className="bg-slate-50 text-[#233A59]">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-bold sm:px-7">Date</th>
                      {metrics.map(({ key, label }) => <th key={key} scope="col" className="px-4 py-3 text-right font-bold">{label}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                      <tr key={row.date}>
                        <th scope="row" className="whitespace-nowrap px-5 py-3 font-medium text-slate-700 sm:px-7"><time dateTime={row.date}>{dateLabel(row.date)}</time></th>
                        {metrics.map(({ key }) => <td key={key} className="px-4 py-3 text-right tabular-nums text-slate-700">{countLabel(row[key])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">No homepage activity has been recorded for this period.</p> : null}
            </section>
            <p className="mt-4 text-xs leading-5 text-slate-500">Counts begin when this measurement is enabled; earlier activity is not backfilled. Reloads, blocked requests and automated traffic can affect totals. These aggregate counts cannot be matched to patients or used to calculate a unique-visitor conversion rate.</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function WebsiteStatisticsPage() {
  const { profile } = useStaff();

  if (profile.role !== "admin") {
    return (
      <section className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <ShieldCheck className="mx-auto text-[#A8864A]" size={38} aria-hidden="true" />
        <h1 className="mt-5 text-2xl font-bold text-[#233A59]">Administrator access required</h1>
        <p className="mt-2 text-slate-600">Only a clinic administrator can view website statistics.</p>
      </section>
    );
  }

  return <WebsiteStatisticsReport />;
}
