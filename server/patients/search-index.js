import {
  normalizeReceptionName,
  normalizeReceptionPhone,
} from "../reception/workflow.js";

const MAX_PREFIXES = 96;
const DOCTOR_KEY_BY_NAME = new Map([
  ["Dr. Lt Col Shafi Ahamad", "pediatrics"],
  ["Dr. Shaik Reshma", "obg"],
]);
const DOCTOR_KEYS = new Set(DOCTOR_KEY_BY_NAME.values());

function addPrefixes(target, namespace, value, minimum, maximum = 48) {
  const bounded = String(value || "").trim().slice(0, maximum);
  for (let length = minimum; length <= bounded.length; length += 1) {
    target.add(`${namespace}:${bounded.slice(0, length)}`);
    if (target.size >= MAX_PREFIXES) return;
  }
}

function addExact(target, namespace, value, maximum = 48) {
  const bounded = String(value || "").trim().slice(0, maximum);
  if (bounded && target.size < MAX_PREFIXES) target.add(`${namespace}:${bounded}`);
}

/**
 * Produces a deliberately small, non-clinical search index for a patient.
 * Values are stored only on the protected patient document and are queried
 * through the role-aware server endpoint; they are never returned to clients.
 */
export function createPatientSearchPrefixes(patient) {
  const prefixes = new Set();
  // Keep the two exact identifiers first so even unusually long names cannot
  // crowd mobile-number or patient-number lookup out of the bounded array.
  const normalizedPhone = normalizeReceptionPhone(patient?.phone);
  if (normalizedPhone) addPrefixes(prefixes, "tel", normalizedPhone.slice(-10), 6, 10);

  const patientNumber = String(patient?.patientNumber || "")
    .trim()
    .toLocaleUpperCase("en-IN")
    .replace(/[^A-Z0-9-]+/gu, "")
    .slice(0, 32);
  if (patientNumber) addPrefixes(prefixes, "id", patientNumber, 3, 32);

  const normalizedName = normalizeReceptionName(patient?.fullName);
  if (normalizedName) {
    const words = normalizedName.split(" ").filter(Boolean);
    // Reserve an exact entry and useful prefixes for every name part before
    // spending the remaining bounded index on the full phrase. This keeps a
    // later surname discoverable even when the patient has a long name or ID.
    addExact(prefixes, "name", normalizedName);
    words.forEach((word) => addExact(prefixes, "name", word, 32));
    words.forEach((word) => {
      if (prefixes.size < MAX_PREFIXES) addPrefixes(prefixes, "name", word, 3, 10);
    });
    if (prefixes.size < MAX_PREFIXES) addPrefixes(prefixes, "name", normalizedName, 3);
  }

  return Array.from(prefixes).slice(0, MAX_PREFIXES);
}

export function patientSearchToken(value) {
  const cleaned = String(value || "").trim().slice(0, 100);
  if (!cleaned) return "";

  const patientNumber = cleaned
    .toLocaleUpperCase("en-IN")
    .replace(/[^A-Z0-9-]+/gu, "");
  // Clinic identifiers are uppercase alphanumeric codes with a separator
  // (for example ASH-… and the legacy AHC-…). Requiring that shape avoids
  // misclassifying ordinary patient names as identifiers.
  const knownClinicNumber = /^(?:ASH|AHC)-[A-Z0-9-]{1,24}$/u.test(patientNumber);
  const otherNumberWithDigit = /^[A-Z]{2,8}-(?=[A-Z0-9-]*\d)[A-Z0-9-]{1,24}$/u
    .test(patientNumber);
  if (knownClinicNumber || otherNumberWithDigit) {
    return `id:${patientNumber.slice(0, 32)}`;
  }

  const digits = cleaned.replace(/\D/gu, "");
  let national = digits;
  if (national.startsWith("0091")) national = national.slice(4);
  else if (national.length > 10 && national.startsWith("91")) national = national.slice(2);
  if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  if (/^[6-9]\d{5,9}$/u.test(national)) return `tel:${national}`;

  const normalizedName = normalizeReceptionName(cleaned);
  return normalizedName.length >= 3 ? `name:${normalizedName.slice(0, 48)}` : "";
}

/** Canonical, non-display assignment key used only for protected search scope. */
export function patientSearchDoctorKey(patient) {
  const doctorName = String(patient?.doctorName || "").trim();
  if (DOCTOR_KEY_BY_NAME.has(doctorName)) return DOCTOR_KEY_BY_NAME.get(doctorName);
  const doctorId = String(patient?.doctorId || "").trim().toLowerCase();
  return DOCTOR_KEYS.has(doctorId) ? doctorId : "";
}
