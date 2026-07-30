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
  clinicDate,
  dateDay,
  normalizeSchedule,
  timeSlots,
} from "../../../server/appointments/schedule.js";

const DOCTORS = ["pediatrics", "obg"];
const STAFF_SOURCES = ["reception", "phone", "walk-in"];

function cleanText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
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

    if (patientName.length < 2) throw new HttpError(400, "Enter the patient’s full name.");
    if (phone.replace(/\D/gu, "").length < 10) throw new HttpError(400, "Enter a valid mobile number.");
    if (!DOCTORS.includes(doctorId)) throw new HttpError(400, "Select a clinic doctor.");
    if (!validDate(preferredDate) || preferredDate < clinicDate()) {
      throw new HttpError(400, "Choose a valid appointment date.");
    }
    const latest = new Date();
    latest.setUTCDate(latest.getUTCDate() + 180);
    if (preferredDate > latest.toISOString().slice(0, 10)) {
      throw new HttpError(400, "Appointments can be booked up to six months ahead.");
    }
    if (source === "website" && body.privacyAccepted !== true) {
      throw new HttpError(400, "Please accept the appointment privacy notice.");
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

    const appointmentId = crypto.randomUUID().replaceAll("-", "");
    const slotId = `${doctorId}_${preferredDate}_${preferredTime.replace(":", "")}`;
    const now = new Date();
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
        privacyAccepted: true,
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
