/* eslint-disable @next/next/no-html-link-for-pages -- Full-page navigation isolates optional Ads measurement. */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, MapPin, Navigation, Phone } from "lucide-react";

import Footer from "@/components/layout/Footer";
import Navbar from "@/components/layout/Navbar";
import styles from "@/components/home/GeneralCare.module.css";
import { clinicVisit, GENERAL_CARE_HREF, generalCareServices } from "@/lib/general-care";

export const metadata: Metadata = {
  title: "General Care & Lab Tests in RK Hegde Nagar",
  description:
    "General consultations for all ages, blood and laboratory tests, X-ray, ultrasound, vaccinations and doctor-prescribed day care at Asher Healthcare, Bengaluru. Call to book.",
  alternates: { canonical: GENERAL_CARE_HREF },
  openGraph: {
    title: "General Care & Lab Tests | Asher Healthcare",
    description: "General consultations, blood and laboratory tests, X-ray and ultrasound in RK Hegde Nagar. Call the clinic to plan your visit.",
    url: GENERAL_CARE_HREF,
    images: ["/images/asher-logo-original.png"],
  },
};

export default function GeneralCarePage() {
  return (
    <>
      <Navbar />
      <main id="main-content">
        <section className={styles.hero} aria-labelledby="general-care-heading">
          <div className={`site-shell ${styles.heroGrid}`}>
            <div>
              <a className={styles.backLink} href="/#general-care"><ArrowLeft aria-hidden="true" /> Asher Healthcare</a>
              <div><span className="section-kicker">RK Hegde Nagar · North Bengaluru</span></div>
              <h1 id="general-care-heading">General care &amp; lab tests</h1>
              <p>Medical consultations for all ages, blood and laboratory tests, X-ray and ultrasound services at Asher Women &amp; Child Healthcare. Call reception to plan the right visit for you.</p>
              <div className={styles.actions}>
                <a className="button button-primary" href={clinicVisit.phoneHref}><Phone aria-hidden="true" /> Call to book</a>
                <a className="button button-ghost" href={clinicVisit.directionsHref} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" /> Get directions</a>
              </div>
              <a className={styles.phoneNumber} href={clinicVisit.phoneHref}>{clinicVisit.phone}</a>
            </div>
            <aside className={styles.visitCard} aria-label="Clinic location and booking information">
              <MapPin aria-hidden="true" />
              <h2>Visit Asher Healthcare</h2>
              <address>{clinicVisit.address}</address>
              <p>Call to confirm the service you need, availability, fees and a suitable visit time. Test preparation and report timing depend on the investigation.</p>
              <a className={styles.locationLink} href={clinicVisit.directionsHref} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" /> Open the clinic map</a>
            </aside>
          </div>
        </section>

        <section className={styles.servicesSection} aria-labelledby="general-services-heading">
          <div className="site-shell">
            <span className="section-kicker">Services at Asher</span>
            <h2 id="general-services-heading" className={styles.sectionTitle}>Everyday care, tests and clinical support.</h2>
            <p className={styles.intro}>Our general-care and diagnostic services complement the clinic&apos;s pediatric and obstetrics &amp; gynaecology care. Treatment and investigations are guided by clinical assessment.</p>
            <div className={styles.servicesGrid}>
              {generalCareServices.map((service) => (
                <article className={styles.service} key={service.title}>
                  <CheckCircle2 aria-hidden="true" />
                  <h3>{service.title}</h3>
                  <p>{service.description}</p>
                </article>
              ))}
            </div>
            <div className={styles.prepare}>
              <h2>A simple way to plan your visit</h2>
              <ol>
                <li>Call reception to confirm your consultation or specific test and its availability.</li>
                <li>Check the visit time, fees and any preparation instructions before you arrive.</li>
                <li>Bring previous reports and a prescription or test request if you have one.</li>
              </ol>
              <div className={styles.actions}>
                <a className="button button-primary" href={clinicVisit.phoneHref}><Phone aria-hidden="true" /> Call to book</a>
                <a className="button button-ghost" href={clinicVisit.directionsHref} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" /> Directions to Asher</a>
              </div>
            </div>
            <div className={styles.specialistLinks} aria-label="Specialist care information">
              <Link href="/care/pediatrics">Pediatrics &amp; newborn care →</Link>
              <Link href="/care/womens-health">Women&apos;s health &amp; pregnancy care →</Link>
            </div>
            <p className={styles.notice}>Dental services and dental OPG are not offered. For a medical emergency, contact local emergency services or go to the nearest emergency department instead of waiting for a clinic booking.</p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
