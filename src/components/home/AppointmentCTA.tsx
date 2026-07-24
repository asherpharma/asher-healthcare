"use client";

import { firestore } from "@/firebase/config";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { CalendarCheck, CheckCircle2, Clock3, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

const doctors = [
  { id: "pediatrics", label: "Dr. Lt Col Shafi Ahamad — Pediatrics" },
  { id: "obg", label: "Dr. Shaik Reshma — Obstetrics & Gynaecology" },
];

export default function AppointmentCTA() {
  const [result, setResult] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const doctor = doctors.find((item) => item.id === form.get("doctor"));
    const message = [
      "Hello Asher Healthcare, I would like to request an appointment.",
      "",
      "Patient: " + form.get("name"),
      "Phone: " + form.get("phone"),
      "Doctor: " + (doctor?.label || form.get("doctor")),
      "Preferred date: " + form.get("date"),
      "Preferred time: " + form.get("time"),
      "Reason: " + (form.get("reason") || "Not specified"),
    ].join("\n");

    setSubmitting(true);
    setResult("");
    const whatsapp = window.open("https://wa.me/919019263709?text=" + encodeURIComponent(message), "_blank", "noopener,noreferrer");

    try {
      if (firestore) {
        await addDoc(collection(firestore, "appointments"), {
          patientName: String(form.get("name")).trim(),
          phone: String(form.get("phone")).trim(),
          doctorId: String(form.get("doctor")),
          preferredDate: String(form.get("date")),
          preferredTime: String(form.get("time")),
          reason: String(form.get("reason") || "").trim(),
          status: "requested",
          source: "website",
          privacyAccepted: form.get("consent") === "on",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setResult("Your request has been saved and sent to WhatsApp for confirmation.");
        formElement.reset();
      } else {
        setResult("Please complete your request in WhatsApp so the clinic can confirm it.");
      }
      if (!whatsapp) window.location.href = "https://wa.me/919019263709?text=" + encodeURIComponent(message);
    } catch {
      setResult("The online save was unavailable. Please complete the request in WhatsApp.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="appointment" className="section appointment-section">
      <div className="site-shell appointment-shell">
        <div className="appointment-copy">
          <span className="section-kicker">Book in under a minute</span>
          <h2>Request your preferred appointment.</h2>
          <p>Tell us when you would like to visit. The clinic team will confirm the exact slot.</p>
          <div className="booking-points"><span><MessageCircle /> Quick confirmation on WhatsApp</span><span><Clock3 /> Clinic hours: 9:00 AM–9:00 PM</span><span><ShieldCheck /> No payment required online</span></div>
          <a className="phone-card" href="tel:+919019263709"><span><Phone /></span><div><small>Prefer to call?</small><strong>+91 90192 63709</strong></div></a>
        </div>
        <form className="booking-card" onSubmit={submitBooking}>
          <div className="booking-card-head"><span><CalendarCheck /></span><div><small>Appointment request</small><h3>Choose your preferences</h3></div></div>
          <label>Patient name<input name="name" type="text" placeholder="Full name" autoComplete="name" minLength={2} maxLength={80} required /></label>
          <label>Mobile number<input name="phone" type="tel" placeholder="10-digit mobile number" pattern="[0-9 +()-]{10,20}" autoComplete="tel" required /></label>
          <label>Specialist<select name="doctor" defaultValue="" required><option value="" disabled>Select a doctor</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.label}</option>)}</select></label>
          <div className="form-row"><label>Preferred date<input name="date" type="date" min={new Date().toISOString().slice(0, 10)} required /></label><label>Preferred time<select name="time" defaultValue="" required><option value="" disabled>Select time</option><option value="morning">Morning (9 AM–12 PM)</option><option value="afternoon">Afternoon (12–4 PM)</option><option value="evening">Evening (4–9 PM)</option></select></label></div>
          <label>Reason for visit <span className="optional">Optional</span><textarea name="reason" rows={3} maxLength={500} placeholder="Briefly tell us how we can help" /></label>
          <label className="flex-row"><input name="consent" type="checkbox" required style={{ width: 18, height: 18 }} /><span>I agree that the clinic may use these details to arrange my appointment.</span></label>
          <button className="button button-primary booking-submit" type="submit" disabled={submitting}><MessageCircle /> {submitting ? "Saving request…" : "Request appointment"}</button>
          {result && <p className="form-success"><CheckCircle2 /> {result}</p>}
          <p className="form-note">For medical emergencies, contact local emergency services. This form does not confirm a slot.</p>
        </form>
      </div>
    </section>
  );
}
