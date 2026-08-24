import Footer from "@/components/layout/Footer";
import { ArrowLeft, MapPin, Phone } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export default function LegalPage({
  eyebrow,
  title,
  introduction,
  updated = "31 July 2026",
  children,
}: {
  eyebrow: string;
  title: string;
  introduction: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <>
      <header className="legal-header">
        <div className="site-shell legal-header-inner">
          <Link href="/" className="brand" aria-label="Asher Healthcare home">
            <span className="brand-mark"><Image src="/images/asher-logo-compact-v2.webp" alt="" width={54} height={54} priority /></span>
            <span><strong>Asher</strong><small>Women & Child Healthcare</small></span>
          </Link>
          <Link href="/" className="legal-back"><ArrowLeft size={17} /> Back to clinic website</Link>
        </div>
      </header>

      <main id="main-content" className="legal-main">
        <div className="site-shell legal-layout">
          <aside className="legal-aside">
            <p className="section-kicker">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{introduction}</p>
            <div className="legal-contact">
              <a href="tel:+919019263709"><Phone size={17} /> +91 90192 63709</a>
              <span><MapPin size={17} /> RK Hegde Nagar, Bengaluru</span>
            </div>
            <small>Last updated: {updated}</small>
          </aside>
          <article className="legal-content">{children}</article>
        </div>
      </main>
      <Footer />
    </>
  );
}
