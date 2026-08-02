"use client";

import { Home, RefreshCw, Wifi } from "lucide-react";
import Link from "next/link";

export default function StaffErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <section className="mx-auto grid min-h-[65dvh] max-w-2xl place-items-center px-2 py-8" role="alert">
      <div className="w-full rounded-[28px] border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-9">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-700">
          <Wifi aria-hidden="true" size={26} />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Safe recovery</p>
        <h1 className="mt-2 text-2xl font-bold text-[#233A59] sm:text-3xl">This workspace did not finish loading.</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">
          No action will be repeated automatically. Confirm the latest appointment or payment
          status before re-entering any information, then reload the workspace.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#233A59] px-5 font-bold text-white"
          >
            <RefreshCw aria-hidden="true" size={18} /> Reload workspace
          </button>
          <Link href="/admin" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-5 font-bold text-[#233A59]">
            <Home aria-hidden="true" size={18} /> Staff home
          </Link>
        </div>
        {error.digest ? <p className="mt-5 text-[11px] text-slate-400">Reference: {error.digest}</p> : null}
      </div>
    </section>
  );
}
