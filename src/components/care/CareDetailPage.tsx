import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileHeart,
  MessageCircle,
  Phone,
  ShieldAlert,
  Stethoscope,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import Footer from "@/components/layout/Footer";
import Navbar from "@/components/layout/Navbar";
import type { CareJourney } from "@/lib/public-clinic-content";

export default function CareDetailPage({ journey }: { journey: CareJourney }) {
  return (
    <>
      <Navbar />
      <main id="main-content" className={`care-detail care-detail-${journey.id}`}>
        <section className="care-detail-hero">
          <div className="site-shell care-detail-hero-grid">
            <div className="care-detail-hero-copy">
              <Link className="care-detail-back" href="/#care"><ArrowLeft /> Care guide</Link>
              <span className="section-kicker">{journey.eyebrow}</span>
              <h1>{journey.title}</h1>
              <p>{journey.description}</p>
              <div className="care-detail-actions">
                <Link className="button button-primary" href={`/?care=${journey.id}#appointment`}>
                  <CalendarDays /> Book this specialist
                </Link>
                <a className="button button-ghost" href="tel:+919019263709"><Phone /> Call clinic</a>
              </div>
              <div className="care-detail-facts">
                <span><Clock3 /> Mon–Sat · 5:00–8:00 PM</span>
                <span><Stethoscope /> {journey.doctorRole}</span>
              </div>
            </div>
            <div className="care-detail-image">
              <Image
                src={journey.image}
                alt={journey.imageAlt}
                fill
                priority
                sizes="(max-width: 800px) calc(100vw - 28px), 48vw"
              />
              <span>Representative care experience</span>
            </div>
          </div>
        </section>

        <section className="section care-detail-content">
          <div className="site-shell care-detail-content-grid">
            <article className="care-detail-card">
              <span className="section-kicker">When we can help</span>
              <h2>Common reasons families book this care.</h2>
              <ul>
                {journey.reasons.map((reason) => (
                  <li key={reason}><CheckCircle2 /> {reason}</li>
                ))}
              </ul>
              <p className="care-detail-note">
                Every consultation begins with a clinician’s assessment. This list is general
                guidance and is not a diagnosis or a substitute for emergency care.
              </p>
            </article>

            <aside className="care-detail-card care-detail-prepare">
              <span className="care-detail-card-icon"><FileHeart /></span>
              <span className="section-kicker">Prepare for your visit</span>
              <h2>Bring the details that help your doctor see the full picture.</h2>
              <ul>
                {journey.preparation.map((item) => (
                  <li key={item}><CheckCircle2 /> {item}</li>
                ))}
              </ul>
              <div className="care-detail-doctor">
                <small>Your specialist</small>
                <strong>{journey.doctor}</strong>
                <span>{journey.doctorRole}</span>
              </div>
            </aside>
          </div>
        </section>

        <section className="care-detail-cta">
          <div className="site-shell care-detail-cta-inner">
            <div>
              <span className="section-kicker">Ready when you are</span>
              <h2>Choose an available specialist slot in under a minute.</h2>
              <p>The live booking desk reflects the latest schedule set by the clinic.</p>
            </div>
            <div className="care-detail-cta-actions">
              <Link className="button" href={`/?care=${journey.id}#appointment`}><CalendarDays /> View live slots</Link>
              <a href="https://wa.me/919019263709" target="_blank" rel="noreferrer"><MessageCircle /> Ask on WhatsApp</a>
            </div>
          </div>
          <div className="site-shell care-detail-urgent">
            <ShieldAlert />
            <p><strong>Urgent symptoms or a medical emergency?</strong> Contact local emergency services or go to the nearest emergency department instead of waiting for an online booking.</p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
