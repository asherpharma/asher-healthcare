import { getDocument, serviceAccountAccessToken } from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";

const PAGE_SIZE = 500;
const MAX_PAGES = 20;
const PATIENT_FIELD_MASK = [
  "patientNumber",
  "fullName",
  "phone",
  "dateOfBirth",
  "gender",
  "doctorId",
  "doctorName",
  "caseType",
  "specialty",
  "consultationFee",
  "address",
  "archived",
  "archivedAt",
  "archivedBy",
  "archiveReason",
  "createdAt",
  "updatedAt",
];

const DOCTOR_IDS = new Map([
  ["Dr. Lt Col Shafi Ahamad", "pediatrics"],
  ["Dr. Shaik Reshma", "obg"],
]);

function decodeValue(value = {}) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return undefined;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

function documentId(name = "") {
  return decodeURIComponent(name.split("/").at(-1) || "");
}

function firestorePatientsUrl(env, pageToken = "") {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/patients`,
  );
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  PATIENT_FIELD_MASK.forEach((fieldPath) => url.searchParams.append("mask.fieldPaths", fieldPath));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url;
}

async function listMaskedPatientDocuments(env) {
  const accessToken = await serviceAccountAccessToken(env);
  const patients = [];
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetch(firestorePatientsUrl(env, pageToken), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Patient directory REST error", response.status, result?.error?.status);
      throw new HttpError(503, "The secure patient directory could not be loaded.");
    }

    (result.documents || []).forEach((document) => {
      patients.push({ id: documentId(document.name), ...decodeFields(document.fields || {}) });
    });
    pageToken = String(result.nextPageToken || "");
    if (!pageToken) return patients;
  }

  throw new HttpError(503, "The patient directory is too large to load safely. Please contact support.");
}

function operationalPatient(patient, includeArchiveMetadata) {
  const entry = {
    id: patient.id,
    patientNumber: String(patient.patientNumber || ""),
    fullName: String(patient.fullName || "Patient"),
    phone: String(patient.phone || ""),
    dateOfBirth: String(patient.dateOfBirth || ""),
    gender: String(patient.gender || ""),
    doctorId: String(patient.doctorId || ""),
    doctorName: String(patient.doctorName || ""),
    caseType: String(patient.caseType || ""),
    specialty: String(patient.specialty || ""),
    consultationFee: Number(patient.consultationFee || 0),
    address: String(patient.address || ""),
  };

  if (!includeArchiveMetadata) return entry;
  return {
    ...entry,
    archived: patient.archived === true,
    archivedAt: String(patient.archivedAt || ""),
    archivedBy: String(patient.archivedBy || ""),
    archiveReason: String(patient.archiveReason || ""),
  };
}

function sortPatients(left, right) {
  const leftTime = Date.parse(String(left.updatedAt || left.createdAt || "")) || 0;
  const rightTime = Date.parse(String(right.updatedAt || right.createdAt || "")) || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return String(left.fullName || "").localeCompare(String(right.fullName || ""), "en-IN");
}

export async function patientDirectoryForStaff(env, staff, { includeArchived = false } = {}) {
  const staffRecord = await getDocument(env, `staff/${staff.uid}`);
  const currentRole = String(staffRecord?.data?.role || "");
  if (
    !staffRecord
    || staffRecord.data.active !== true
    || !["admin", "doctor", "reception"].includes(currentRole)
  ) {
    throw new HttpError(403, "This staff account is no longer active.");
  }

  const documents = await listMaskedPatientDocuments(env);
  return projectPatientDirectory(
    documents,
    { ...staff, role: currentRole },
    staffRecord.data,
    { includeArchived },
  );
}

export function projectPatientDirectory(
  documents,
  staff,
  staffRecord,
  { includeArchived = false } = {},
) {
  const doctorName = staff.role === "doctor" ? String(staffRecord.doctorName || "").trim() : "";
  if (staff.role === "doctor" && !DOCTOR_IDS.has(doctorName)) {
    throw new HttpError(403, "This doctor login is not linked to a clinic doctor.");
  }
  const doctorId = DOCTOR_IDS.get(doctorName) || "";
  const canIncludeArchived = staff.role === "admin" && includeArchived;

  return documents
    .filter((patient) => canIncludeArchived || patient.archived !== true)
    .filter((patient) => staff.role !== "doctor"
      || (patient.doctorName
        ? patient.doctorName === doctorName
        : Boolean(doctorId && patient.doctorId === doctorId)))
    .sort(sortPatients)
    .map((patient) => operationalPatient(patient, canIncludeArchived));
}
