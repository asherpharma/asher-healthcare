import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  requireActiveStaff,
} from "../../../server/razorpay/firebase.js";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJson,
} from "../../../server/razorpay/http.js";
import {
  dateDay,
  normalizeSchedule,
  timeSlots,
} from "../../../server/appointments/schedule.js";

const DOCTORS = ["pediatrics", "obg"];
const STAFF_SOURCES = ["reception", "phone", "walk-in"];
const PUBLIC_FORM_MINIMUM_MS = 750;

function cleanText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function clinicClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    time: `${read("hour")}:${read("minute")}`,
  };
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const body = await readJson(context.request);
    const patientName = cleanText(body.patientName, 80);
    const phone = cleanText(body.phone, 20);
    const doctorId = cleanText(body.doctorId, 30);
    const preferredDate = cleanText(body.preferredDate, 10);
    const preferredTime = cleanText(body.preferredTime, 5);
    const reason = cleanText(body.reason, 500);
    const source = cleanText(body.source || "website", 20);
    const now = new Date();
    const clinicNow = clinicClock(now);

    if (patientName.length < 2) throw new HttpError(400, "Enter the patient’s full name.");
    if (phone.replace(/\D/gu, "").length < 10) throw new HttpError(400, "Enter a valid mobile number.");
    if (!DOCTORS.includes(doctorId)) throw new HttpError(400, "Select a clinic doctor.");
    if (!validDate(preferredDate) || preferredDate < clinicNow.date) {
      throw new HttpError(400, "Choose a valid appointment date.");
    }
    const latest = new Date(`${clinicNow.date}T00:00:00Z`);
    latest.setUTCDate(latest.getUTCDate() + 180);
    if (preferredDate > latest.toISOString().slice(0, 10)) {
      throw new HttpError(400, "Appointments can be booked up to six months ahead.");
    }
    if (source === "website") {
      if (body.privacyAccepted !== true) {
        throw new HttpError(400, "Please accept the appointment privacy notice.");
      }
      if (cleanText(body.website, 200)) {
        throw new HttpError(400, "The appointment request could not be verified. Please refresh and try again.");
      }
      const formElapsedMs = Number(body.formElapsedMs);
      if (!Number.isFinite(formElapsedMs) || formElapsedMs < PUBLIC_FORM_MINIMUM_MS) {
        throw new HttpError(400, "Please take a moment to review the appointment details and try again.");
      }
    }

    let actorUid = "public-website";
    let status = "requested";
    if (source !== "website") {
      if (!STAFF_SOURCES.includes(source)) throw new HttpError(400, "Choose a valid booking source.");
      const staff = await requireActiveStaff(context.request, context.env);
      actorUid = staff.uid;
      status = "confirmed";
    }

    const scheduleDocument = await getDocument(
      context.env,
      "clinicSettings/appointmentSchedule",
    );
    const schedule = normalizeSchedule(scheduleDocument?.data);
    const doctorSchedule = schedule.doctors[doctorId];
    if (!doctorSchedule.enabled || !schedule.enabledDays.includes(dateDay(preferredDate))) {
      throw new HttpError(400, "This doctor is not available on the selected day.");
    }
    if (!timeSlots(doctorSchedule).includes(preferredTime)) {
      throw new HttpError(400, "Choose one of the available appointment times.");
    }
    if (preferredDate === clinicNow.date && preferredTime <= clinicNow.time) {
      throw new HttpError(400, "That appointment time has already passed. Please choose a later slot.");
    }

    const appointmentId = crypto.randomUUID().replaceAll("-", "");
    const slotId = `${doctorId}_${preferredDate}_${preferredTime.replace(":", "")}`;
    const consent = source === "website"
      ? {
          status: "accepted",
          method: "website-checkbox",
          capturedAt: now,
          capturedBy: "patient-self-service",
        }
      : {
          status: "not-captured",
          method: "none",
          capturedAt: null,
          capturedBy: null,
        };
    await commitWrites(context.env, [
      createDocumentWrite(context.env, `appointmentSlots/${slotId}`, {
        appointmentId,
        doctorId,
        date: preferredDate,
        time: preferredTime,
        status: "reserved",
        createdAt: now,
        updatedAt: now,
      }),
      createDocumentWrite(context.env, `appointments/${appointmentId}`, {
        patientName,
        phone,
        doctorId,
        preferredDate,
        preferredTime,
        reason,
        status,
        source,
        privacyAccepted: source === "website",
        consent,
        slotId,
        createdBy: actorUid,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    return json({ appointmentId, slotId, status }, 201);
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) {
      return json({ error: "That time was just booked. Please choose another available slot." }, 409);
    }
    return errorResponse(error);
  }
}
