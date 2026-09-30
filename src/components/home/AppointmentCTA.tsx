"use client";

import { firestore } from "@/firebase/config";
import { useAppointmentSchedule } from "@/hooks/useAppointmentSchedule";
import {
  appointmentSlotId,
  dateIsEnabled,
  DOCTORS,
  formatAppointmentTime,
  generateTimeSlots,
  nextEnabledDate,
  scheduleSummary,
  type DoctorId,
} from "@/lib/appointments";
import { CARE_SELECTION_EVENT } from "@/lib/public-clinic-content";
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

type Result =
  | { tone: "success"; message: string; doctor: string; date: string; time: string }
  | { tone: "error"; message: string }
  | null;

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
  // Keep the server render and the browser's first render time-neutral. This
  // page is statically generated, so deriving these values during render would
  // otherwise compare the build clock with the visitor's current clock during
  // hydration and produce different date/slot markup.
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [availability, setAvailability] = useState<Availability>({
    key: "",
    slots: new Set(),
    error: false,
  });
  const [result, setResult] = useState<Result>(null);
  const [carePrefillMessage, setCarePrefillMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clinicClock, setClinicClock] = useState({ date: "", time: "" });
  const formStartedAt = useRef(0);
  const submissionPending = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const allSlots = useMemo(
    () => date && clinicClock.date && dateIsEnabled(schedule, date)
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
  const selectedTime = availableSlots.includes(time) ? time : "";

  useEffect(() => {
    if (!result) return;
    resultRef.current?.focus({ preventScroll: true });
    resultRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [result]);

  useEffect(() => {
    formStartedAt.current = Date.now();
    const initialTimer = window.setTimeout(() => setClinicClock(currentClinicClock()), 0);
    const timer = window.setInterval(() => setClinicClock(currentClinicClock()), 30_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!clinicClock.date) return;
    const timer = window.setTimeout(() => {
      setDate((current) => (
        current && current >= clinicClock.date && dateIsEnabled(schedule, current)
          ? current
          : nextEnabledDate(schedule, clinicClock.date)
      ));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clinicClock.date, schedule]);

  useEffect(() => {
    function selectCare(nextDoctorId: DoctorId) {
      if (submissionPending.current) return;
      setDoctorId(nextDoctorId);
      setTime("");
      setResult((current) => current?.tone === "error" ? null : current);
      const doctor = DOCTORS.find((item) => item.id === nextDoctorId);
      setCarePrefillMessage(
        doctor ? `${doctor.specialty} selected. Choose your date and time below.` : "",
      );
    }

    const careFromUrl = new URLSearchParams(window.location.search).get("care");
    const careFromFragment = window.location.hash.match(/^#appointment-(pediatrics|obg)$/u)?.[1];
    const initialCare = careFromFragment ?? careFromUrl;
    if (initialCare === "pediatrics" || initialCare === "obg") selectCare(initialCare);

    const onCareSelection = (event: Event) => {
      const doctorIdFromEvent = (event as CustomEvent<{ doctorId?: DoctorId }>).detail?.doctorId;
      if (doctorIdFromEvent === "pediatrics" || doctorIdFromEvent === "obg") {
        selectCare(doctorIdFromEvent);
      }
    };
    window.addEventListener(CARE_SELECTION_EVENT, onCareSelection);
    return () => window.removeEventListener(CARE_SELECTION_EVENT, onCareSelection);
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
    if (submissionPending.current) return;
    if (scheduleLoading || availabilityLoading || availabilityError) {
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

    submissionPending.current = true;
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

      setAvailability((current) => ({
        key: availabilityKey,
        slots: new Set(current.key === availabilityKey ? current.slots : []).add(selectedTime),
        error: false,
      }));
      setResult({
        tone: "success",
        message: "Your slot is reserved and awaiting clinic confirmation.",
        doctor: doctor?.label || doctorId,
        date: payload.preferredDate,
        time: payload.preferredTime,
      });
      formElement.reset();
      setTime("");
      setCarePrefillMessage("");
      formStartedAt.current = Date.now();
    } catch (bookingError) {
      setResult({
        tone: "error",
        message: bookingError instanceof Error
          ? bookingError.message
          : "The appointment could not be reserved. Please call the clinic.",
      });
    } finally {
      submissionPending.current = false;
      setSubmitting(false);
    }
  }

  const selectedDayEnabled = Boolean(date) && dateIsEnabled(schedule, date);
  const scheduleText = scheduleSummary(schedule, doctorId);

  return (
    <section id="appointment" className="section appointment-section" aria-labelledby="appointment-heading">
      <span id="appointment-pediatrics" className="patient-anchor" aria-hidden="true" />
      <span id="appointment-obg" className="patient-anchor" aria-hidden="true" />
      <div className="site-shell appointment-shell">
        <div className="appointment-copy">
          <span className="section-kicker">Book a specialist visit</span>
          <h2 id="appointment-heading">A time that works for you.</h2>
          <p>
            Choose your specialist and an available time, then add the patient&apos;s
            details. Your reservation is subject to confirmation by the clinic.
          </p>
          <div className="booking-points">
            <span><Clock3 aria-hidden="true" /> Usual hours, Mon–Sat: Dr. Shafi 5–8 PM · Dr. Reshma 7–9 PM</span>
            <span><ShieldCheck aria-hidden="true" /> The form shows the latest available timings</span>
          </div>
          <a className="phone-card" href="tel:+919019263709">
            <span><Phone aria-hidden="true" /></span>
            <div><small>Prefer to call?</small><strong>+91 90192 63709</strong></div>
          </a>
        </div>

        <form className="booking-card" onSubmit={submitBooking} aria-labelledby="booking-form-heading" aria-busy={submitting}>
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
            <span><CalendarCheck aria-hidden="true" /></span>
            <div><small>Specialist appointments</small><h3 id="booking-form-heading">Reserve your visit</h3></div>
          </div>
          <div
            ref={resultRef}
            role={result?.tone === "error" ? "alert" : "status"}
            aria-live={result?.tone === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            tabIndex={result ? -1 : undefined}
            className={result?.tone === "success" ? "booking-feedback booking-confirmation" : result ? "booking-feedback rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" : "booking-feedback"}
          >
            {result?.tone === "success" ? (
              <>
                <h4><CheckCircle2 aria-hidden="true" /> Reservation received</h4>
                <p>{result.message}</p>
                <dl>
                  <div><dt>Specialist</dt><dd>{result.doctor}</dd></div>
                  <div>
                    <dt>Date</dt>
                    <dd><time dateTime={result.date}>{new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" }).format(new Date(`${result.date}T00:00:00+05:30`))}</time></dd>
                  </div>
                  <div><dt>Time</dt><dd>{formatAppointmentTime(result.time)} IST</dd></div>
                </dl>
                <p>You do not need to book again. To change or cancel, contact the clinic.</p>
                <div className="booking-confirmation-actions">
                  <a href="tel:+919019263709"><Phone aria-hidden="true" /> Call the clinic</a>
                  <a href="https://wa.me/919019263709" target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" /> WhatsApp for help (optional)</a>
                </div>
              </>
            ) : result ? <p>{result.message}</p> : null}
          </div>
          {carePrefillMessage ? (
            <p className="booking-care-selection" role="status" aria-live="polite">
              <CheckCircle2 aria-hidden="true" /> {carePrefillMessage}
            </p>
          ) : null}

          <fieldset className="patient-booking-step" disabled={submitting}>
            <legend><span aria-hidden="true">1</span> Choose your appointment</legend>
            <label>
              Specialist
              <select
                name="doctor"
                value={doctorId}
                onChange={(event) => {
                  setDoctorId(event.target.value as DoctorId);
                  setTime("");
                  setCarePrefillMessage("");
                  setResult((current) => current?.tone === "error" ? null : current);
                }}
                aria-describedby="booking-schedule"
                required
              >
                {DOCTORS.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.label}</option>
                ))}
              </select>
              <small id="booking-schedule" className="mt-2 block text-slate-500">{scheduleText}</small>
            </label>

            <div className="form-row">
              <label>
                Appointment date
                <input
                  name="date"
                  type="date"
                  min={clinicClock.date || undefined}
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setTime("");
                    setResult((current) => current?.tone === "error" ? null : current);
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

            {date && !selectedDayEnabled && (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                Appointments are closed on this day. Please choose another date or call the clinic.
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
          </fieldset>

          <fieldset className="patient-booking-step" disabled={submitting}>
            <legend><span aria-hidden="true">2</span> Patient details</legend>
            <label>
              Patient name
              <input name="name" type="text" placeholder="Full name" autoComplete="name" minLength={2} maxLength={80} required />
            </label>
            <label>
              Mobile number
              <input name="phone" type="tel" inputMode="tel" placeholder="10-digit mobile number" pattern="[0-9 +()-]{10,20}" autoComplete="tel" required />
            </label>
            <label>
              Reason for visit <span className="optional">Optional</span>
              <textarea name="reason" rows={2} maxLength={500} placeholder="Briefly tell us how we can help" />
            </label>
            <label className="flex-row">
              <input name="consent" type="checkbox" required style={{ width: 18, height: 18 }} />
              <span>I agree that the clinic may use these details to arrange my appointment.</span>
            </label>
          </fieldset>
          <p className="form-note">
            We use these details to arrange your visit. <a href="/privacy">Read our privacy notice.</a>
          </p>
          <button
            className="button button-primary booking-submit"
            type="submit"
            disabled={submitting || scheduleLoading || availabilityLoading || availabilityError || !selectedTime}
          >
            {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CalendarCheck aria-hidden="true" />}
            {submitting ? "Reserving slot…" : "Reserve appointment"}
          </button>
          <p className="form-note">
            A reservation is not a confirmed appointment. Please wait for clinic confirmation.
            For emergencies, contact local emergency services or the nearest emergency department.
          </p>
        </form>
      </div>
    </section>
  );
}
