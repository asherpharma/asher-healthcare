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
const PUBLIC_CLIENT_WINDOW_MS = 60_000;
const PUBLIC_PHONE_WINDOW_MS = 5 * 60_000;

function cleanText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizedPhone(value) {
  return cleanText(value, 20).replace(/\D/gu, "");
}

function normalizedName(value) {
  return cleanText(value, 80)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function clientAddress(request) {
  return cleanText(
    request.headers.get("CF-Connecting-IP")
      || request.headers.get("X-Forwarded-For")?.split(",")[0]
      || "unknown",
    64,
  );
}

async function fingerprint(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function publicBookingGuards(request, bookingIdentity, now) {
  const userAgent = cleanText(request.headers.get("User-Agent"), 200);
  const clientHash = await fingerprint(`asher-booking-client-v1\n${clientAddress(request)}\n${userAgent}`);
  const bookingHash = await fingerprint(`asher-booking-identity-v2\n${bookingIdentity}`);
  const clientBucket = Math.floor(now.getTime() / PUBLIC_CLIENT_WINDOW_MS);
  const phoneBucket = Math.floor(now.getTime() / PUBLIC_PHONE_WINDOW_MS);
  return [
    {
      path: `bookingGuards/client_${clientHash}_${clientBucket}`,
      data: {
        kind: "client-minute",
        createdAt: now,
        expiresAt: new Date(now.getTime() + PUBLIC_CLIENT_WINDOW_MS * 2),
      },
    },
    {
      path: `bookingGuards/booking_${bookingHash}_${phoneBucket}`,
      data: {
        kind: "exact-booking-five-minutes",
        createdAt: now,
        expiresAt: new Date(now.getTime() + PUBLIC_PHONE_WINDOW_MS * 2),
      },
    },
  ];
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
    const phoneDigits = normalizedPhone(phone);
    const requestedPatientId = cleanText(body.patientId, 128);
    const doctorId = cleanText(body.doctorId, 30);
    const preferredDate = cleanText(body.preferredDate, 10);
    const preferredTime = cleanText(body.preferredTime, 5);
    const reason = cleanText(body.reason, 500);
    const source = cleanText(body.source || "website", 20);
    const now = new Date();
    const clinicNow = clinicClock(now);

    if (patientName.length < 2) throw new HttpError(400, "Enter the patient’s full name.");
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      throw new HttpError(400, "Enter a valid mobile number.");
    }
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
    let patientId = "";
    if (source !== "website") {
      if (!STAFF_SOURCES.includes(source)) throw new HttpError(400, "Choose a valid booking source.");
      const staff = await requireActiveStaff(context.request, context.env);
      actorUid = staff.uid;
      status = "confirmed";
      if (requestedPatientId) {
        const patientDocument = await getDocument(context.env, `patients/${requestedPatientId}`);
        if (!patientDocument) throw new HttpError(400, "The selected patient record no longer exists.");
        if (
          normalizedPhone(patientDocument.data.phone) !== phoneDigits
          || normalizedName(patientDocument.data.fullName) !== normalizedName(patientName)
        ) {
          throw new HttpError(400, "The selected patient record does not match the booking details.");
        }
        patientId = requestedPatientId;
      }
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
    const bookingIdentity = [
      phoneDigits,
      normalizedName(patientName),
      doctorId,
      preferredDate,
      preferredTime,
    ].join("\n");
    const guardWrites = source === "website"
      ? (await publicBookingGuards(context.request, bookingIdentity, now)).map((guard) => (
          createDocumentWrite(context.env, guard.path, guard.data)
        ))
      : [];
    await commitWrites(context.env, [
      ...guardWrites,
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
        ...(patientId ? { patientId } : {}),
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
      return json({
        error: "That slot is no longer available, or this appointment was submitted recently. Please refresh and try again shortly.",
      }, 409);
    }
    return errorResponse(error);
  }
}
