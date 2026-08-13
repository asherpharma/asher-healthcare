import { HttpError } from "../razorpay/http.js";
import {
  commitWrites,
  createDocumentWrite,
  documentName,
  getDocument,
  serviceAccountAccessToken,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";

const DOCTORS = ["Dr. Lt Col Shafi Ahamad", "Dr. Shaik Reshma"];
export const CONSULTATION_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MEDICINE_KEYS = ["name", "dose", "frequency", "duration", "instructions"];
const DRAFT_REQUEST_KEYS = ["patientId", "appointmentId", "doctorName", "fields", "medicines", "labTests"];
const STORED_DRAFT_KEYS = [
  "schemaVersion",
  "patientId",
  "appointmentKey",
  "doctorName",
  "ownerUid",
  "ownerName",
  "fields",
  "medicines",
  "labTests",
  "createdAt",
  "updatedAt",
  "expiresAt",
];
const FIELD_LIMITS = {
  temperature: 30,
  pulse: 30,
  bloodPressure: 30,
  spo2: 30,
  weight: 30,
  chiefComplaint: 2000,
  examinationFindings: 3000,
  diagnosis: 2000,
  treatment: 3000,
  clinicalNotes: 3000,
  advice: 3000,
  labPriority: 10,
  labNotes: 1000,
  followUpDate: 10,
  followUpTime: 5,
  followUpPriority: 10,
};

const defaultDatabase = {
  completedConsultationAfterDraft,
  commitWrites,
  createDocumentWrite,
  documentName,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
};

async function completedConsultationAfterDraft(env, {
  patientId,
  appointmentId,
  ownerUid,
  updatedAt,
}) {
  const accessToken = await serviceAccountAccessToken(env);
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const patient = encodeURIComponent(patientId);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/patients/${patient}:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "visits" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "createdAt" },
              op: "GREATER_THAN_OR_EQUAL",
              value: { timestampValue: updatedAt },
            },
          },
          select: {
            fields: [
              { fieldPath: "appointmentId" },
              { fieldPath: "createdBy" },
              { fieldPath: "status" },
            ],
          },
          limit: 500,
        },
      }),
    },
  );
  const result = await response.json();
  if (!response.ok || !Array.isArray(result)) {
    console.error("Consultation draft completion query failed", response.status, result?.error?.status);
    throw new HttpError(503, "The secure consultation history could not be checked.");
  }
  return result.some((row) => {
    const fields = row?.document?.fields;
    return fields?.appointmentId?.stringValue === appointmentId
      && fields?.createdBy?.stringValue === ownerUid
      && fields?.status?.stringValue === "completed";
  });
}

function text(value, limit, label) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new HttpError(400, `${label} must be text.`);
  }
  const result = (value ?? "").trim();
  if (result.length > limit) throw new HttpError(400, `${label} is too long.`);
  return result;
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function storedDate(value, label) {
  if (typeof value !== "string") throw new HttpError(409, `This draft has an invalid ${label}.`);
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new HttpError(409, `This draft has an invalid ${label}.`);
  return result;
}

export function consultationDraftKey(uid, appointmentId) {
  if (appointmentId !== undefined && appointmentId !== null && typeof appointmentId !== "string") {
    throw new HttpError(400, "Choose a valid consultation appointment.");
  }
  const appointmentKey = (appointmentId || "walkin").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(appointmentKey)) {
    throw new HttpError(400, "Choose a valid consultation appointment.");
  }
  return { appointmentKey, id: `${uid}--${appointmentKey}` };
}

export function validateConsultationDraft(body, actor, patientId, now = new Date()) {
  if (
    !plainObject(body)
    || !DRAFT_REQUEST_KEYS.every((key) => Object.hasOwn(body, key))
    || !hasOnlyKeys(body, DRAFT_REQUEST_KEYS)
    || body.patientId !== patientId
    || Number.isNaN(now.getTime())
  ) {
    throw new HttpError(400, "Enter valid consultation draft details.");
  }
  const doctorName = text(body.doctorName, 100, "Doctor name");
  if (actor.role === "doctor" && doctorName !== actor.doctorName) {
    throw new HttpError(403, "This consultation is not assigned to your doctor account.");
  }
  if (doctorName && !DOCTORS.includes(doctorName)) {
    throw new HttpError(400, "Choose a valid consulting doctor.");
  }
  if (
    !plainObject(body.fields)
    || !Object.keys(FIELD_LIMITS).every((key) => Object.hasOwn(body.fields, key))
    || !hasOnlyKeys(body.fields, Object.keys(FIELD_LIMITS))
  ) {
    throw new HttpError(400, "Enter valid consultation draft fields.");
  }
  const fields = Object.fromEntries(Object.entries(FIELD_LIMITS).map(([key, limit]) => (
    [key, text(body.fields[key], limit, key)]
  )));
  if (!["", "routine", "urgent"].includes(fields.labPriority)) throw new HttpError(400, "Choose a valid lab priority.");
  if (!["", "low", "medium", "high", "urgent"].includes(fields.followUpPriority)) throw new HttpError(400, "Choose a valid follow-up priority.");

  if (!Array.isArray(body.medicines)) throw new HttpError(400, "Enter valid medicine draft details.");
  const medicines = body.medicines;
  if (medicines.length > 20) throw new HttpError(400, "A draft supports up to 20 medicines.");
  const cleanMedicines = medicines.map((medicine) => {
    if (
      !plainObject(medicine)
      || !MEDICINE_KEYS.every((key) => Object.hasOwn(medicine, key))
      || !hasOnlyKeys(medicine, MEDICINE_KEYS)
    ) {
      throw new HttpError(400, "Enter valid medicine draft details.");
    }
    return {
      name: text(medicine.name, 200, "Medicine name"),
      dose: text(medicine.dose, 100, "Medicine dose"),
      frequency: text(medicine.frequency, 100, "Medicine frequency"),
      duration: text(medicine.duration, 100, "Medicine duration"),
      instructions: text(medicine.instructions, 300, "Medicine instructions"),
    };
  });

  if (!Array.isArray(body.labTests)) throw new HttpError(400, "Enter valid lab test draft details.");
  const labTests = body.labTests;
  if (labTests.length > 20) throw new HttpError(400, "A draft supports up to 20 lab tests.");

  return {
    schemaVersion: 1,
    patientId,
    appointmentKey: consultationDraftKey(actor.uid, body.appointmentId).appointmentKey,
    doctorName,
    ownerUid: actor.uid,
    ownerName: text(actor.displayName || actor.email || "Clinic staff", 100, "Staff name"),
    fields,
    medicines: cleanMedicines,
    labTests: labTests.map((test) => text(test, 160, "Lab test")),
    updatedAt: now,
    expiresAt: new Date(now.getTime() + CONSULTATION_DRAFT_TTL_MS),
  };
}

export function validateStoredConsultationDraft(data, actor, patientId, appointmentId) {
  if (
    !plainObject(data)
    || !STORED_DRAFT_KEYS.every((key) => Object.hasOwn(data, key))
    || !hasOnlyKeys(data, STORED_DRAFT_KEYS)
  ) {
    throw new HttpError(409, "This draft has an invalid secure record format.");
  }
  const { appointmentKey } = consultationDraftKey(actor.uid, appointmentId);
  if (
    data.schemaVersion !== 1
    || data.patientId !== patientId
    || data.appointmentKey !== appointmentKey
    || data.ownerUid !== actor.uid
  ) {
    throw new HttpError(409, "This draft does not match the selected consultation.");
  }
  text(data.ownerName, 100, "Staff name");

  const createdAt = storedDate(data.createdAt, "creation time");
  const updatedAt = storedDate(data.updatedAt, "update time");
  const expiresAt = storedDate(data.expiresAt, "expiry time");
  if (
    createdAt.getTime() > updatedAt.getTime()
    || expiresAt.getTime() !== updatedAt.getTime() + CONSULTATION_DRAFT_TTL_MS
  ) {
    throw new HttpError(409, "This draft has an invalid retention period.");
  }

  const validated = validateConsultationDraft({
    patientId,
    appointmentId,
    doctorName: data.doctorName,
    fields: data.fields,
    medicines: data.medicines,
    labTests: data.labTests,
  }, actor, patientId, updatedAt);

  return {
    doctorName: validated.doctorName,
    fields: validated.fields,
    medicines: validated.medicines,
    labTests: validated.labTests,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function actorCanAccessDraft(actor, patient) {
  if (actor.role === "admin") return true;
  return actor.role === "doctor" && actor.doctorName && (
    patient.doctorName === actor.doctorName
    || (!patient.doctorName && patient.doctorId === (actor.doctorName === DOCTORS[0] ? "pediatrics" : "obg"))
  );
}

function assertDraftAccess(actor, patientDocument) {
  if (!patientDocument || patientDocument.data?.archived === true) {
    throw new HttpError(409, "This patient chart is unavailable.");
  }
  if (!actorCanAccessDraft(actor, patientDocument.data)) {
    throw new HttpError(403, "This patient is not assigned to your account.");
  }
}

function draftPath(actor, patientId, appointmentId) {
  const { id } = consultationDraftKey(actor.uid, appointmentId);
  return `patients/${patientId}/consultationDrafts/${id}`;
}

function authorizationWrites(env, actor, patientId, patientDocument, database) {
  return [
    database.verifyDocumentWrite(env, `staff/${actor.uid}`, actor.staffUpdateTime),
    database.verifyDocumentWrite(env, `patients/${patientId}`, patientDocument.updateTime),
  ];
}

async function assertReadAuthorizationUnchanged(env, actor, patientId, patientDocument, database) {
  const [currentStaff, currentPatient] = await Promise.all([
    database.getDocument(env, `staff/${actor.uid}`),
    database.getDocument(env, `patients/${patientId}`),
  ]);
  if (
    !currentStaff
    || currentStaff.updateTime !== actor.staffUpdateTime
    || currentStaff.data?.active !== true
    || currentStaff.data?.role !== actor.role
    || (actor.role === "doctor" && currentStaff.data?.doctorName !== actor.doctorName)
    || !currentPatient
    || currentPatient.updateTime !== patientDocument.updateTime
  ) {
    throw new HttpError(409, "Your staff or patient access changed. Refresh before reopening this draft.");
  }
  assertDraftAccess(actor, currentPatient);
}

function deleteWrite(env, path, updateTime, database) {
  return {
    delete: database.documentName(env, path),
    currentDocument: { updateTime },
  };
}

export async function loadConsultationDraft(
  env,
  { patientId, appointmentId },
  actor,
  patientDocument,
  database = defaultDatabase,
  now = new Date(),
) {
  assertDraftAccess(actor, patientDocument);
  const path = draftPath(actor, patientId, appointmentId);
  const existing = await database.getDocument(env, path);
  if (!existing) return null;
  if (existing.data.ownerUid !== actor.uid) {
    throw new HttpError(409, "This draft belongs to another account.");
  }

  let draft;
  try {
    draft = validateStoredConsultationDraft(existing.data, actor, patientId, appointmentId);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    await database.commitWrites(env, [
      ...authorizationWrites(env, actor, patientId, patientDocument, database),
      deleteWrite(env, path, existing.updateTime, database),
    ]);
    return null;
  }

  if (Date.parse(draft.expiresAt) <= now.getTime()) {
    await database.commitWrites(env, [
      ...authorizationWrites(env, actor, patientId, patientDocument, database),
      deleteWrite(env, path, existing.updateTime, database),
    ]);
    return null;
  }
  if (await database.completedConsultationAfterDraft(env, {
    patientId,
    appointmentId,
    ownerUid: actor.uid,
    updatedAt: draft.updatedAt,
  })) {
    await database.commitWrites(env, [
      ...authorizationWrites(env, actor, patientId, patientDocument, database),
      deleteWrite(env, path, existing.updateTime, database),
    ]);
    return null;
  }
  await assertReadAuthorizationUnchanged(env, actor, patientId, patientDocument, database);
  return draft;
}

export async function saveConsultationDraft(
  env,
  body,
  actor,
  patientDocument,
  database = defaultDatabase,
  now = new Date(),
) {
  const patientId = body?.patientId;
  assertDraftAccess(actor, patientDocument);
  const path = draftPath(actor, patientId, body?.appointmentId);
  const existing = await database.getDocument(env, path);
  if (existing && existing.data.ownerUid !== actor.uid) {
    throw new HttpError(409, "This draft belongs to another account.");
  }

  const draft = validateConsultationDraft(body, actor, patientId, now);
  let createdAt = draft.updatedAt;
  if (existing) {
    try {
      const stored = validateStoredConsultationDraft(existing.data, actor, patientId, body.appointmentId);
      if (Date.parse(stored.expiresAt) > now.getTime()) createdAt = new Date(stored.createdAt);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
    }
  }
  const document = { ...draft, createdAt };
  const write = existing
    ? database.updateDocumentWrite(env, path, document, Object.keys(document), existing.updateTime)
    : database.createDocumentWrite(env, path, document);
  await database.commitWrites(env, [
    ...authorizationWrites(env, actor, patientId, patientDocument, database),
    write,
  ]);
  return { savedAt: document.updatedAt.toISOString() };
}

export async function removeConsultationDraft(
  env,
  { patientId, appointmentId },
  actor,
  patientDocument,
  database = defaultDatabase,
) {
  assertDraftAccess(actor, patientDocument);
  const path = draftPath(actor, patientId, appointmentId);
  const existing = await database.getDocument(env, path);
  if (!existing) return { deleted: false };
  if (existing.data.ownerUid !== actor.uid) {
    throw new HttpError(403, "This draft belongs to another account.");
  }
  await database.commitWrites(env, [
    ...authorizationWrites(env, actor, patientId, patientDocument, database),
    deleteWrite(env, path, existing.updateTime, database),
  ]);
  return { deleted: true };
}
