import {
  commitWrites,
  createDocumentWrite,
  serviceAccountAccessToken,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import {
  createPatientSearchPrefixes,
  patientSearchDoctorKey,
} from "./search-index.js";

const BACKFILL_PAGE_SIZE = 100;
const BACKFILL_FIELD_MASK = [
  "patientNumber",
  "fullName",
  "phone",
  "doctorId",
  "doctorName",
  "searchPrefixes",
  "searchDoctorKey",
  "archived",
  "createdAt",
  "updatedAt",
];

function decodeValue(value = {}) {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
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

function patientsPageUrl(env, pageToken) {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/patients`,
  );
  url.searchParams.set("pageSize", String(BACKFILL_PAGE_SIZE));
  BACKFILL_FIELD_MASK.forEach((fieldPath) => url.searchParams.append("mask.fieldPaths", fieldPath));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url;
}

export function planPatientSearchBackfill(documents) {
  return documents.flatMap((patient) => {
    const updates = {};
    const expected = createPatientSearchPrefixes(patient.data);
    const current = Array.isArray(patient.data.searchPrefixes)
      ? patient.data.searchPrefixes
      : [];
    if (!(expected.length === current.length && expected.every((value, index) => value === current[index]))) {
      updates.searchPrefixes = expected;
    }
    const searchDoctorKey = patientSearchDoctorKey(patient.data);
    if (patient.data.searchDoctorKey !== searchDoctorKey) {
      updates.searchDoctorKey = searchDoctorKey;
    }
    if (patient.data.archived !== true && patient.data.archived !== false) {
      updates.archived = false;
    }
    if (
      patient.updatedAtWasTimestamp !== true
      || typeof patient.data.updatedAt !== "string"
      || Number.isNaN(Date.parse(patient.data.updatedAt))
    ) {
      const deterministicTimestamp = (
        typeof patient.data.createdAt === "string"
        && !Number.isNaN(Date.parse(patient.data.createdAt))
      ) ? patient.data.createdAt : patient.updateTime;
      updates.updatedAt = new Date(deterministicTimestamp);
    }
    return Object.keys(updates).length > 0
      ? [{ ...patient, updates, fieldPaths: Object.keys(updates) }]
      : [];
  });
}

export function patientSearchBackfillWrites(
  env,
  administrator,
  planned,
  { scannedCount, complete, now = new Date(), auditId = crypto.randomUUID() },
) {
  return [
    verifyDocumentWrite(
      env,
      `staff/${administrator.uid}`,
      administrator.staffUpdateTime,
    ),
    ...planned.map((patient) => updateDocumentWrite(
      env,
      `patients/${patient.id}`,
      patient.updates,
      patient.fieldPaths,
      patient.updateTime,
    )),
    createDocumentWrite(env, `auditLogs/${auditId}`, {
      eventType: "patients.search_index_backfilled",
      category: "system_migration",
      indexedCount: planned.length,
      scannedCount,
      complete,
      actorUid: administrator.uid,
      actorName: administrator.displayName,
      actorRole: administrator.role,
      createdAt: now,
    }),
  ];
}

async function readPatientPage(env, pageToken) {
  const accessToken = await serviceAccountAccessToken(env);
  const response = await fetch(patientsPageUrl(env, pageToken), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json();
  if (!response.ok) {
    console.error("Patient search backfill read failed", response.status, result?.error?.status);
    throw new HttpError(503, "The patient search upgrade could not read this batch.");
  }
  return {
    documents: (result.documents || []).map((document) => ({
      id: documentId(document.name),
      data: decodeFields(document.fields || {}),
      updatedAtWasTimestamp: Boolean(document.fields?.updatedAt?.timestampValue),
      updateTime: document.updateTime,
    })),
    nextPageToken: String(result.nextPageToken || ""),
  };
}

export async function backfillPatientSearchBatch(env, administrator, pageToken = "") {
  if (pageToken.length > 4_096) throw new HttpError(400, "Restart the patient search upgrade.");
  const page = await readPatientPage(env, pageToken);
  const planned = planPatientSearchBackfill(page.documents);
  const now = new Date();
  const writes = patientSearchBackfillWrites(env, administrator, planned, {
    scannedCount: page.documents.length,
    complete: !page.nextPageToken,
    now,
  });
  // Every continuation token is audited, including zero-change batches.
  await commitWrites(env, writes);
  return {
    scannedCount: page.documents.length,
    indexedCount: planned.length,
    nextPageToken: page.nextPageToken,
    complete: !page.nextPageToken,
  };
}
