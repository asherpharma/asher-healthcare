import { getDocument, documentName, serviceAccountAccessToken } from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import {
  patientSearchDoctorKey,
  patientSearchToken,
} from "./search-index.js";
import { legacyPatientSearchForStaff } from "./directory.js";

const MAX_PAGE_SIZE = 25;
const SEARCH_FIELD_MASK = [
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

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodePatientSearchCursor({ queryKey, updatedAt, id }) {
  const payload = JSON.stringify({ v: 1, queryKey, updatedAt, id });
  return bytesToBase64Url(new TextEncoder().encode(payload));
}

export function decodePatientSearchCursor(value, expectedQueryKey) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(String(value))));
    if (
      decoded?.v !== 1
      || decoded.queryKey !== expectedQueryKey
      || typeof decoded.updatedAt !== "string"
      || Number.isNaN(Date.parse(decoded.updatedAt))
      || !/^[A-Za-z0-9_-]{1,128}$/u.test(String(decoded.id || ""))
    ) {
      throw new Error("invalid cursor");
    }
    return { updatedAt: decoded.updatedAt, id: decoded.id };
  } catch {
    throw new HttpError(400, "This patient search page expired. Search again.");
  }
}

function filter(fieldPath, op, value) {
  return { fieldFilter: { field: { fieldPath }, op, value } };
}

export function patientSearchQuery(
  env,
  { token, pageSize, cursor, doctorKey = "", archivedOnly = false },
) {
  const filters = [
    filter("searchPrefixes", "ARRAY_CONTAINS", { stringValue: token }),
    filter("archived", "EQUAL", { booleanValue: archivedOnly === true }),
  ];
  if (doctorKey) {
    filters.push(filter("searchDoctorKey", "EQUAL", { stringValue: doctorKey }));
  }
  const structuredQuery = {
    from: [{ collectionId: "patients" }],
    where: { compositeFilter: { op: "AND", filters } },
    orderBy: [
      { field: { fieldPath: "updatedAt" }, direction: "DESCENDING" },
      { field: { fieldPath: "__name__" }, direction: "DESCENDING" },
    ],
    select: { fields: SEARCH_FIELD_MASK.map((fieldPath) => ({ fieldPath })) },
    limit: pageSize + 1,
  };
  if (cursor) {
    structuredQuery.startAt = {
      before: false,
      values: [
        { timestampValue: cursor.updatedAt },
        { referenceValue: documentName(env, `patients/${cursor.id}`) },
      ],
    };
  }
  return structuredQuery;
}

function projectSearchPatient(patient, includeArchiveMetadata = false) {
  const result = {
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
  if (!includeArchiveMetadata) return result;
  return {
    ...result,
    archived: patient.archived === true,
    archivedAt: String(patient.archivedAt || ""),
    archivedBy: String(patient.archivedBy || ""),
    archiveReason: String(patient.archiveReason || ""),
  };
}

export function projectPatientSearchResults(
  documents,
  { doctorName = "", archivedOnly = false } = {},
) {
  return documents
    .filter((patient) => (
      (archivedOnly ? patient.archived === true : patient.archived !== true)
      && doctorMaySee(patient, doctorName)
    ))
    .map((patient) => projectSearchPatient(patient, archivedOnly));
}

function doctorMaySee(patient, doctorName) {
  if (!doctorName) return true;
  const doctorId = DOCTOR_IDS.get(doctorName) || "";
  return patient.doctorName
    ? patient.doctorName === doctorName
    : Boolean(doctorId && patient.doctorId === doctorId);
}

export function patientSearchStaffScope(staff, staffRecord, { archivedOnly = false } = {}) {
  const currentRole = String(staffRecord?.role || "");
  if (
    !staffRecord
    || staffRecord.active !== true
    || !["admin", "doctor", "reception"].includes(currentRole)
  ) {
    throw new HttpError(403, "This staff account is no longer active.");
  }
  const doctorName = currentRole === "doctor"
    ? String(staffRecord.doctorName || "").trim()
    : "";
  if (currentRole === "doctor" && !DOCTOR_IDS.has(doctorName)) {
    throw new HttpError(403, "This doctor login is not linked to a clinic doctor.");
  }
  if (archivedOnly && currentRole !== "admin") {
    throw new HttpError(403, "Only clinic administrators can search archived patient records.");
  }
  return { ...staff, role: currentRole, doctorName };
}

async function runQuery(env, structuredQuery) {
  const accessToken = await serviceAccountAccessToken(env);
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ structuredQuery }),
    },
  );
  const result = await response.json();
  if (!response.ok || !Array.isArray(result)) {
    const queryError = Array.isArray(result)
      ? result.find((row) => row?.error)?.error
      : result?.error;
    console.error("Patient search query failed", response.status, queryError?.status);
    throw new HttpError(503, "Patient search is temporarily unavailable. Please try again.");
  }
  return result.flatMap((row) => {
    if (!row?.document?.name) return [];
    return [{
      id: documentId(row.document.name),
      ...decodeFields(row.document.fields || {}),
    }];
  });
}

export async function searchPatientsForStaff(
  env,
  staff,
  {
    search,
    cursor: encodedCursor = "",
    pageSize: requestedPageSize = 10,
    archivedOnly = false,
  } = {},
) {
  const staffRecord = await getDocument(env, `staff/${staff.uid}`);
  const scope = patientSearchStaffScope(staff, staffRecord?.data, { archivedOnly });
  const currentRole = scope.role;
  const doctorName = scope.doctorName;

  const token = patientSearchToken(search);
  if (!token) {
    throw new HttpError(400, "Enter at least 3 letters or 6 mobile-number digits.");
  }
  const doctorKey = currentRole === "doctor"
    ? patientSearchDoctorKey({ doctorName })
    : "";
  const queryKey = archivedOnly
    ? `${token}|all|archived`
    : `${token}|${doctorKey || "all"}`;
  const parsedPageSize = Number(requestedPageSize);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(parsedPageSize) ? Math.trunc(parsedPageSize) : 10),
  );
  const cursor = decodePatientSearchCursor(encodedCursor, queryKey);
  const documents = await runQuery(
    env,
    patientSearchQuery(env, { token, pageSize, cursor, doctorKey, archivedOnly }),
  );
  // Doctor filtering is applied after the bounded indexed query so legacy
  // charts that only store doctorId remain discoverable. Returning at most 26
  // candidate documents keeps that compatibility path tightly bounded.
  const rawPage = documents.slice(0, pageSize);
  // The canonical key is the database scope. This second check is
  // defense-in-depth against malformed legacy assignments.
  const visible = rawPage
    .filter((patient) => (
      (archivedOnly ? patient.archived === true : patient.archived !== true)
      && doctorMaySee(patient, doctorName)
    ));
  let legacyFallbackUsed = false;
  let legacyBackfillRequired = false;
  if (!cursor && visible.length === 0) {
    const legacy = await legacyPatientSearchForStaff(
      env,
      { ...staff, role: currentRole },
      staffRecord.data,
      token,
      pageSize,
      { archivedOnly },
    );
    if (legacy.patients.length > 0) {
      return {
        patients: legacy.patients,
        nextCursor: "",
        hasMore: false,
        legacyFallbackUsed: true,
        legacyBackfillRequired: true,
      };
    }
    legacyFallbackUsed = !legacy.scanSkipped;
    legacyBackfillRequired = legacy.scanSkipped;
  }
  const hasMore = documents.length > pageSize;
  const last = hasMore ? rawPage.at(-1) : null;
  const nextCursor = last?.updatedAt
    ? encodePatientSearchCursor({ queryKey, updatedAt: last.updatedAt, id: last.id })
    : "";

  return {
    patients: projectPatientSearchResults(visible, { doctorName, archivedOnly }),
    nextCursor,
    hasMore: Boolean(nextCursor),
    legacyFallbackUsed,
    legacyBackfillRequired,
  };
}
