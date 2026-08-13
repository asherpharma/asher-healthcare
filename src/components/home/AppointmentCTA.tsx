"use client";

import { firestore } from "@/firebase/config";
import { useAppointmentSchedule } from "@/hooks/useAppointmentSchedule";
import {
  appointmentSlotId,
  clinicDate,
  dateIsEnabled,
  DOCTORS,
  formatAppointmentTime,
  generateTimeSlots,
  nextEnabledDate,
  scheduleSummary,
  type DoctorId,
} from "@/lib/appointments";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  CalendarCheck,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MessageCircle,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Result = { tone: "success" | "error"; message: string } | null;

type Availability = {
  key: string;
  slots: Set<string>;
  error: boolean;
};

function currentClinicClock() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ""
  );
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    time: `${read("hour")}:${read("minute")}`,
  };
}

export default function AppointmentCTA() {
  const { schedule, loading: scheduleLoading, error: scheduleError } = useAppointmentSchedule();
  const [doctorId, setDoctorId] = useState<DoctorId>("pediatrics");
  const [date, setDate] = useState(() => nextEnabledDate(schedule));
  const [time, setTime] = useState("");
  const [availability, setAvailability] = useState<Availability>({
    key: "",
    slots: new Set(),
    error: false,
  });
  const [result, setResult] = useState<Result>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clinicClock, setClinicClock] = useState(currentClinicClock);
  const formStartedAt = useRef(0);

  const allSlots = useMemo(
    () => dateIsEnabled(schedule, date)
      ? generateTimeSlots(schedule.doctors[doctorId]).filter(
          (slot) => date !== clinicClock.date || slot > clinicClock.time,
        )
      : [],
    [clinicClock, date, doctorId, schedule],
  );
  const availabilityKey = `${doctorId}_${date}`;
  const occupiedSlots = useMemo(
    () => availability.key === availabilityKey ? availability.slots : new Set<string>(),
    [availability, availabilityKey],
  );
  const availabilityLoading = Boolean(firestore) && availability.key !== availabilityKey;
  const availabilityError = availability.key === availabilityKey && availability.error;
  const availableSlots = useMemo(
    () => availabilityError ? [] : allSlots.filter((slot) => !occupiedSlots.has(slot)),
    [allSlots, availabilityError, occupiedSlots],
  );
  const selectedTime = availableSlots.includes(time) ? time : availableSlots[0] ?? "";

  useEffect(() => {
    formStartedAt.current = Date.now();
    const timer = window.setInterval(() => setClinicClock(currentClinicClock()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!firestore || !doctorId || !date) return;
    const slotsQuery = query(
      collection(firestore, "appointmentSlots"),
      where("doctorId", "==", doctorId),
      where("date", "==", date),
    );
    return onSnapshot(
      slotsQuery,
      (snapshot) => {
        setAvailability({
          key: `${doctorId}_${date}`,
          slots: new Set(snapshot.docs.map((item) => String(item.data().time || ""))),
          error: false,
        });
      },
      () => {
        // Fail closed: never present every slot as available when the live
        // occupancy check cannot be completed.
        setAvailability({ key: `${doctorId}_${date}`, slots: new Set(), error: true });
      },
    );
  }, [date, doctorId]);

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (availabilityLoading || availabilityError) {
      setResult({ tone: "error", message: "Live availability is still being checked. Please wait a moment and try again." });
      return;
    }
    if (!selectedTime) {
      setResult({ tone: "error", message: "Please choose an available appointment time." });
      return;
    }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const doctor = DOCTORS.find((item) => item.id === doctorId);
    const payload = {
      patientName: String(form.get("name") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      doctorId,
      preferredDate: date,
      preferredTime: selectedTime,
      reason: String(form.get("reason") || "").trim(),
      source: "website",
      privacyAccepted: form.get("consent") === "on",
      website: String(form.get("website") || ""),
      formElapsedMs: formStartedAt.current > 0 ? Date.now() - formStartedAt.current : 0,
    };

    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch("/api/appointments/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responseBody.error || "The appointment could not be reserved.");
      }

      const message = [
        "Hello Asher Healthcare, I have reserved an appointment slot.",
        "",
        `Patient: ${payload.patientName}`,
        `Phone: ${payload.phone}`,
        `Doctor: ${doctor?.label || doctorId}`,
        `Date: ${date}`,
        `Time: ${formatAppointmentTime(selectedTime)}`,
        `Reason: ${payload.reason || "Not specified"}`,
      ].join("\n");
      const whatsappUrl = `https://wa.me/919019263709?text=${encodeURIComponent(message)}`;
      const whatsapp = window.open(whatsappUrl, "_blank", "noopener,noreferrer");

      setAvailability((current) => ({
        key: availabilityKey,
        slots: new Set(current.key === availabilityKey ? current.slots : []).add(selectedTime),
        error: false,
      }));
      setResult({
        tone: "success",
        message: `Your ${formatAppointmentTime(selectedTime)} slot is reserved. The clinic will confirm it shortly.`,
      });
      formElement.reset();
      formStartedAt.current = Date.now();
      if (!whatsapp) window.location.href = whatsappUrl;
    } catch (bookingError) {
      setResult({
        tone: "error",
        message: bookingError instanceof Error
          ? bookingError.message
          : "The appointment could not be reserved. Please call the clinic.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedDayEnabled = dateIsEnabled(schedule, date);
  const scheduleText = scheduleSummary(schedule, doctorId);

  return (
    <section id="appointment" className="section appointment-section">
      <div className="site-shell appointment-shell">
        <div className="appointment-copy">
          <span className="section-kicker">Book in under a minute</span>
          <h2>Choose a live appointment slot.</h2>
          <p>
            Appointments are available Monday to Saturday. Select a doctor, date,
            and one of the currently available times.
          </p>
          <div className="booking-points">
            <span><MessageCircle /> Quick confirmation on WhatsApp</span>
            <span><Clock3 /> Default hours: 5:00 PM–8:00 PM</span>
            <span><ShieldCheck /> Live timings set by the clinic</span>
          </div>
          <a className="phone-card" href="tel:+919019263709">
            <span><Phone /></span>
            <div><small>Prefer to call?</small><strong>+91 90192 63709</strong></div>
          </a>
        </div>

        <form className="booking-card" onSubmit={submitBooking}>
          <div
            aria-hidden="true"
            style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}
          >
            <label>
              Leave this field empty
              <input name="website" type="text" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <div className="booking-card-head">
            <span><CalendarCheck /></span>
            <div><small>Live appointment booking</small><h3>Reserve your preferred time</h3></div>
          </div>

          <label>
            Patient name
            <input name="name" type="text" placeholder="Full name" autoComplete="name" minLength={2} maxLength={80} required />
          </label>
          <label>
            Mobile number
            <input name="phone" type="tel" placeholder="10-digit mobile number" pattern="[0-9 +()-]{10,20}" autoComplete="tel" required />
          </label>
          <label>
            Specialist
            <select
              name="doctor"
              value={doctorId}
              onChange={(event) => {
                setDoctorId(event.target.value as DoctorId);
                setResult(null);
              }}
              required
            >
              {DOCTORS.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>{doctor.label}</option>
              ))}
            </select>
            <small className="mt-2 block text-slate-500">{scheduleText}</small>
          </label>

          <div className="form-row">
            <label>
              Appointment date
              <input
                name="date"
                type="date"
                min={clinicDate()}
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setResult(null);
                }}
                required
              />
            </label>
            <label>
              Available time
              <select
                name="time"
                value={selectedTime}
                onChange={(event) => setTime(event.target.value)}
                disabled={!selectedDayEnabled || availabilityLoading || availableSlots.length === 0}
                required
              >
                <option value="">
                  {availabilityLoading
                    ? "Checking availability…"
                    : availabilityError
                      ? "Availability temporarily unavailable"
                    : !selectedDayEnabled
                      ? "Clinic closed this day"
                      : availableSlots.length === 0
                        ? "No slots available"
                        : "Select a time"}
                </option>
                {allSlots.map((slot) => (
                  <option key={appointmentSlotId(doctorId, date, slot)} value={slot} disabled={occupiedSlots.has(slot)}>
                    {formatAppointmentTime(slot)}{occupiedSlots.has(slot) ? " — Booked" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!selectedDayEnabled && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              Appointments are closed on this day. Please choose Monday to Saturday.
            </p>
          )}
          {scheduleError && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {scheduleError} Default clinic timings are shown.
            </p>
          )}
          {availabilityError && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
              Live appointment availability could not be checked. Please retry in a moment or call the clinic on 90192 63709.
            </p>
          )}

          <label>
            Reason for visit <span className="optional">Optional</span>
            <textarea name="reason" rows={3} maxLength={500} placeholder="Briefly tell us how we can help" />
          </label>
          <label className="flex-row">
            <input name="consent" type="checkbox" required style={{ width: 18, height: 18 }} />
            <span>I agree that the clinic may use these details to arrange my appointment.</span>
          </label>
          <button
            className="button button-primary booking-submit"
            type="submit"
            disabled={submitting || scheduleLoading || availabilityLoading || availabilityError || !selectedTime}
          >
            {submitting ? <LoaderCircle className="animate-spin" /> : <CalendarCheck />}
            {submitting ? "Reserving slot…" : "Reserve appointment"}
          </button>
          {result && (
            <p className={result.tone === "success" ? "form-success" : "rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"}>
              {result.tone === "success" && <CheckCircle2 />} {result.message}
            </p>
          )}
          <p className="form-note">
            The selected time is held for you after submission and confirmed by the clinic.
            For emergencies, contact local emergency services.
          </p>
        </form>
      </div>
    </section>
  );
}
