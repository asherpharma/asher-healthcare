"use client";

import { Home, RefreshCw } from "lucide-react";
import Link from "next/link";

export default function ErrorPage({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main id="main-content" className="recovery-page">
      <section className="recovery-card" role="alert">
        <span className="recovery-code">Asher</span>
        <p className="section-kicker">Temporary interruption</p>
        <h1>This page needs another moment.</h1>
        <p>
          This page will not submit a form automatically. If you had just reserved a slot, check
          WhatsApp or call the clinic before trying again so a duplicate is not created.
        </p>
        <div className="recovery-actions">
          <button className="button button-primary" type="button" onClick={() => unstable_retry()}>
            <RefreshCw aria-hidden="true" /> Try again
          </button>
          <Link className="button button-ghost" href="/"><Home aria-hidden="true" /> Return home</Link>
        </div>
      </section>
    </main>
  );
}
