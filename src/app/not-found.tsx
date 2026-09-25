/* eslint-disable @next/next/no-html-link-for-pages -- Full-page navigation isolates optional Ads measurement. */
import Footer from "@/components/layout/Footer";
import Navbar from "@/components/layout/Navbar";
import { ArrowLeft, CalendarDays, Home, Phone } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "Return to Asher Women and Child Healthcare or book an appointment.",
};

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="recovery-page">
        <section className="recovery-card">
          <span className="recovery-code">404</span>
          <p className="section-kicker">That page is not available</p>
          <h1>Let&apos;s get you back to the right place.</h1>
          <p>
            The link may be old or incomplete. You can return to the clinic website, book a live
            appointment, or call the reception team.
          </p>
          <div className="recovery-actions">
            <a className="button button-primary" href="/"><Home aria-hidden="true" /> Home</a>
            <a className="button button-ghost" href="/#appointment"><CalendarDays aria-hidden="true" /> Book appointment</a>
          </div>
          <a className="recovery-phone" href="tel:+919019263709"><Phone aria-hidden="true" /> +91 90192 63709</a>
          <a className="recovery-back" href="/"><ArrowLeft aria-hidden="true" /> Back to Asher Healthcare</a>
        </section>
      </main>
      <Footer />
    </>
  );
}
