import { ArrowUpRight, CheckCircle2, Navigation, Phone } from "lucide-react";
import Link from "next/link";

import { clinicVisit, GENERAL_CARE_HREF, generalCareServices } from "@/lib/general-care";
import styles from "./GeneralCare.module.css";

export default function GeneralCare() {
  return (
    <section id="general-care" className={styles.overview} aria-labelledby="general-care-title">
      <div className={`site-shell ${styles.overviewGrid}`}>
        <div>
          <span className="section-kicker">Care for the whole family</span>
          <h2 id="general-care-title">General care &amp; lab tests, close to home.</h2>
          <p>General medical consultations for all ages, blood and laboratory tests, X-ray and ultrasound services at Asher Healthcare in RK Hegde Nagar.</p>
          <div className={styles.actions}>
            <a className="button button-primary" href={clinicVisit.phoneHref}><Phone aria-hidden="true" /> Call to book</a>
            <Link className={styles.detailsLink} href={GENERAL_CARE_HREF}>Explore services <ArrowUpRight aria-hidden="true" /></Link>
          </div>
          <a className={styles.locationLink} href={clinicVisit.directionsHref} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" /> Get directions to Asher</a>
        </div>
        <div className={styles.overviewCard}>
          <ul className={styles.highlights}>
            {generalCareServices.map((service) => <li key={service.title}><CheckCircle2 aria-hidden="true" /><span>{service.title}</span></li>)}
          </ul>
          <p>Call reception to confirm service availability, preparation, fees and a suitable visit time.</p>
        </div>
      </div>
    </section>
  );
}
