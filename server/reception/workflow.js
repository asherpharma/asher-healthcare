import { HttpError } from "../razorpay/http.js";
import {
  DEFAULT_RECEPTION_SERVICE_CATALOG,
  normalizeReceptionServiceCatalog,
  receptionServiceForSelection,
} from "./service-catalog.js";

export const RECEPTION_DOCTORS = Object.freeze({
  pediatrics: Object.freeze({
    id: "pediatrics",
    name: "Dr. Lt Col Shafi Ahamad",
    specialty: "pediatrics",
    specialistLabel: "Pediatric consultation",
  }),
  obg: Object.freeze({
    id: "obg",
    name: "Dr. Shaik Reshma",
    specialty: "obg",
    specialistLabel: "Obstetrics & Gynaecology consultation",
  }),
});

const PATIENT_NAME_TITLES = new Set(["baby", "child", "dr", "master", "miss", "mr", "mrs", "ms"]);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function cleanText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function normalizeReceptionName(value) {
  const words = cleanText(value, 100)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]+/gu, "")
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .split(/\s+/gu)
    .filter(Boolean);
  while (words.length > 1 && PATIENT_NAME_TITLES.has(words[0])) words.shift();
  return words.join(" ");
}

export function normalizeReceptionPhone(value) {
  const digits = cleanText(value, 24).replace(/\D/gu, "");
  let national = digits;
  if (national.startsWith("0091")) national = national.slice(4);
  else if (national.length === 12 && national.startsWith("91")) national = national.slice(2);
  if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  return /^[6-9]\d{9}$/u.test(national) ? `+91${national}` : null;
}

export function validReceptionDate(value, today) {
  const candidate = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate) || candidate > today) return false;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate;
}

export function clinicClock(now = new Date()) {
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

export function validateReceptionRegistration(
  body,
  now = new Date(),
  serviceCatalogValue = DEFAULT_RECEPTION_SERVICE_CATALOG,
) {
  const clinicNow = clinicClock(now);
  const requestId = cleanText(body?.requestId, 64).toLowerCase();
  const patientId = cleanText(body?.patientId, 128);
  const fullName = cleanText(body?.fullName, 100);
  const normalizedName = normalizeReceptionName(fullName);
  const phone = cleanText(body?.phone, 24);
  const normalizedPhone = normalizeReceptionPhone(phone);
  const dateOfBirth = cleanText(body?.dateOfBirth, 10);
  const gender = cleanText(body?.gender, 12).toLowerCase();
  const caseType = cleanText(body?.caseType, 20).toLowerCase();
  const doctorId = cleanText(body?.doctorId, 30).toLowerCase();
  const specialty = cleanText(body?.specialty, 30).toLowerCase();
  const clientServiceId = cleanText(body?.serviceId, 30).toLowerCase();
  const clientFee = Number(body?.fee);
  const doctor = RECEPTION_DOCTORS[doctorId];

  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new HttpError(400, "Start a fresh reception request and try again.");
  }
  if (patientId && !/^[A-Za-z0-9_-]{1,128}$/u.test(patientId)) {
    throw new HttpError(400, "Choose a valid existing patient chart.");
  }
  if (fullName.length < 2 || normalizedName.length < 2) {
    throw new HttpError(400, "Enter the patient’s full name.");
  }
  if (!normalizedPhone) throw new HttpError(400, "Enter a valid Indian mobile number.");
  if (!validReceptionDate(dateOfBirth, clinicNow.date)) {
    throw new HttpError(400, "Enter a valid date of birth that is not in the future.");
  }
  if (!["female", "male", "other"].includes(gender)) {
    throw new HttpError(400, "Choose the patient’s gender.");
  }
  if (!["general", "specialist"].includes(caseType)) {
    throw new HttpError(400, "Choose a valid consultation category.");
  }
  if (!doctor) throw new HttpError(400, "Choose a clinic doctor.");

  const expectedSpecialty = caseType === "specialist" ? doctor.specialty : "";
  if (caseType === "specialist" && specialty !== expectedSpecialty) {
    throw new HttpError(400, "The specialist department does not match the selected doctor.");
  }
  if (caseType === "general" && specialty) {
    throw new HttpError(400, "General consultations must not include a specialist department.");
  }

  const service = receptionServiceForSelection(
    normalizeReceptionServiceCatalog(serviceCatalogValue),
    caseType,
    expectedSpecialty,
  );
  if (clientServiceId && clientServiceId !== service.serviceId) {
    throw new HttpError(409, "The selected consultation service changed. Review the visit and try again.");
  }
  if (clientFee !== service.fee) {
    throw new HttpError(409, "The consultation fee changed. Review the visit and try again.");
  }

  return {
    requestId,
    patientId,
    fullName,
    normalizedName,
    phone,
    normalizedPhone,
    dateOfBirth,
    gender,
    caseType,
    serviceId: service.serviceId,
    specialty: expectedSpecialty,
    doctorId,
    doctorName: doctor.name,
    consultationLabel: service.label,
    fee: service.fee,
    duplicateAcknowledged: body?.duplicateAcknowledged === true,
    clinicDate: clinicNow.date,
    clinicTime: clinicNow.time,
  };
}

export function receptionIdentityMaterial(registration) {
  return [
    "asher-patient-identity-v2",
    registration.normalizedPhone,
    registration.normalizedName,
    registration.dateOfBirth,
    registration.gender,
  ].join("\n");
}

export function receptionRequestMaterial(actorUid, requestId) {
  return [
    "asher-reception-request-v1",
    String(actorUid || ""),
    String(requestId || ""),
  ].join("\n");
}

/**
 * Stable client intent used only to replay an already committed reception
 * request. It deliberately excludes the server-authoritative fee and label,
 * so a lost successful response remains replayable after an administrator
 * later changes the catalogue. The full registration validator still runs
 * before any new arrival is written.
 */
export function receptionRequestIntent(body) {
  const requestId = cleanText(body?.requestId, 64).toLowerCase();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new HttpError(400, "Start a fresh reception request and try again.");
  }
  const patientId = cleanText(body?.patientId, 128);
  if (patientId && !/^[A-Za-z0-9_-]{1,128}$/u.test(patientId)) {
    throw new HttpError(400, "Select the patient record again.");
  }
  return {
    requestId,
    material: JSON.stringify({
      patientId,
      normalizedName: normalizeReceptionName(body?.fullName),
      normalizedPhone: normalizeReceptionPhone(body?.phone) || "",
      dateOfBirth: cleanText(body?.dateOfBirth, 10),
      gender: cleanText(body?.gender, 12).toLowerCase(),
      caseType: cleanText(body?.caseType, 20).toLowerCase(),
      serviceId: cleanText(body?.serviceId, 30).toLowerCase(),
      specialty: cleanText(body?.specialty, 30).toLowerCase(),
      doctorId: cleanText(body?.doctorId, 30).toLowerCase(),
      duplicateAcknowledged: body?.duplicateAcknowledged === true,
    }),
  };
}

export function receptionPayloadMaterial(registration) {
  return JSON.stringify({
    patientId: registration.patientId,
    normalizedName: registration.normalizedName,
    normalizedPhone: registration.normalizedPhone,
    dateOfBirth: registration.dateOfBirth,
    gender: registration.gender,
    caseType: registration.caseType,
    serviceId: registration.serviceId,
    specialty: registration.specialty,
    doctorId: registration.doctorId,
    fee: registration.fee,
    duplicateAcknowledged: registration.duplicateAcknowledged,
  });
}

export function exactReceptionPatientIdentity(patient, registration) {
  return normalizeReceptionName(patient?.fullName) === registration.normalizedName
    && normalizeReceptionPhone(patient?.phone) === registration.normalizedPhone
    && String(patient?.dateOfBirth || "") === registration.dateOfBirth
    && String(patient?.gender || "").toLowerCase() === registration.gender;
}

export function createReceptionInvoiceNumber(now = new Date(), randomId = crypto.randomUUID()) {
  const date = clinicClock(now).date.replaceAll("-", "");
  const suffix = randomId.replaceAll("-", "").slice(0, 8).toUpperCase();
  return `ASH-${date}-${suffix}`;
}

export function queueTokenLabel(token, doctorId) {
  const prefix = doctorId === "obg" ? "G" : "P";
  return `${prefix}-${String(token).padStart(2, "0")}`;
}
