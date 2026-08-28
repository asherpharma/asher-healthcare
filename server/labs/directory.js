import {
  MAX_PATIENT_RESOLVER_IDS,
  resolvePatientDirectoryEntriesForStaff,
} from "../patients/directory.js";
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
  const safePatients = Array.isArray(activePatients) ? activePatients : [];
  const patientsById = new Map(
    safePatients.map((patient) => [safeString(patient.id), patient]),
  );
  const role = safeString(staff?.role);
  const doctorName = role === "doctor" ? safeString(staff?.doctorName) : "";
  const includeClinical = role === "admin" || role === "doctor";

  return documents.flatMap((order) => {
    const patientId = safeString(order.patientId);
    const patient = patientsById.get(patientId);
    if (!patientId || !patient) return [];
    // Patient assignment alone is insufficient: a chart can contain orders
    // authored by different clinicians over time. Doctors receive only orders
    // whose stored clinician is the exact canonical doctor on their current
    // staff record, so another clinician's notes never enter the response.
    if (
      role === "doctor"
      && (!doctorName || safeString(order.clinician) !== doctorName)
    ) return [];

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

export function labOrderPatientIdBatches(documents) {
  const safeDocuments = Array.isArray(documents) ? documents : [];
  const patientIds = [...new Set(
    safeDocuments
      .map((order) => safeString(order?.patientId).trim())
      .filter(Boolean),
  )];

  return Array.from(
    { length: Math.ceil(patientIds.length / MAX_PATIENT_RESOLVER_IDS) },
    (_, index) => patientIds.slice(
      index * MAX_PATIENT_RESOLVER_IDS,
      (index + 1) * MAX_PATIENT_RESOLVER_IDS,
    ),
  );
}

export async function resolveLabOrderPatientsForStaff(
  env,
  staff,
  documents,
  dependencies = {},
) {
  const resolvePatients = dependencies.resolvePatientDirectoryEntriesForStaff
    || resolvePatientDirectoryEntriesForStaff;
  const patients = [];

  // Keep exact chart reads bounded. Running the batches sequentially also
  // avoids a 300-order window turning into hundreds of simultaneous Firestore
  // reads while still resolving every patient referenced by that window.
  for (const patientIds of labOrderPatientIdBatches(documents)) {
    const result = await resolvePatients(
      env,
      staff,
      { patientIds },
      dependencies,
    );
    if (Array.isArray(result?.patients)) patients.push(...result.patients);
  }

  return patients;
}

export async function labOrderDirectoryForStaff(env, staff, dependencies = {}) {
  assertLabDirectoryStaff(staff);

  const listLabOrders = dependencies.listMaskedLabOrderDocuments
    || listMaskedLabOrderDocuments;
  const window = await listLabOrders(env);
  // Resolve only the exact charts referenced by the already-bounded order
  // window. The resolver revalidates the current staff record and excludes
  // archived or doctor-out-of-scope charts without enumerating a first page.
  const activePatients = await resolveLabOrderPatientsForStaff(
    env,
    staff,
    window.documents,
    dependencies,
  );
  return {
    labOrders: projectLabOrderDirectory(window.documents, activePatients, staff),
    truncated: window.truncated,
    limit: window.limit,
  };
}
