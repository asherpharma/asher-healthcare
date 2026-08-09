import { patientDirectoryForStaff } from "../patients/directory.js";
import { serviceAccountAccessToken } from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";

const DIRECTORY_LIMIT = 300;
const DIRECTORY_QUERY_LIMIT = DIRECTORY_LIMIT + 1;

export const LAB_ORDER_DIRECTORY_FIELDS = [
  "orderNumber",
  "patientId",
  "patientNumber",
  "patientName",
  "patientPhone",
  "tests",
  "priority",
  "clinician",
  "status",
  "orderedAt",
  "completedAt",
  "updatedAt",
];

// These fields are fetched only by the trusted server. Reception receives a
// strictly operational projection; clinical text and object metadata are
// returned only to an administrator or the patient's currently assigned
// doctor.
const SERVER_ONLY_FIELDS = [
  "notes",
  "resultSummary",
  "reportStoragePath",
];

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

export function labOrderDirectoryQuery() {
  return {
    from: [{ collectionId: "labOrders" }],
    orderBy: [{
      field: { fieldPath: "orderedAt" },
      direction: "DESCENDING",
    }],
    select: {
      fields: [...LAB_ORDER_DIRECTORY_FIELDS, ...SERVER_ONLY_FIELDS]
        .map((fieldPath) => ({ fieldPath })),
    },
    // Fetch one extra document so the response can safely disclose that the
    // operational window is truncated without exposing any additional order.
    limit: DIRECTORY_QUERY_LIMIT,
  };
}

export function boundedLabOrderDirectory(documents) {
  const safeDocuments = Array.isArray(documents) ? documents : [];
  return {
    documents: safeDocuments.slice(0, DIRECTORY_LIMIT),
    truncated: safeDocuments.length > DIRECTORY_LIMIT,
    limit: DIRECTORY_LIMIT,
  };
}

async function listMaskedLabOrderDocuments(env) {
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
      body: JSON.stringify({ structuredQuery: labOrderDirectoryQuery() }),
    },
  );
  const result = await response.json();
  if (!response.ok || !Array.isArray(result)) {
    const queryError = Array.isArray(result)
      ? result.find((row) => row?.error)?.error
      : result?.error;
    console.error("Lab order directory REST error", response.status, queryError?.status);
    throw new HttpError(503, "The secure lab order directory could not be loaded.");
  }

  return boundedLabOrderDirectory(result.flatMap((row) => {
    if (!row?.document?.name) return [];
    return [{
      id: documentId(row.document.name),
      ...decodeFields(row.document.fields || {}),
    }];
  }));
}

function safeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function safeTests(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function assertLabDirectoryStaff(staff) {
  if (!staff || !["admin", "doctor", "reception"].includes(staff.role)) {
    throw new HttpError(
      403,
      "Only active clinic staff can open the lab order directory.",
    );
  }
  return staff;
}

export function projectLabOrderDirectory(
  documents,
  activePatients,
  staff = { role: "reception" },
) {
  const patientsById = new Map(
    activePatients.map((patient) => [safeString(patient.id), patient]),
  );
  const includeClinical = staff.role === "admin" || staff.role === "doctor";

  return documents.flatMap((order) => {
    const patientId = safeString(order.patientId);
    const patient = patientsById.get(patientId);
    if (!patientId || !patient) return [];

    const operational = {
      id: safeString(order.id),
      orderNumber: safeString(order.orderNumber),
      patientId,
      patientNumber: safeString(patient.patientNumber, safeString(order.patientNumber)),
      patientName: safeString(patient.fullName, safeString(order.patientName, "Patient")),
      patientPhone: safeString(patient.phone, safeString(order.patientPhone)),
      tests: safeTests(order.tests),
      priority: safeString(order.priority),
      clinician: safeString(order.clinician),
      status: safeString(order.status),
      orderedAt: safeString(order.orderedAt),
      completedAt: safeString(order.completedAt),
      updatedAt: safeString(order.updatedAt),
      reportAttached: typeof order.reportStoragePath === "string"
        && order.reportStoragePath.trim().length > 0,
    };

    if (!includeClinical) return [operational];
    return [{
      ...operational,
      notes: safeString(order.notes),
      resultSummary: safeString(order.resultSummary),
    }];
  });
}

export async function labOrderDirectoryForStaff(env, staff) {
  assertLabDirectoryStaff(staff);

  // The operational patient directory excludes archived charts. Joining on
  // that server-owned view prevents stale or archived patient orders from
  // reaching reception without exposing any clinical patient fields.
  const activePatients = await patientDirectoryForStaff(env, staff);
  const window = await listMaskedLabOrderDocuments(env);
  return {
    labOrders: projectLabOrderDirectory(window.documents, activePatients, staff),
    truncated: window.truncated,
    limit: window.limit,
  };
}
