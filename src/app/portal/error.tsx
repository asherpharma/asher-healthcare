"use client";

import { HeartHandshake, LogIn, RefreshCw } from "lucide-react";
import Link from "next/link";

export default function PatientPortalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main id="main-content" className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-9" role="alert">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-700">
          <HeartHandshake aria-hidden="true" size={27} />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Your records remain protected</p>
        <h1 className="mt-2 text-2xl font-bold text-[#233A59] sm:text-3xl">The family portal needs another moment.</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">
          Nothing was changed or submitted automatically. Check your connection and try opening
          the secure portal again.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#233A59] px-5 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]"
          >
            <RefreshCw aria-hidden="true" size={18} /> Try again
          </button>
          <Link
            href="/portal/login"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-5 font-bold text-[#233A59] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]"
          >
            <LogIn aria-hidden="true" size={18} /> Return to sign in
          </Link>
        </div>
        {error.digest ? <p className="mt-5 text-[11px] text-slate-400">Reference: {error.digest}</p> : null}
      </section>
    </main>
  );
}
