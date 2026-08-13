import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../server/razorpay/http.js";
import { createConsultationDraftHandlers } from "../functions/api/staff/consultation-draft.js";
import {
  actorCanAccessDraft,
  consultationDraftKey,
  loadConsultationDraft,
  removeConsultationDraft,
  saveConsultationDraft,
  validateConsultationDraft,
  validateStoredConsultationDraft,
} from "../server/consultations/draft.js";

const NOW = new Date("2026-08-13T08:00:00.000Z");
const STAFF_UPDATE_TIME = "2026-08-13T07:58:00.000000Z";
const PATIENT_UPDATE_TIME = "2026-08-13T07:59:00.000000Z";
const DRAFT_UPDATE_TIME = "2026-08-13T08:00:00.000000Z";
const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };
const doctor = {
  uid: "doctor-pediatrics",
  role: "doctor",
  doctorName: "Dr. Lt Col Shafi Ahamad",
  displayName: "Dr. Lt Col Shafi Ahamad",
  staffUpdateTime: STAFF_UPDATE_TIME,
};
const patient = {
  data: { archived: false, doctorName: doctor.doctorName },
  updateTime: PATIENT_UPDATE_TIME,
};

function body(overrides = {}) {
  return {
    patientId: "patient-1",
    appointmentId: "appointment-1",
    doctorName: doctor.doctorName,
    fields: {
      temperature: "98.6",
      pulse: "80",
      bloodPressure: "120/80",
      spo2: "99",
      weight: "20",
      chiefComplaint: "Fever",
      examinationFindings: "Well hydrated",
      diagnosis: "Viral fever",
      treatment: "Supportive care",
      clinicalNotes: "",
      advice: "Fluids",
      labPriority: "routine",
      labNotes: "",
      followUpDate: "2026-08-20",
      followUpTime: "18:00",
      followUpPriority: "medium",
    },
    medicines: [{ name: "Paracetamol", dose: "5 ml", frequency: "TDS", duration: "3 days", instructions: "After food" }],
    labTests: ["CBC"],
    ...overrides,
  };
}

function storedDraft(overrides = {}) {
  const validated = validateConsultationDraft(body(), doctor, "patient-1", NOW);
  return {
    ...validated,
    createdAt: new Date("2026-08-13T07:30:00.000Z").toISOString(),
    updatedAt: validated.updatedAt.toISOString(),
    expiresAt: validated.expiresAt.toISOString(),
    ...overrides,
  };
}

function fakeDatabase(documents = {}) {
  const allDocuments = {
    [`staff/${doctor.uid}`]: {
      data: { active: true, role: doctor.role, doctorName: doctor.doctorName },
      updateTime: STAFF_UPDATE_TIME,
    },
    "patients/patient-1": patient,
    ...documents,
  };
  const commits = [];
  const reads = [];
  return {
    commits,
    reads,
    async completedConsultationAfterDraft() {
      return false;
    },
    async getDocument(_env, path) {
      reads.push(path);
      return allDocuments[path] || null;
    },
    verifyDocumentWrite(_env, path, updateTime) {
      return { verify: path, currentDocument: { updateTime } };
    },
    updateDocumentWrite(_env, path, data, fieldPaths, updateTime) {
      return { update: path, data, fieldPaths, currentDocument: { updateTime } };
    },
    createDocumentWrite(_env, path, data) {
      return { create: path, data, currentDocument: { exists: false } };
    },
    documentName(_env, path) {
      return path;
    },
    async commitWrites(_env, writes) {
      commits.push(writes);
      return {};
    },
  };
}

test("consultation draft validation returns a strict bounded seven-day record", () => {
  const result = validateConsultationDraft(body(), doctor, "patient-1", NOW);
  assert.equal(result.ownerUid, doctor.uid);
  assert.equal(result.patientId, "patient-1");
  assert.equal(result.appointmentKey, "appointment-1");
  assert.equal(result.expiresAt.toISOString(), "2026-08-20T08:00:00.000Z");
  assert.equal(
    validateStoredConsultationDraft(storedDraft(), doctor, "patient-1", "appointment-1").fields.diagnosis,
    "Viral fever",
  );
});

test("draft validation rejects malformed, oversized and unexpected clinical content", () => {
  assert.throws(() => validateConsultationDraft(body({ doctorName: "Dr. Shaik Reshma" }), doctor, "patient-1"), /not assigned/u);
  assert.throws(() => consultationDraftKey(doctor.uid, "../unsafe"), /valid consultation appointment/u);
  assert.throws(() => validateConsultationDraft(body({ fields: { ...body().fields, diagnosis: "x".repeat(2001) } }), doctor, "patient-1"), /too long/u);
  assert.throws(() => validateConsultationDraft(body({ fields: { ...body().fields, unexpected: "PHI" } }), doctor, "patient-1"), /valid consultation draft fields/u);
  assert.throws(() => validateConsultationDraft(body({ medicines: [{ ...body().medicines[0], name: "x".repeat(201) }] }), doctor, "patient-1"), /too long/u);
  assert.throws(() => validateConsultationDraft(body({ medicines: [{ ...body().medicines[0], unexpected: "PHI" }] }), doctor, "patient-1"), /valid medicine/u);
  assert.throws(() => validateConsultationDraft(body({ medicines: Array.from({ length: 21 }, () => body().medicines[0]) }), doctor, "patient-1"), /20 medicines/u);
  assert.throws(() => validateConsultationDraft(body({ labTests: ["x".repeat(161)] }), doctor, "patient-1"), /too long/u);
  assert.throws(() => validateConsultationDraft(body({ labTests: Array.from({ length: 21 }, () => "CBC") }), doctor, "patient-1"), /20 lab tests/u);
  assert.throws(() => validateConsultationDraft({ ...body(), unexpected: "PHI" }, doctor, "patient-1"), /valid consultation draft/u);
});

test("stored draft validation fails closed on corrupt dates, retention, ownership and payload", () => {
  for (const invalid of [
    { updatedAt: undefined },
    { expiresAt: "not-a-date" },
    { expiresAt: "2026-08-30T08:00:00.000Z" },
    { ownerUid: "another-user" },
    { medicines: [{ name: "Unbounded" }] },
    { unexpected: "PHI" },
  ]) {
    assert.throws(
      () => validateStoredConsultationDraft(storedDraft(invalid), doctor, "patient-1", "appointment-1"),
      (error) => error instanceof HttpError && [400, 409].includes(error.status),
    );
  }
});

test("draft access follows the current administrator or assigned doctor profile", () => {
  assert.equal(actorCanAccessDraft({ role: "admin" }, {}), true);
  assert.equal(actorCanAccessDraft(doctor, { doctorName: doctor.doctorName }), true);
  assert.equal(actorCanAccessDraft(doctor, { doctorName: "Dr. Shaik Reshma" }), false);
  assert.equal(actorCanAccessDraft({ ...doctor, role: "reception" }, { doctorName: doctor.doctorName }), false);
});

test("saving uses staff, patient and draft preconditions in one commit", async () => {
  const path = `patients/patient-1/consultationDrafts/${doctor.uid}--appointment-1`;
  const database = fakeDatabase({
    [path]: { data: storedDraft(), updateTime: DRAFT_UPDATE_TIME },
  });
  const result = await saveConsultationDraft(env, body(), doctor, patient, database, NOW);
  assert.equal(result.savedAt, NOW.toISOString());
  assert.deepEqual(database.reads, [path]);
  assert.equal(database.commits.length, 1);
  const [staffVerify, patientVerify, update] = database.commits[0];
  assert.deepEqual(staffVerify, { verify: `staff/${doctor.uid}`, currentDocument: { updateTime: STAFF_UPDATE_TIME } });
  assert.deepEqual(patientVerify, { verify: "patients/patient-1", currentDocument: { updateTime: PATIENT_UPDATE_TIME } });
  assert.equal(update.update, path);
  assert.equal(update.currentDocument.updateTime, DRAFT_UPDATE_TIME);
});

test("an expired or corrupt draft is safely replaced using its exact updateTime", async () => {
  const path = `patients/patient-1/consultationDrafts/${doctor.uid}--appointment-1`;
  const database = fakeDatabase({
    [path]: {
      data: storedDraft({ expiresAt: "not-a-date", clinicalSecret: "invalid" }),
      updateTime: DRAFT_UPDATE_TIME,
    },
  });
  await saveConsultationDraft(env, body(), doctor, patient, database, NOW);
  const update = database.commits[0][2];
  assert.equal(update.update, path);
  assert.equal(update.currentDocument.updateTime, DRAFT_UPDATE_TIME);
  assert.equal(update.data.createdAt.toISOString(), NOW.toISOString());
});

test("loading deletes expired or corrupt PHI with authorization preconditions", async () => {
  const path = `patients/patient-1/consultationDrafts/${doctor.uid}--appointment-1`;
  for (const data of [
    storedDraft(),
    storedDraft({ expiresAt: "not-a-date" }),
  ]) {
    const database = fakeDatabase({ [path]: { data, updateTime: DRAFT_UPDATE_TIME } });
    const result = await loadConsultationDraft(
      env,
      { patientId: "patient-1", appointmentId: "appointment-1" },
      doctor,
      patient,
      database,
      new Date("2026-08-21T08:00:00.000Z"),
    );
    assert.equal(result, null);
    assert.equal(database.commits.length, 1);
    assert.equal(database.commits[0][2].delete, path);
    assert.equal(database.commits[0][2].currentDocument.updateTime, DRAFT_UPDATE_TIME);
  }
});

test("loading removes a durable stale draft after the matching consultation was signed", async () => {
  const path = `patients/patient-1/consultationDrafts/${doctor.uid}--appointment-1`;
  const database = fakeDatabase({ [path]: { data: storedDraft(), updateTime: DRAFT_UPDATE_TIME } });
  database.completedConsultationAfterDraft = async (_env, context) => {
    assert.deepEqual(context, {
      patientId: "patient-1",
      appointmentId: "appointment-1",
      ownerUid: doctor.uid,
      updatedAt: NOW.toISOString(),
    });
    return true;
  };

  const result = await loadConsultationDraft(
    env,
    { patientId: "patient-1", appointmentId: "appointment-1" },
    doctor,
    patient,
    database,
    NOW,
  );
  assert.equal(result, null);
  assert.equal(database.commits[0][2].delete, path);
  assert.equal(database.commits[0][2].currentDocument.updateTime, DRAFT_UPDATE_TIME);
});

test("loading rechecks staff and patient revisions before disclosing PHI", async () => {
  const path = `patients/patient-1/consultationDrafts/${doctor.uid}--appointment-1`;
  const database = fakeDatabase({
    [path]: { data: storedDraft(), updateTime: DRAFT_UPDATE_TIME },
    [`staff/${doctor.uid}`]: {
      data: { active: false, role: doctor.role, doctorName: doctor.doctorName },
      updateTime: "2026-08-13T08:01:00.000000Z",
    },
  });
  await assert.rejects(
    loadConsultationDraft(
      env,
      { patientId: "patient-1", appointmentId: "appointment-1" },
      doctor,
      patient,
      database,
      NOW,
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.deepEqual(database.reads, [path, `staff/${doctor.uid}`, "patients/patient-1"]);
  assert.equal(database.commits.length, 0);
});

test("deleting verifies current staff and patient assignment in the same commit", async () => {
  const path = `patients/patient-1/consultationDrafts/${doctor.uid}--appointment-1`;
  const database = fakeDatabase({ [path]: { data: storedDraft(), updateTime: DRAFT_UPDATE_TIME } });
  const result = await removeConsultationDraft(
    env,
    { patientId: "patient-1", appointmentId: "appointment-1" },
    doctor,
    patient,
    database,
  );
  assert.deepEqual(result, { deleted: true });
  const [staffVerify, patientVerify, deletion] = database.commits[0];
  assert.equal(staffVerify.currentDocument.updateTime, STAFF_UPDATE_TIME);
  assert.equal(patientVerify.currentDocument.updateTime, PATIENT_UPDATE_TIME);
  assert.equal(deletion.delete, path);
  assert.equal(deletion.currentDocument.updateTime, DRAFT_UPDATE_TIME);
});

test("draft load accepts PHI-linked identifiers only in an authenticated POST body", async () => {
  const calls = [];
  const handlers = createConsultationDraftHandlers({
    assertSameOrigin() { calls.push("origin"); },
    async requireActiveStaff() {
      calls.push("auth");
      return doctor;
    },
    async readJson(request, maximumBytes) {
      calls.push(["body", maximumBytes]);
      return request.json();
    },
    async patientForActor(_env, actor, patientId) {
      calls.push(["patient", actor.uid, patientId]);
      return { patient };
    },
    async loadConsultationDraft(_env, input) {
      calls.push(["load", input]);
      return { fields: { diagnosis: "private" } };
    },
    errorResponse(error) { throw error; },
    json(data, status = 200) {
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    },
  });
  const context = {
    request: new Request("https://clinic.example/api/staff/consultation-draft", {
      method: "POST",
      headers: { Origin: "https://clinic.example", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", patientId: "patient-1", appointmentId: "appointment-1" }),
    }),
    env,
  };
  const response = await handlers.post(context);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    "origin",
    "auth",
    ["body", 4_000],
    ["patient", doctor.uid, "patient-1"],
    ["load", { patientId: "patient-1", appointmentId: "appointment-1" }],
  ]);
});

test("draft load rejects GET so identifiers cannot enter URLs or edge logs", async () => {
  const handlers = createConsultationDraftHandlers({
    json(data, status = 200) {
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    },
  });
  const response = handlers.get();
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Consultation identifiers are not accepted in URLs." });
});
