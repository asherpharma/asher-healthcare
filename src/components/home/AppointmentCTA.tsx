"use client";

import { CalendarCheck, CheckCircle2, Clock3, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

const doctors = ["Dr. Lt Col Shafi Ahamad — Pediatrics", "Dr. Shaik Reshma — Obstetrics & Gynaecology"];

export default function AppointmentCTA() {
  const [sent, setSent] = useState(false);

  function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = [
      "Hello Asher Healthcare, I would like to request an appointment.",
      "",
      "Patient: " + form.get("name"),
      "Phone: " + form.get("phone"),
      "Doctor: " + form.get("doctor"),
      "Preferred date: " + form.get("date"),
      "Preferred time: " + form.get("time"),
      "Reason: " + (form.get("reason") || "Not specified"),
    ].join("\n");
    setSent(true);
    window.open("https://wa.me/919019263709?text=" + encodeURIComponent(message), "_blank", "noopener,noreferrer");
  }

  return (
    <section id="appointment" className="section appointment-section">
      <div className="site-shell appointment-shell">
        <div className="appointment-copy">
          <span className="section-kicker">Book in under a minute</span>
          <h2>Request your preferred appointment.</h2>
          <p>Tell us when you would like to visit. Your request opens securely in WhatsApp, where the clinic team will confirm the exact slot.</p>
          <div className="booking-points">
            <span><MessageCircle /> Quick confirmation on WhatsApp</span>
            <span><Clock3 /> Clinic hours: 9:00 AM–9:00 PM</span>
            <span><ShieldCheck /> No payment required online</span>
          </div>
          <a className="phone-card" href="tel:+919019263709"><span><Phone /></span><div><small>Prefer to call?</small><strong>+91 90192 63709</strong></div></a>
        </div>

        <form className="booking-card" onSubmit={submitBooking}>
          <div className="booking-card-head"><span><CalendarCheck /></span><div><small>Appointment request</small><h3>Choose your preferences</h3></div></div>
          <label>Patient name<input name="name" type="text" placeholder="Full name" autoComplete="name" required /></label>
          <label>Mobile number<input name="phone" type="tel" placeholder="10-digit mobile number" pattern="[0-9 +()-]{10,}" autoComplete="tel" required /></label>
          <label>Specialist<select name="doctor" defaultValue="" required><option value="" disabled>Select a doctor</option>{doctors.map((doctor) => <option key={doctor}>{doctor}</option>)}</select></label>
          <div className="form-row"><label>Preferred date<input name="date" type="date" required /></label><label>Preferred time<select name="time" defaultValue="" required><option value="" disabled>Select time</option><option>Morning (9 AM–12 PM)</option><option>Afternoon (12–4 PM)</option><option>Evening (4–9 PM)</option></select></label></div>
          <label>Reason for visit <span className="optional">Optional</span><textarea name="reason" rows={3} placeholder="Briefly tell us how we can help" /></label>
          <button className="button button-primary booking-submit" type="submit"><MessageCircle /> Continue on WhatsApp</button>
          {sent && <p className="form-success"><CheckCircle2 /> Your request is ready. Complete it in WhatsApp to contact the clinic.</p>}
          <p className="form-note">Submitting this form requests a slot; the clinic will confirm availability directly.</p>
        </form>
      </div>
    </section>
  );
}
