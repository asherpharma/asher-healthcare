import { HttpError } from "../razorpay/http.js";
import {
  RECEPTION_DOCTORS,
  clinicClock,
  normalizeReceptionName,
  normalizeReceptionPhone,
  validReceptionDate,
} from "../reception/workflow.js";

const DEMOGRAPHIC_FIELDS = Object.freeze([
  "fullName",
  "phone",
  "dateOfBirth",
  "gender",
  "doctorName",
  "address",
]);
const CLINICAL_FIELDS = Object.freeze(["allergies", "medicalHistory"]);

const DOCTOR_BY_NAME = new Map(
  Object.values(RECEPTION_DOCTORS).map((doctor) => [doctor.name, doctor]),
);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
function cleanText(value, field, maximum, { required = false, collapse = false } = {}) {
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be entered as text.`);
  }
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .trim();
  const normalized = collapse ? cleaned.replace(/\s+/gu, " ") : cleaned;
  if (required && !normalized) throw new HttpError(400, `${field} is required.`);
  if (Array.from(normalized).length > maximum) {
    throw new HttpError(400, `${field} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

export function patientDoctor(patient) {
  const doctorName = String(patient?.doctorName || "").trim();
  if (doctorName) return DOCTOR_BY_NAME.get(doctorName) || null;
  const doctorId = String(patient?.doctorId || "").trim();
  return RECEPTION_DOCTORS[doctorId] || null;
}

export function doctorCanEditPatient(actor, patient) {
  if (actor?.role !== "doctor") return false;
  const actorDoctor = DOCTOR_BY_NAME.get(String(actor.doctorName || "").trim());
  const assignedDoctor = patientDoctor(patient);
  return Boolean(actorDoctor && assignedDoctor && actorDoctor.id === assignedDoctor.id);
}

export function canonicalPatientIdentity(patient) {
  const normalizedName = normalizeReceptionName(patient?.fullName);
  const normalizedPhone = normalizeReceptionPhone(patient?.phone);
  const dateOfBirth = String(patient?.dateOfBirth || "").trim();
  const gender = String(patient?.gender || "").trim().toLowerCase();
  if (
    normalizedName.length < 2
    || !normalizedPhone
    || !/^\d{4}-\d{2}-\d{2}$/u.test(dateOfBirth)
    || !["female", "male", "other"].includes(gender)
  ) {
    return null;
  }
  return { normalizedName, normalizedPhone, dateOfBirth, gender };
}

/**
 * Builds an authoritative patient profile patch for a staff role.
 *
 * Administrators may update demographics, assignment, and clinical background.
 * Reception may update only demographics and assignment. Doctors may update
 * only clinical background and only for a patient currently assigned to them.
 */
export function validatePatientProfileUpdate(body, actor, patient, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Enter valid patient profile details.");
  }
  if (!actor || !["admin", "reception", "doctor"].includes(actor.role)) {
    throw new HttpError(403, "This staff account cannot update patient profiles.");
  }
  if (patient?.archived === true) {
    throw new HttpError(409, "Restore this patient before changing the profile.");
  }

  const canEditDemographics = actor.role === "admin" || actor.role === "reception";
  const canEditClinical = actor.role === "admin" || actor.role === "doctor";

  if (actor.role === "doctor" && !doctorCanEditPatient(actor, patient)) {
    throw new HttpError(403, "This patient is not assigned to your doctor account.");
  }
  if (!canEditDemographics && DEMOGRAPHIC_FIELDS.some((field) => hasOwn(body, field))) {
    throw new HttpError(403, "Doctors cannot change patient identity, contact, or assignment details.");
  }
  if (!canEditClinical && CLINICAL_FIELDS.some((field) => hasOwn(body, field))) {
    throw new HttpError(403, "Reception accounts cannot change clinical background.");
  }

  const updates = {};
  if (canEditDemographics) {
    const missingField = DEMOGRAPHIC_FIELDS.find((field) => !hasOwn(body, field));
    if (missingField) {
      throw new HttpError(400, "Complete every patient identity and contact field before saving.");
    }

    const fullName = cleanText(body.fullName, "Full name", 100, {
      required: true,
      collapse: true,
    });
    if (normalizeReceptionName(fullName).length < 2) {
      throw new HttpError(400, "Enter the patient\u2019s full name.");
    }
    const phone = normalizeReceptionPhone(body.phone);
    if (!phone) throw new HttpError(400, "Enter a valid Indian mobile number.");

    const dateOfBirth = cleanText(body.dateOfBirth, "Date of birth", 10, { required: true });
    const clinicDate = clinicClock(now).date;
    if (dateOfBirth < "1900-01-01" || !validReceptionDate(dateOfBirth, clinicDate)) {
      throw new HttpError(400, "Enter a valid date of birth that is not in the future.");
    }

    const gender = cleanText(body.gender, "Gender", 12, { required: true }).toLowerCase();
    if (!["female", "male", "other"].includes(gender)) {
      throw new HttpError(400, "Choose the patient\u2019s gender.");
    }

    const doctorName = cleanText(body.doctorName, "Consulting doctor", 100, { required: true });
    const doctor = DOCTOR_BY_NAME.get(doctorName);
    if (!doctor) throw new HttpError(400, "Choose a clinic doctor.");

    updates.fullName = fullName;
    updates.phone = phone;
    updates.dateOfBirth = dateOfBirth;
    updates.gender = gender;
    updates.doctorId = doctor.id;
    updates.doctorName = doctor.name;
    updates.address = cleanText(body.address, "Address", 500);
    if (patient?.caseType === "specialist") updates.specialty = doctor.specialty;
    else if (patient?.caseType === "general") updates.specialty = "";
  }

  if (canEditClinical) {
    if (hasOwn(body, "allergies")) {
      updates.allergies = cleanText(body.allergies, "Known allergies", 2_000);
    }
    if (hasOwn(body, "medicalHistory")) {
      updates.medicalHistory = cleanText(body.medicalHistory, "Medical history", 5_000);
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new HttpError(400, "No permitted patient profile changes were provided.");
  }

  const proposedPatient = { ...patient, ...updates };
  const identity = canonicalPatientIdentity(proposedPatient);
  if (!identity) {
    throw new HttpError(400, "The patient identity details are incomplete or invalid.");
  }
  const changedFields = Object.keys(updates).filter((field) => (
    String(patient?.[field] ?? "") !== String(updates[field] ?? "")
  ));

  return {
    updates,
    identity,
    changedFields,
    canEditDemographics,
    canEditClinical,
  };
}
