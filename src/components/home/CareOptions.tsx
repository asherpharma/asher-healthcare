// Native links keep clinical pages isolated from homepage measurement.
import { ArrowRight, Baby, HeartPulse, Phone, Stethoscope } from "lucide-react";
import CareBookingLink from "./CareBookingLink";

export default function CareOptions() {
  return (
    <section id="services" className="section patient-care-section" aria-labelledby="care-heading">
      <span id="care" className="patient-anchor" aria-hidden="true" />
      <div className="site-shell">
        <div className="section-heading split-heading">
          <div><span className="section-kicker">How can we help?</span><h2 id="care-heading">The right care,<br /><em>without the guesswork.</em></h2></div>
          <p>Choose a specialist for your visit, or call reception for general care and tests.</p>
        </div>
        <div className="patient-care-grid">
          <article className="patient-care-card patient-care-child">
            <span className="patient-care-icon"><Baby aria-hidden="true" /></span>
            <small>FOR YOUR LITTLE ONES</small>
            <h3>Pediatrics &amp; child health</h3>
            <p>From the first check-up to the growing-up years, care for the questions that matter to your family.</p>
            <ul><li>Newborn care &amp; vaccination</li><li>Child allergy &amp; asthma</li><li>Growth &amp; nutrition guidance</li></ul>
            <div className="patient-care-actions"><CareBookingLink doctorId="pediatrics" className="patient-text-link">Book pediatric care <ArrowRight aria-hidden="true" /></CareBookingLink><a href="/care/pediatrics">Explore child health</a></div>
          </article>
          <article className="patient-care-card patient-care-women">
            <span className="patient-care-icon"><HeartPulse aria-hidden="true" /></span>
            <small>AT EVERY LIFE STAGE</small>
            <h3>Women&apos;s health</h3>
            <p>Personal support for your health, your pregnancy and the next steps you are considering.</p>
            <ul><li>Pregnancy &amp; postnatal care</li><li>Periods, PCOS &amp; gynaecology</li><li>Fertility &amp; laparoscopic consultation</li></ul>
            <div className="patient-care-actions"><CareBookingLink doctorId="obg" className="patient-text-link">Book women&apos;s care <ArrowRight aria-hidden="true" /></CareBookingLink><a href="/care/womens-health">Explore women&apos;s health</a></div>
          </article>
          <article id="general-care" className="patient-care-card patient-care-general">
            <span className="patient-care-icon"><Stethoscope aria-hidden="true" /></span>
            <small>EVERYDAY FAMILY HEALTH</small>
            <h3>General care &amp; tests</h3>
            <p>For everyday health concerns and diagnostic services, our reception team can guide your visit.</p>
            <ul><li>General consultations for all ages</li><li>Blood tests, X-ray &amp; ultrasound</li><li>Doctor-prescribed day-care IV therapy</li></ul>
            <div className="patient-care-actions"><a className="patient-text-link" href="tel:+919019263709">Call for availability <Phone aria-hidden="true" /></a><a href="/care/general-care-lab-tests">Explore general care &amp; lab tests</a></div>
          </article>
        </div>
        <p className="patient-care-note">Please confirm test availability, preparation and fees with reception. Online slots are for specialist consultations.</p>
      </div>
    </section>
  );
}
