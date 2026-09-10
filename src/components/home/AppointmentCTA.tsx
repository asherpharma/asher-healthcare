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
  nextPublicBookingDate,
  PUBLIC_BOOKING_WHATSAPP_URL,
  publicBookingDoctor,
} from "@/lib/public-booking";
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

type BookingConfirmation = {
  date: string;
  doctorName: string;
  time: string;
};

type Result = {
  tone: "success" | "error";
  message: string;
  confirmation?: BookingConfirmation;
} | null;

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

function friendlyAppointmentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
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
  const feedback = useRef<HTMLElement>(null);
  const submittingRef = useRef(false);

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
  const selectedDoctor = DOCTORS.find((doctor) => doctor.id === doctorId) ?? DOCTORS[0];
  const nextClinicDate = date ? nextPublicBookingDate(schedule, date) : "";

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
    if (result) feedback.current?.focus();
  }, [result]);

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
      setDoctorId(nextDoctorId);
      setTime("");
      setResult(null);
      const doctor = DOCTORS.find((item) => item.id === nextDoctorId);
      setCarePrefillMessage(
        doctor ? `${doctor.specialty} selected. Choose your date and time below.` : "",
      );
    }

    const careFromUrl = publicBookingDoctor(
      new URLSearchParams(window.location.search).get("care"),
    );
    if (careFromUrl) selectCare(careFromUrl);

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
    if (submittingRef.current) return;
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

    submittingRef.current = true;
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
        message: `Your ${formatAppointmentTime(selectedTime)} slot is reserved. The clinic will confirm it shortly.`,
        confirmation: {
          date,
          doctorName: doctor?.name || "Clinic doctor",
          time: selectedTime,
        },
      });
      setTime("");
      formElement.reset();
      formStartedAt.current = Date.now();
    } catch (bookingError) {
      setResult({
        tone: "error",
        message: bookingError instanceof Error
          ? bookingError.message
          : "The appointment could not be reserved. Please call the clinic.",
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const selectedDayEnabled = Boolean(date) && dateIsEnabled(schedule, date);
  const scheduleText = scheduleSummary(schedule, doctorId);

  function checkNextClinicDay() {
    if (!nextClinicDate) return;
    setDate(nextClinicDate);
    setTime("");
    setResult(null);
  }

  const slotStatus = scheduleLoading
    ? "Loading clinic timings…"
    : availabilityLoading
      ? "Checking live availability…"
      : availabilityError
        ? "Live availability is temporarily unavailable."
        : !selectedDayEnabled
          ? "Appointments are closed on this day."
          : allSlots.length === 0
            ? "No appointment starts remain on this day."
            : `${availableSlots.length} of ${allSlots.length} appointment times available.`;

  return (
    <section id="appointment" className="section appointment-section">
      <div className="site-shell appointment-shell">
        <form className="booking-card appointment-form-panel" onSubmit={submitBooking} tabIndex={-1} aria-label="Book an appointment">
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
          {carePrefillMessage ? (
            <p className="booking-care-selection" role="status" aria-live="polite">
              <CheckCircle2 aria-hidden="true" /> {carePrefillMessage}
            </p>
          ) : null}

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
                  setTime("");
                  setCarePrefillMessage("");
                  setResult(null);
                }}
              required
              id="appointment-specialist"
            >
              {DOCTORS.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>{doctor.label}</option>
              ))}
            </select>
            <small className="mt-2 block text-slate-500">{scheduleText}</small>
          </label>

          <div className="form-row">
            <div className="booking-date-field">
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
                    setResult(null);
                  }}
                  required
                />
              </label>
              {nextClinicDate ? (
                <div className="booking-date-actions">
                  <button type="button" className="booking-next-day" onClick={checkNextClinicDay}>
                    Check next clinic day · {friendlyAppointmentDate(nextClinicDate)}
                  </button>
                </div>
              ) : null}
            </div>
            <fieldset
              className="booking-slot-fieldset"
              disabled={!selectedDayEnabled || scheduleLoading || availabilityLoading || availabilityError}
              aria-busy={scheduleLoading || availabilityLoading}
              aria-describedby="booking-slot-status"
            >
              <legend className="booking-slot-legend">Available time</legend>
              <p id="booking-slot-status" className="booking-slot-state" role="status" aria-live="polite">
                {slotStatus}
              </p>
              {!scheduleLoading && !availabilityLoading && !availabilityError && allSlots.length > 0 ? (
                <div className="booking-slot-grid">
                  {allSlots.map((slot) => {
                    const booked = occupiedSlots.has(slot);
                    const slotId = `appointment-${appointmentSlotId(doctorId, date, slot)}`;
                    return (
                      <label className="booking-slot-choice" htmlFor={slotId} key={slotId}>
                        <input
                          className="booking-slot-input"
                          id={slotId}
                          type="radio"
                          name="time"
                          value={slot}
                          checked={selectedTime === slot}
                          disabled={booked}
                          onChange={() => {
                            setTime(slot);
                            setResult(null);
                          }}
                        />
                        <span className="booking-slot-time">
                          <strong>{formatAppointmentTime(slot)}</strong>
                          {booked ? <small>Booked</small> : <small>Available</small>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </fieldset>
          </div>

          {date && !selectedDayEnabled && (
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
          <label className="booking-consent">
            <input name="consent" type="checkbox" required style={{ width: 18, height: 18 }} />
            <span>I agree that the clinic may use these details to arrange my appointment.</span>
          </label>
          {selectedTime ? (
            <section className="booking-review" aria-label="Review appointment selection">
              <p><small>Review your appointment</small></p>
              <p><strong>{selectedDoctor.name}</strong></p>
              <p>{friendlyAppointmentDate(date)} at {formatAppointmentTime(selectedTime)}</p>
              <p>{scheduleText}</p>
            </section>
          ) : null}
          <button
            className="button button-primary booking-submit"
            type="submit"
            disabled={submitting || scheduleLoading || availabilityLoading || availabilityError || !selectedTime}
          >
            {submitting ? <LoaderCircle className="animate-spin" /> : <CalendarCheck />}
            {submitting ? "Reserving slot…" : "Reserve appointment"}
          </button>
          {result ? (
            <section
              ref={feedback}
              tabIndex={-1}
              role={result.tone === "success" ? "status" : "alert"}
              aria-live={result.tone === "success" ? "polite" : "assertive"}
              className={`booking-feedback booking-feedback-${result.tone}`}
            >
              <div className="booking-feedback-heading">
                {result.tone === "success" ? <CheckCircle2 aria-hidden="true" /> : null}
                <p>{result.message}</p>
              </div>
              {result.confirmation ? (
                <p>
                  <strong>{result.confirmation.doctorName}</strong><br />
                  {friendlyAppointmentDate(result.confirmation.date)} · {formatAppointmentTime(result.confirmation.time)}
                </p>
              ) : null}
              {result.tone === "success" ? (
                <div className="booking-success-actions">
                  <a className="button button-primary" href={PUBLIC_BOOKING_WHATSAPP_URL} target="_blank" rel="noreferrer">
                    <MessageCircle aria-hidden="true" /> WhatsApp clinic (optional)
                  </a>
                  <button className="button button-ghost" type="button" onClick={() => setResult(null)}>Book another appointment</button>
                </div>
              ) : null}
            </section>
          ) : null}
          <p className="form-note">
            The selected time is held for you after submission and confirmed by the clinic.
            For emergencies, contact local emergency services.
          </p>
        </form>
        <div className="appointment-copy appointment-info-panel">
          <span className="section-kicker">Simple online booking</span>
          <h2>Choose a live appointment slot.</h2>
          <p>
            Appointments are available Monday to Saturday. Select a doctor, date,
            and one of the currently available times.
          </p>
          <div className="booking-points">
            <span><MessageCircle /> Optional WhatsApp help</span>
            <span><Clock3 /> Dr. Shafi 5–8 PM · Dr. Reshma 7–9 PM</span>
            <span><ShieldCheck /> Live timings set by the clinic</span>
          </div>
          <a className="phone-card" href="tel:+919019263709">
            <span><Phone /></span>
            <div><small>Prefer to call?</small><strong>+91 90192 63709</strong></div>
          </a>
        </div>
      </div>
    </section>
  );
}
