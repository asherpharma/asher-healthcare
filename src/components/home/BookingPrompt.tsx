// Booking opens a separate untracked document.
import { CalendarCheck, Clock3, Phone } from "lucide-react";
import CareBookingLink from "./CareBookingLink";

export default function BookingPrompt() {
  return (
    <section id="book-visit" className="section appointment-section" aria-labelledby="book-visit-heading">
      <div className="site-shell appointment-shell">
        <div className="appointment-copy">
          <span className="section-kicker">Book a specialist visit</span>
          <h2 id="book-visit-heading">A time that works for you.</h2>
          <p>Choose your specialist, see available times, and reserve your visit on our appointment page.</p>
          <div className="booking-points"><span><Clock3 aria-hidden="true" /> Choose from the latest available appointment times</span></div>
          <a className="phone-card" href="tel:+919019263709"><span><Phone aria-hidden="true" /></span><div><small>Prefer to call?</small><strong>+91 90192 63709</strong></div></a>
        </div>
        <div className="booking-card">
          <div className="booking-card-head"><span><CalendarCheck aria-hidden="true" /></span><div><small>Specialist appointments</small><h3>Who would you like to see?</h3></div></div>
          <div className="booking-prompt-actions">
            <CareBookingLink doctorId="pediatrics" className="button button-primary">Dr. Shafi · Pediatric care</CareBookingLink>
            <CareBookingLink doctorId="obg" className="button button-ghost">Dr. Reshma · Women&apos;s health</CareBookingLink>
          </div>
          <p className="form-note">The appointment page shows the latest clinic timings. Reservations are subject to clinic confirmation.</p>
        </div>
      </div>
    </section>
  );
}
