import assert from "node:assert/strict";
import test from "node:test";

import { projectPatientDirectory } from "../server/patients/directory.js";

const activePediatricPatient = {
  id: "patient-ped",
  patientNumber: "ASH-PED001",
  fullName: "Aarav Kumar",
  phone: "9000000001",
  dateOfBirth: "2020-04-05",
  gender: "male",
  doctorId: "pediatrics",
  doctorName: "Dr. Lt Col Shafi Ahamad",
  caseType: "specialist",
  specialty: "pediatrics",
  consultationFee: 500,
  address: "RK Hegde Nagar",
  allergies: "Peanuts",
  medicalHistory: "Asthma",
  createdAt: "2026-08-01T10:00:00.000Z",
};

const activeObgPatient = {
  id: "patient-obg",
  patientNumber: "ASH-OBG001",
  fullName: "Meera Rao",
  phone: "9000000002",
  dateOfBirth: "1992-08-10",
  gender: "female",
  doctorId: "obg",
  doctorName: "Dr. Shaik Reshma",
  caseType: "specialist",
  specialty: "obg",
  consultationFee: 500,
  address: "Thanisandra",
  allergies: "Penicillin",
  medicalHistory: "Private history",
  createdAt: "2026-08-02T10:00:00.000Z",
};

const archivedPatient = {
  ...activePediatricPatient,
  id: "patient-archived",
  patientNumber: "ASH-OLD001",
  fullName: "Archived Patient",
  archived: true,
  archivedAt: "2026-08-03T10:00:00.000Z",
  archivedBy: "admin-user",
  archiveReason: "Duplicate chart",
};

const documents = [activePediatricPatient, activeObgPatient, archivedPatient];

test("reception gets active operational records without clinical history", () => {
  const patients = projectPatientDirectory(
    documents,
    { uid: "reception-user", role: "reception" },
    { active: true },
  );

  assert.deepEqual(patients.map((patient) => patient.id).sort(), ["patient-obg", "patient-ped"]);
  patients.forEach((patient) => {
    assert.equal("allergies" in patient, false);
    assert.equal("medicalHistory" in patient, false);
    assert.equal("createdAt" in patient, false);
    assert.equal("updatedAt" in patient, false);
    assert.equal("archived" in patient, false);
  });
});

test("only an admin requesting archived records receives archive metadata", () => {
  const patients = projectPatientDirectory(
    documents,
    { uid: "admin-user", role: "admin" },
    { active: true },
    { includeArchived: true },
  );
  const archived = patients.find((patient) => patient.id === "patient-archived");

  assert.equal(patients.length, 3);
  assert.equal(archived?.archived, true);
  assert.equal(archived?.archiveReason, "Duplicate chart");
  assert.equal("allergies" in archived, false);
  assert.equal("medicalHistory" in archived, false);
});

test("reception cannot expand its scope with includeArchived", () => {
  const patients = projectPatientDirectory(
    documents,
    { uid: "reception-user", role: "reception" },
    { active: true },
    { includeArchived: true },
  );

  assert.deepEqual(patients.map((patient) => patient.id).sort(), ["patient-obg", "patient-ped"]);
});

test("doctor receives only charts assigned to that doctor", () => {
  const conflictingAssignment = {
    ...activeObgPatient,
    id: "patient-conflict",
    doctorId: "pediatrics",
  };
  const patients = projectPatientDirectory(
    [...documents, conflictingAssignment],
    { uid: "doctor-user", role: "doctor" },
    { active: true, doctorName: "Dr. Lt Col Shafi Ahamad" },
  );

  assert.deepEqual(patients.map((patient) => patient.id), ["patient-ped"]);
  assert.equal(patients[0].doctorName, "Dr. Lt Col Shafi Ahamad");
});

test("unlinked doctor cannot obtain a directory", () => {
  assert.throws(
    () => projectPatientDirectory(
      documents,
      { uid: "doctor-user", role: "doctor" },
      { active: true, doctorName: "" },
    ),
    /not linked/u,
  );
});
