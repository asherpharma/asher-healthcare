import {
  MAX_PATIENT_RESOLVER_IDS,
  resolvePatientDirectoryEntriesForStaff,
} from "../patients/directory.js";
import {
  documentName,
  getDocument,
  serviceAccountAccessToken,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";

const DIRECTORY_LIMIT = 300;
const DIRECTORY_QUERY_LIMIT = DIRECTORY_LIMIT + 1;
export const URGENT_DOCTOR_LAB_LIMIT = 20;
export const DOCTOR_URGENT_LAB_DEFAULT_PAGE_SIZE = 25;
export const DOCTOR_URGENT_LAB_MAX_PAGE_SIZE = 50;

const ACTIVE_LAB_STATUSES = ["ordered", "collected", "processing"];
const DOCTOR_IDS = new Map([
  ["Dr. Lt Col Shafi Ahamad", "pediatrics"],
  ["Dr. Shaik Reshma", "obg"],
]);

export const URGENT_DOCTOR_LAB_FIELDS = [
  "orderNumber",
  "patientId",
  "tests",
  "priority",
  "clinician",
  "status",
  "orderedAt",
];

export const DOCTOR_URGENT_LAB_DESK_FIELDS = [
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
  "notes",
  "resultSummary",
  "reportStoragePath",
];

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

export function normalizeDoctorUrgentLabPageSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DOCTOR_URGENT_LAB_DEFAULT_PAGE_SIZE;
  return Math.min(
    DOCTOR_URGENT_LAB_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(parsed)),
  );
}

function doctorUrgentLabQueryKey(doctorName) {
  return `doctor-urgent-active:v1:${doctorName}`;
}

export function encodeDoctorUrgentLabCursor({ queryKey, orderedAt, id }) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    v: 1,
    queryKey,
    orderedAt,
    id,
  })));
}

export function decodeDoctorUrgentLabCursor(value, expectedQueryKey) {
  if (!value) return null;
  const encoded = String(value).trim();
  try {
    if (
      encoded.length > 2_048
      || !/^[A-Za-z0-9_-]+$/u.test(encoded)
    ) throw new Error("invalid cursor");
    const decoded = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encoded)),
    );
    if (
      decoded?.v !== 1
      || decoded.queryKey !== expectedQueryKey
      || typeof decoded.orderedAt !== "string"
      || Number.isNaN(Date.parse(decoded.orderedAt))
      || !validDocumentId(String(decoded.id || ""))
    ) throw new Error("invalid cursor");
    return { orderedAt: decoded.orderedAt, id: decoded.id };
  } catch {
    throw new HttpError(400, "This urgent lab page expired. Start again.");
  }
}

function urgentDoctorFilters(doctorName) {
  return [
    {
      fieldFilter: {
        field: { fieldPath: "clinician" },
        op: "EQUAL",
        value: { stringValue: doctorName },
      },
    },
    {
      fieldFilter: {
        field: { fieldPath: "priority" },
        op: "EQUAL",
        value: { stringValue: "urgent" },
      },
    },
    {
      fieldFilter: {
        field: { fieldPath: "status" },
        op: "IN",
        value: {
          arrayValue: {
            values: ACTIVE_LAB_STATUSES.map((status) => ({ stringValue: status })),
          },
        },
      },
    },
  ];
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

export function urgentDoctorLabOrderQuery(doctorName) {
  return {
    from: [{ collectionId: "labOrders" }],
    where: {
      compositeFilter: {
        op: "AND",
        filters: urgentDoctorFilters(doctorName),
      },
    },
    orderBy: [{
      field: { fieldPath: "orderedAt" },
      direction: "DESCENDING",
    }],
    select: {
      fields: URGENT_DOCTOR_LAB_FIELDS.map((fieldPath) => ({ fieldPath })),
    },
    limit: URGENT_DOCTOR_LAB_LIMIT,
  };
}

export function doctorUrgentLabDirectoryQuery(
  env,
  doctorName,
  { pageSize = DOCTOR_URGENT_LAB_DEFAULT_PAGE_SIZE, cursor = null } = {},
) {
  const boundedPageSize = normalizeDoctorUrgentLabPageSize(pageSize);
  const structuredQuery = {
    from: [{ collectionId: "labOrders" }],
    where: {
      compositeFilter: {
        op: "AND",
        filters: urgentDoctorFilters(doctorName),
      },
    },
    orderBy: [
      {
        field: { fieldPath: "orderedAt" },
        direction: "DESCENDING",
      },
      {
        field: { fieldPath: "__name__" },
        direction: "DESCENDING",
      },
    ],
    select: {
      fields: DOCTOR_URGENT_LAB_DESK_FIELDS.map((fieldPath) => ({ fieldPath })),
    },
    limit: boundedPageSize + 1,
  };
  if (cursor) {
    structuredQuery.startAt = {
      before: false,
      values: [
        { timestampValue: cursor.orderedAt },
        { referenceValue: documentName(env, `labOrders/${cursor.id}`) },
      ],
    };
  }
  return structuredQuery;
}

export function boundedLabOrderDirectory(documents) {
  const safeDocuments = Array.isArray(documents) ? documents : [];
  return {
    documents: safeDocuments.slice(0, DIRECTORY_LIMIT),
    truncated: safeDocuments.length > DIRECTORY_LIMIT,
    limit: DIRECTORY_LIMIT,
  };
}

export function boundedUrgentDoctorLabDirectory(documents) {
  const safeDocuments = Array.isArray(documents) ? documents : [];
  return {
    documents: safeDocuments.slice(0, URGENT_DOCTOR_LAB_LIMIT),
    // A query capped at the response limit cannot prove that an exactly-full
    // page is complete. Mark it partial rather than presenting a false all-clear.
    truncated: safeDocuments.length >= URGENT_DOCTOR_LAB_LIMIT,
    limit: URGENT_DOCTOR_LAB_LIMIT,
  };
}

export function boundedDoctorUrgentLabPage(
  documents,
  { pageSize = DOCTOR_URGENT_LAB_DEFAULT_PAGE_SIZE, queryKey } = {},
) {
  const boundedPageSize = normalizeDoctorUrgentLabPageSize(pageSize);
  const safeDocuments = Array.isArray(documents) ? documents : [];
  const page = safeDocuments.slice(0, boundedPageSize);
  const hasMore = safeDocuments.length > boundedPageSize;
  if (!hasMore) {
    return {
      documents: page,
      nextCursor: "",
      hasMore: false,
      pageSize: boundedPageSize,
    };
  }

  const last = page.at(-1);
  if (
    typeof queryKey !== "string"
    || !queryKey
    || typeof last?.orderedAt !== "string"
    || Number.isNaN(Date.parse(last.orderedAt))
    || !validDocumentId(safeString(last.id))
  ) {
    throw new HttpError(503, "The secure urgent lab directory could not continue.");
  }
  return {
    documents: page,
    nextCursor: encodeDoctorUrgentLabCursor({
      queryKey,
      orderedAt: last.orderedAt,
      id: last.id,
    }),
    hasMore: true,
    pageSize: boundedPageSize,
  };
}

async function runLabOrderQuery(env, structuredQuery) {
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
    console.error("Lab order directory REST error", response.status, queryError?.status);
    throw new HttpError(503, "The secure lab order directory could not be loaded.");
  }

  return result.flatMap((row) => {
    if (!row?.document?.name) return [];
    return [{
      id: documentId(row.document.name),
      ...decodeFields(row.document.fields || {}),
    }];
  });
}

async function listMaskedLabOrderDocuments(env) {
  return boundedLabOrderDirectory(
    await runLabOrderQuery(env, labOrderDirectoryQuery()),
  );
}

async function listUrgentDoctorLabOrderDocuments(env, staff) {
  return boundedUrgentDoctorLabDirectory(
    await runLabOrderQuery(env, urgentDoctorLabOrderQuery(staff.doctorName)),
  );
}

async function listDoctorUrgentLabOrderDocuments(
  env,
  staff,
  { pageSize, cursor },
) {
  return runLabOrderQuery(
    env,
    doctorUrgentLabDirectoryQuery(env, staff.doctorName, { pageSize, cursor }),
  );
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

export function assertUrgentDoctorLabStaff(staff) {
  if (
    !staff
    || staff.role !== "doctor"
    || !DOCTOR_IDS.has(safeString(staff.doctorName).trim())
  ) {
    throw new HttpError(
      403,
      "This doctor login is not linked to a clinic doctor.",
    );
  }
  return staff;
}

function validDocumentId(value) {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

export async function resolveUrgentDoctorLabPatientsForStaff(
  env,
  staff,
  documents,
  dependencies = {},
  {
    maximum = URGENT_DOCTOR_LAB_LIMIT,
    includeContact = false,
  } = {},
) {
  assertUrgentDoctorLabStaff(staff);
  const readDocument = dependencies.getDocument || getDocument;
  const doctorName = safeString(staff.doctorName).trim();
  const doctorId = DOCTOR_IDS.get(doctorName) || "";
  const boundedMaximum = Math.min(
    DOCTOR_URGENT_LAB_MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(Number(maximum))
      ? Math.trunc(Number(maximum))
      : URGENT_DOCTOR_LAB_LIMIT),
  );
  const patientIds = [...new Set(
    (Array.isArray(documents) ? documents : [])
      .slice(0, boundedMaximum)
      .map((order) => safeString(order?.patientId).trim())
      .filter((patientId) => validDocumentId(patientId)),
  )];

  // The caller has already authenticated and loaded the current staff record.
  // Read only the exact charts referenced by the bounded urgent query; do not
  // re-read staff or enumerate the clinic patient directory.
  const patientDocuments = await Promise.all(
    patientIds.map(async (patientId) => ({
      id: patientId,
      document: await readDocument(env, `patients/${patientId}`),
    })),
  );

  return patientDocuments.flatMap(({ id, document }) => {
    const patient = document?.data;
    if (!patient || patient.archived === true) return [];
    const assigned = patient.doctorName
      ? safeString(patient.doctorName).trim() === doctorName
      : Boolean(doctorId && safeString(patient.doctorId).trim() === doctorId);
    if (!assigned) return [];
    const entry = {
      id,
      fullName: safeString(patient.fullName, "Patient"),
    };
    if (!includeContact) return [entry];
    return [{
      ...entry,
      patientNumber: safeString(patient.patientNumber),
      phone: safeString(patient.phone),
    }];
  });
}

export function projectUrgentDoctorLabDirectory(documents, activePatients, staff) {
  assertUrgentDoctorLabStaff(staff);
  const doctorName = safeString(staff.doctorName).trim();
  const patientsById = new Map(
    (Array.isArray(activePatients) ? activePatients : [])
      .map((patient) => [safeString(patient.id), patient]),
  );

  return (Array.isArray(documents) ? documents : []).flatMap((order) => {
    const patientId = safeString(order?.patientId).trim();
    const patient = patientsById.get(patientId);
    if (
      !patient
      || safeString(order?.clinician).trim() !== doctorName
      || safeString(order?.priority).trim() !== "urgent"
      || !ACTIVE_LAB_STATUSES.includes(safeString(order?.status).trim())
    ) return [];

    return [{
      id: safeString(order.id),
      orderNumber: safeString(order.orderNumber),
      patientName: safeString(patient.fullName, "Patient"),
      tests: safeTests(order.tests),
      priority: "urgent",
      clinician: doctorName,
      status: safeString(order.status),
    }];
  });
}

export function projectDoctorUrgentLabDeskDirectory(
  documents,
  activePatients,
  staff,
) {
  assertUrgentDoctorLabStaff(staff);
  const doctorName = safeString(staff.doctorName).trim();
  const scopedDocuments = (Array.isArray(documents) ? documents : [])
    .filter((order) => (
      safeString(order?.clinician).trim() === doctorName
      && safeString(order?.priority).trim() === "urgent"
      && ACTIVE_LAB_STATUSES.includes(safeString(order?.status).trim())
    ));

  return projectLabOrderDirectory(scopedDocuments, activePatients, staff)
    .map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      patientId: order.patientId,
      patientNumber: order.patientNumber,
      patientName: order.patientName,
      patientPhone: order.patientPhone,
      tests: order.tests,
      priority: order.priority,
      clinician: order.clinician,
      status: order.status,
      orderedAt: order.orderedAt,
      completedAt: order.completedAt,
      reportAttached: order.reportAttached,
      notes: safeString(order.notes),
      resultSummary: safeString(order.resultSummary),
    }));
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

export async function urgentDoctorLabDirectoryForStaff(env, staff, dependencies = {}) {
  assertUrgentDoctorLabStaff(staff);
  const listLabOrders = dependencies.listUrgentDoctorLabOrderDocuments
    || listUrgentDoctorLabOrderDocuments;
  const window = await listLabOrders(env, staff);
  const activePatients = await resolveUrgentDoctorLabPatientsForStaff(
    env,
    staff,
    window.documents,
    dependencies,
  );
  return {
    labOrders: projectUrgentDoctorLabDirectory(
      window.documents,
      activePatients,
      staff,
    ),
    truncated: window.truncated,
    limit: window.limit,
  };
}

export async function doctorUrgentLabDirectoryPageForStaff(
  env,
  staff,
  {
    cursor: encodedCursor = "",
    pageSize: requestedPageSize = DOCTOR_URGENT_LAB_DEFAULT_PAGE_SIZE,
  } = {},
  dependencies = {},
) {
  assertUrgentDoctorLabStaff(staff);
  const doctorName = safeString(staff.doctorName).trim();
  const pageSize = normalizeDoctorUrgentLabPageSize(requestedPageSize);
  const queryKey = doctorUrgentLabQueryKey(doctorName);
  const cursor = decodeDoctorUrgentLabCursor(encodedCursor, queryKey);
  const listLabOrders = dependencies.listDoctorUrgentLabOrderDocuments
    || listDoctorUrgentLabOrderDocuments;
  const documents = await listLabOrders(env, staff, { pageSize, cursor });
  const window = boundedDoctorUrgentLabPage(documents, { pageSize, queryKey });
  const activePatients = await resolveUrgentDoctorLabPatientsForStaff(
    env,
    staff,
    window.documents,
    dependencies,
    { maximum: pageSize, includeContact: true },
  );

  return {
    labOrders: projectDoctorUrgentLabDeskDirectory(
      window.documents,
      activePatients,
      staff,
    ),
    nextCursor: window.nextCursor,
    hasMore: window.hasMore,
    pageSize: window.pageSize,
  };
}
