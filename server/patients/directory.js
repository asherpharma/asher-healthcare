import { getDocument, serviceAccountAccessToken } from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { createPatientSearchPrefixes } from "./search-index.js";

export const DEFAULT_DIRECTORY_PAGE_SIZE = 25;
export const MAX_DIRECTORY_PAGE_SIZE = 50;
export const MAX_DIRECTORY_SCAN_PAGES = 4;
export const LEGACY_SEARCH_SCAN_LIMIT = 500;
export const MAX_PATIENT_RESOLVER_IDS = 50;

const LEGACY_SCAN_PAGE_SIZE = 250;
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
  "archived",
  "archivedAt",
  "archivedBy",
  "archiveReason",
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

export function normalizeDirectoryPageSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DIRECTORY_PAGE_SIZE;
  return Math.min(MAX_DIRECTORY_PAGE_SIZE, Math.max(1, Math.trunc(parsed)));
}

export function normalizeDirectoryCursor(value) {
  const cursor = typeof value === "string" ? value.trim() : "";
  if (!cursor) return "";
  if (
    cursor.length > 2_048
    || /[\u0000-\u001f\u007f]/u.test(cursor)
    || !/^[A-Za-z0-9._~+/=-]+$/u.test(cursor)
  ) {
    throw new HttpError(400, "This patient directory page expired. Refresh the directory.");
  }
  return cursor;
}

export function patientDirectoryListUrl(
  env,
  { pageSize, cursor = "", recentFirst = true, archivedOnly = false } = {},
) {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/patients`,
  );
  url.searchParams.set("pageSize", String(normalizeDirectoryPageSize(pageSize)));
  if (recentFirst) {
    url.searchParams.set(
      "orderBy",
      archivedOnly ? "archived desc, updatedAt desc" : "updatedAt desc",
    );
  }
  PATIENT_FIELD_MASK.forEach((fieldPath) => url.searchParams.append("mask.fieldPaths", fieldPath));
  const normalizedCursor = normalizeDirectoryCursor(cursor);
  if (normalizedCursor) url.searchParams.set("pageToken", normalizedCursor);
  return url;
}

async function listPatientDocumentPage(
  env,
  { pageSize, cursor = "", recentFirst = true, archivedOnly = false } = {},
  { fetchImpl = fetch, accessTokenProvider = serviceAccountAccessToken } = {},
) {
  const accessToken = await accessTokenProvider(env);
  const response = await fetchImpl(
    patientDirectoryListUrl(env, { pageSize, cursor, recentFirst, archivedOnly }),
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  let result;
  try {
    result = await response.json();
  } catch {
    throw new HttpError(503, "The secure patient directory could not be loaded.");
  }
  if (!response.ok) {
    console.error("Patient directory REST error", response.status, result?.error?.status);
    throw new HttpError(
      response.status === 400 ? 400 : 503,
      response.status === 400
        ? "This patient directory page expired. Refresh the directory."
        : "The secure patient directory could not be loaded.",
    );
  }

  return {
    documents: (result.documents || []).map((document) => ({
      id: documentId(document.name),
      ...decodeFields(document.fields || {}),
    })),
    nextCursor: normalizeDirectoryCursor(String(result.nextPageToken || "")),
  };
}

async function listLegacyPatientDocuments(
  env,
  { maximum = LEGACY_SEARCH_SCAN_LIMIT + 1 } = {},
  dependencies = {},
) {
  const patients = [];
  let cursor = "";

  while (patients.length < maximum) {
    const page = await listPatientDocumentPage(
      env,
      {
        pageSize: Math.min(LEGACY_SCAN_PAGE_SIZE, maximum - patients.length),
        cursor,
        recentFirst: false,
      },
      dependencies,
    );
    patients.push(...page.documents);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return patients.slice(0, maximum);
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
  const leftTime = Date.parse(String(left.updatedAt || "")) || 0;
  const rightTime = Date.parse(String(right.updatedAt || "")) || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return String(left.fullName || "").localeCompare(String(right.fullName || ""), "en-IN");
}

function staffDirectoryScope(staff, staffRecord, includeArchived, archivedOnly = false) {
  const role = String(staffRecord?.role || staff?.role || "");
  if (!["admin", "doctor", "reception"].includes(role)) {
    throw new HttpError(403, "This staff account is no longer active.");
  }
  const doctorName = role === "doctor" ? String(staffRecord?.doctorName || "").trim() : "";
  if (role === "doctor" && !DOCTOR_IDS.has(doctorName)) {
    throw new HttpError(403, "This doctor login is not linked to a clinic doctor.");
  }
  if (archivedOnly && role !== "admin") {
    throw new HttpError(403, "Only clinic administrators can view archived patient records.");
  }
  return {
    role,
    doctorName,
    doctorId: DOCTOR_IDS.get(doctorName) || "",
    includeArchived: role === "admin" && (includeArchived === true || archivedOnly === true),
    archivedOnly: role === "admin" && archivedOnly === true,
  };
}

function patientIsVisible(patient, scope) {
  if (scope.archivedOnly) return patient.archived === true;
  if (!scope.includeArchived && patient.archived === true) return false;
  if (scope.role !== "doctor") return true;
  return patient.doctorName
    ? patient.doctorName === scope.doctorName
    : Boolean(scope.doctorId && patient.doctorId === scope.doctorId);
}

export function normalizePatientResolverIds(value) {
  const requested = typeof value === "string" ? [value] : value;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new HttpError(400, "Select at least one patient to continue.");
  }
  if (requested.length > MAX_PATIENT_RESOLVER_IDS) {
    throw new HttpError(
      400,
      `No more than ${MAX_PATIENT_RESOLVER_IDS} patients can be checked at once.`,
    );
  }

  const ids = [...new Set(requested.map((id) => String(id || "").trim()))];
  if (ids.some((id) => !/^[A-Za-z0-9_-]{1,128}$/u.test(id))) {
    throw new HttpError(400, "One or more patient references are invalid.");
  }
  return ids;
}

export function projectPatientDirectory(
  documents,
  staff,
  staffRecord,
  { includeArchived = false, archivedOnly = false } = {},
) {
  const scope = staffDirectoryScope(staff, staffRecord, includeArchived, archivedOnly);
  return documents
    .filter((patient) => patientIsVisible(patient, scope))
    .sort(sortPatients)
    .map((patient) => operationalPatient(patient, scope.includeArchived));
}

export async function patientDirectoryPageForStaff(
  env,
  staff,
  {
    includeArchived = false,
    archivedOnly = false,
    cursor = "",
    pageSize = DEFAULT_DIRECTORY_PAGE_SIZE,
  } = {},
  dependencies = {},
) {
  const getStaffDocument = dependencies.getDocument || getDocument;
  const staffRecord = await getStaffDocument(env, `staff/${staff.uid}`);
  const currentRole = String(staffRecord?.data?.role || "");
  if (
    !staffRecord
    || staffRecord.data.active !== true
    || !["admin", "doctor", "reception"].includes(currentRole)
  ) {
    throw new HttpError(403, "This staff account is no longer active.");
  }

  const scopeStaff = { ...staff, role: currentRole };
  // Validate the doctor assignment before any patient data is queried.
  staffDirectoryScope(scopeStaff, staffRecord.data, includeArchived, archivedOnly);
  const boundedPageSize = normalizeDirectoryPageSize(pageSize);
  const patients = [];
  let nextCursor = normalizeDirectoryCursor(cursor);

  for (let pageIndex = 0; pageIndex < MAX_DIRECTORY_SCAN_PAGES; pageIndex += 1) {
    const page = await listPatientDocumentPage(
      env,
      {
        pageSize: boundedPageSize - patients.length,
        cursor: nextCursor,
        archivedOnly,
      },
      dependencies,
    );
    patients.push(...projectPatientDirectory(
      page.documents,
      scopeStaff,
      staffRecord.data,
      { includeArchived, archivedOnly },
    ));
    nextCursor = page.nextCursor;
    if (archivedOnly && page.documents.some((patient) => patient.archived !== true)) {
      nextCursor = "";
    }
    if (patients.length >= boundedPageSize || !nextCursor) break;
  }

  return {
    patients: patients.slice(0, boundedPageSize),
    nextCursor,
    hasMore: Boolean(nextCursor),
  };
}

/** Resolve a small, explicit handoff set without enumerating the directory.
 * Missing, archived, and out-of-scope charts intentionally share the same
 * unavailable result so callers cannot use this endpoint to probe records.
 */
export async function resolvePatientDirectoryEntriesForStaff(
  env,
  staff,
  { patientIds, includeArchived = false } = {},
  dependencies = {},
) {
  const ids = normalizePatientResolverIds(patientIds);
  const getPatientDocument = dependencies.getDocument || getDocument;
  const staffRecord = await getPatientDocument(env, `staff/${staff.uid}`);
  const currentRole = String(staffRecord?.data?.role || "");
  if (
    !staffRecord
    || staffRecord.data.active !== true
    || !["admin", "doctor", "reception"].includes(currentRole)
  ) {
    throw new HttpError(403, "This staff account is no longer active.");
  }

  const scopeStaff = { ...staff, role: currentRole };
  const scope = staffDirectoryScope(scopeStaff, staffRecord.data, includeArchived);
  const documents = await Promise.all(
    ids.map(async (id) => {
      const document = await getPatientDocument(env, `patients/${id}`);
      return document ? { id, ...document.data } : null;
    }),
  );
  const patients = [];
  const unavailableIds = [];

  documents.forEach((patient, index) => {
    const id = ids[index];
    if (!patient || !patientIsVisible(patient, scope)) {
      unavailableIds.push(id);
      return;
    }
    patients.push(operationalPatient(patient, scope.includeArchived));
  });

  return { patients, unavailableIds };
}

// Compatibility alias for server callers migrating from the former bulk API.
export const patientDirectoryForStaff = patientDirectoryPageForStaff;

function directorySearchMatch(patient, token) {
  return createPatientSearchPrefixes(patient).includes(token);
}

function minimalSearchPatient(patient) {
  return patient;
}

/** Temporary compatibility path for records created before searchPrefixes.
 * It is intentionally capped and should be removed after the resumable admin
 * backfill reports completion.
 */
export async function legacyPatientSearchForStaff(
  env,
  staff,
  staffRecord,
  token,
  limit = 10,
  { archivedOnly = false } = {},
  dependencies = {},
) {
  const documents = await listLegacyPatientDocuments(
    env,
    { maximum: LEGACY_SEARCH_SCAN_LIMIT + 1 },
    dependencies,
  );
  if (documents.length > LEGACY_SEARCH_SCAN_LIMIT) return { patients: [], scanSkipped: true };
  return {
    patients: projectLegacyPatientSearch(
      documents,
      staff,
      staffRecord,
      token,
      limit,
      { archivedOnly },
    ),
    scanSkipped: false,
  };
}

export function projectLegacyPatientSearch(
  documents,
  staff,
  staffRecord,
  token,
  limit = 10,
  { archivedOnly = false } = {},
) {
  return projectPatientDirectory(
    documents.filter((patient) => directorySearchMatch(patient, token)),
    staff,
    staffRecord,
    { includeArchived: archivedOnly, archivedOnly },
  ).slice(0, Math.max(1, limit)).map(minimalSearchPatient);
}
