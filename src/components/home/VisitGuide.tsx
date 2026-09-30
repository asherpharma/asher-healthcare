// A full-page portal navigation preserves the privacy boundary.
import { ArrowRight, CalendarCheck2, FileHeart, FolderLock, MapPin } from "lucide-react";

export default function VisitGuide() {
  return (
    <section id="visit" className="section patient-visit-section" aria-labelledby="visit-heading">
      <span id="journey" className="patient-anchor" aria-hidden="true" />
      <div className="site-shell">
        <div className="section-heading split-heading"><div><span className="section-kicker">We&apos;ll help you feel ready</span><h2 id="visit-heading">A little preparation.<br /><em>A calmer visit.</em></h2></div><p>Your first visit or your next follow-up—here is all you need to know.</p></div>
        <ol className="patient-visit-steps">
          <li><span className="patient-visit-number">01</span><CalendarCheck2 aria-hidden="true" /><h3>Choose your visit</h3><p>Pick a specialist and available time. Your request is saved immediately; the clinic will confirm the appointment.</p></li>
          <li><span className="patient-visit-number">02</span><FileHeart aria-hidden="true" /><h3>Bring the essentials</h3><p>Keep previous prescriptions, reports and current medicines handy, plus any relevant vaccination or pregnancy records.</p></li>
          <li><span className="patient-visit-number">03</span><MapPin aria-hidden="true" /><h3>Arrive a little early</h3><p>Reception will help with registration and payment. If plans change, call the clinic to reschedule.</p></li>
        </ol>
        <div className="patient-returning-strip"><FolderLock aria-hidden="true" /><div><h3>Already part of the Asher family?</h3><p>Access records and reports shared by the clinic. Reception can help activate your family portal.</p></div><a href="/portal/login">Open patient portal <ArrowRight aria-hidden="true" /></a></div>
      </div>
    </section>
  );
}
