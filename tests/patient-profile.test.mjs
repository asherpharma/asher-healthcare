import assert from "node:assert/strict";
import test from "node:test";

import { errorResponse, HttpError, json } from "../server/razorpay/http.js";
import { createPatientProfileReadHandler } from "../functions/api/staff/patients/profile.js";
import {
  canonicalPatientIdentity,
  doctorCanEditPatient,
  patientProfileReadForStaff,
  validatePatientProfileUpdate,
} from "../server/patients/profile.js";

const now = new Date("2026-08-07T04:35:00.000Z");
const patient = {
  fullName: "Ananya Rao",
  phone: "+919876543210",
  dateOfBirth: "1991-06-15",
  gender: "female",
  doctorId: "obg",
  doctorName: "Dr. Shaik Reshma",
  caseType: "specialist",
  specialty: "obg",
  address: "RK Hegde Nagar",
  allergies: "Penicillin",
  medicalHistory: "",
  archived: false,
};

const administrator = { role: "admin", doctorName: "" };
const reception = { role: "reception", doctorName: "" };
const obgDoctor = { role: "doctor", doctorName: "Dr. Shaik Reshma" };
const pediatrician = { role: "doctor", doctorName: "Dr. Lt Col Shafi Ahamad" };

test("reception single-patient detail contains demographics but no clinical background", () => {
  const result = patientProfileReadForStaff("patient-1", patient, reception);
  assert.equal(result.id, "patient-1");
  assert.equal(result.address, "RK Hegde Nagar");
  assert.equal("allergies" in result, false);
  assert.equal("medicalHistory" in result, false);
  assert.equal("archived" in result, false);
});

test("single-patient detail fails closed for archived or unassigned staff access", () => {
  assert.throws(
    () => patientProfileReadForStaff(
      "patient-1",
      { ...patient, archived: true },
      reception,
    ),
    (error) => error instanceof HttpError
      && error.status === 404
      && error.message === "This patient record is unavailable.",
  );
  assert.throws(
    () => patientProfileReadForStaff("patient-1", patient, pediatrician),
    (error) => error instanceof HttpError
      && error.status === 404
      && error.message === "This patient record is unavailable.",
  );
});

test("assigned doctors get clinical detail and admins can inspect archived metadata", () => {
  const clinicianResult = patientProfileReadForStaff("patient-1", patient, obgDoctor);
  assert.equal(clinicianResult.allergies, "Penicillin");
  assert.equal(clinicianResult.medicalHistory, "");

  const archivedResult = patientProfileReadForStaff(
    "patient-1",
    {
      ...patient,
      archived: true,
      archivedAt: "2026-08-20T10:00:00.000Z",
      archivedBy: "admin-1",
      archiveReason: "Duplicate chart",
    },
    administrator,
  );
  assert.equal(archivedResult.archived, true);
  assert.equal(archivedResult.archiveReason, "Duplicate chart");
});

test("profile read endpoint rechecks the current role and projects reception-safe fields", async () => {
  const calls = [];
  const handler = createPatientProfileReadHandler({
    assertSameOrigin() { calls.push("origin"); },
    async requireActiveStaff() {
      calls.push("auth");
      return { uid: "reception-1", role: "admin" };
    },
    async getDocument(_env, path) {
      calls.push(path);
      if (path === "staff/reception-1") {
        return { data: { active: true, role: "reception", doctorName: "" } };
      }
      if (path === "patients/patient-1") return { data: patient };
      return null;
    },
    HttpError,
    errorResponse,
    json,
    patientProfileReadForStaff,
  });
  const response = await handler({
    request: new Request(
      "https://clinic.example/api/staff/patients/profile?patientId=patient-1",
      { headers: { Origin: "https://clinic.example" } },
    ),
    env: {},
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.patient.address, "RK Hegde Nagar");
  assert.equal("allergies" in body.patient, false);
  assert.equal("medicalHistory" in body.patient, false);
  assert.deepEqual(calls, ["origin", "auth", "staff/reception-1", "patients/patient-1"]);
});

test("profile read endpoint fails before patient access for an inactive current staff record", async () => {
  const calls = [];
  const handler = createPatientProfileReadHandler({
    assertSameOrigin() {},
    async requireActiveStaff() { return { uid: "staff-1", role: "admin" }; },
    async getDocument(_env, path) {
      calls.push(path);
      return { data: { active: false, role: "admin" } };
    },
    HttpError,
    errorResponse,
    json,
    patientProfileReadForStaff,
  });
  const response = await handler({
    request: new Request(
      "https://clinic.example/api/staff/patients/profile?patientId=patient-1",
    ),
    env: {},
  });

  assert.equal(response.status, 403);
  assert.deepEqual(calls, ["staff/staff-1"]);
});

function demographic(overrides = {}) {
  return {
    fullName: " Ananya   Rao ",
    phone: "09876543210",
    dateOfBirth: "1991-06-15",
    gender: "female",
    doctorName: "Dr. Shaik Reshma",
    address: "RK Hegde Nagar",
    ...overrides,
  };
}

test("normalizes an administrative identity update and derives doctor fields", () => {
  const result = validatePatientProfileUpdate({
    ...demographic({ doctorName: "Dr. Lt Col Shafi Ahamad" }),
    allergies: " None ",
    medicalHistory: "",
  }, administrator, patient, now);

  assert.equal(result.updates.fullName, "Ananya Rao");
  assert.equal(result.updates.phone, "+919876543210");
  assert.equal(result.updates.doctorId, "pediatrics");
  assert.equal(result.updates.specialty, "pediatrics");
  assert.equal(result.updates.allergies, "None");
});
test("reception may edit demographics but not clinical background", () => {
  assert.equal(
    validatePatientProfileUpdate(demographic(), reception, patient, now).updates.address,
    "RK Hegde Nagar",
  );
  assert.throws(
    () => validatePatientProfileUpdate({ ...demographic(), allergies: "None" }, reception, patient, now),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test("the assigned doctor may edit only clinical background", () => {
  const result = validatePatientProfileUpdate({
    allergies: "No known drug allergies",
    medicalHistory: "Asthma",
  }, obgDoctor, patient, now);
  assert.deepEqual(result.updates, {
    allergies: "No known drug allergies",
    medicalHistory: "Asthma",
  });
  assert.throws(
    () => validatePatientProfileUpdate({ allergies: "", address: "Changed" }, obgDoctor, patient, now),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test("another doctor cannot edit the clinical background", () => {
  assert.equal(doctorCanEditPatient(obgDoctor, patient), true);
  assert.equal(doctorCanEditPatient(pediatrician, patient), false);
  assert.throws(
    () => validatePatientProfileUpdate({ allergies: "None" }, pediatrician, patient, now),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test("doctor assignment falls back to doctorId only for a legacy empty name", () => {
  assert.equal(doctorCanEditPatient(obgDoctor, { ...patient, doctorName: "" }), true);
  assert.equal(doctorCanEditPatient(obgDoctor, {
    ...patient,
    doctorName: "Dr. Lt Col Shafi Ahamad",
  }), false);
});

test("archived records and invalid identity fields fail closed", () => {
  assert.throws(
    () => validatePatientProfileUpdate(demographic(), administrator, { ...patient, archived: true }, now),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.throws(
    () => validatePatientProfileUpdate(demographic({ phone: "12345" }), administrator, patient, now),
    (error) => error instanceof HttpError && error.status === 400,
  );
  assert.throws(
    () => validatePatientProfileUpdate(demographic({ dateOfBirth: "2026-08-08" }), administrator, patient, now),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("canonical identities match reception normalization", () => {
  assert.deepEqual(canonicalPatientIdentity({
    fullName: "Ms. Ananya Rao",
    phone: "09876543210",
    dateOfBirth: "1991-06-15",
    gender: "FEMALE",
  }), {
    normalizedName: "ananya rao",
    normalizedPhone: "+919876543210",
    dateOfBirth: "1991-06-15",
    gender: "female",
  });
});
