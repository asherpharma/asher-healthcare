import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../server/razorpay/http.js";
import {
  canonicalPatientIdentity,
  doctorCanEditPatient,
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
