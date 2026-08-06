import assert from "node:assert/strict";
import test from "node:test";

import {
  assertActivePatientDocument,
  assertBillingStaff,
  verifyDocumentWrite,
} from "../server/razorpay/firebase.js";

const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };
const updateTime = "2026-08-07T10:15:30.123456Z";

test("builds an update-time verification write for an existing document", () => {
  assert.deepEqual(
    verifyDocumentWrite(env, "patients/patient-1", updateTime),
    {
      verify: "projects/asher-healthcare-test/databases/(default)/documents/patients/patient-1",
      currentDocument: { updateTime },
    },
  );
});

test("rejects collection paths and ambiguous document paths", () => {
  for (const path of ["patients", "/patients/patient-1", "patients//patient-1", "patients/../patient-1"]) {
    assert.throws(
      () => verifyDocumentWrite(env, path, updateTime),
      /precondition was invalid/u,
    );
  }
});

test("rejects a missing or malformed update time", () => {
  for (const value of [undefined, "", "yesterday", "2026-08-07T10:15:30+05:30"]) {
    assert.throws(
      () => verifyDocumentWrite(env, "patients/patient-1", value),
      /precondition was invalid/u,
    );
  }
});

test("accepts only an existing, non-archived patient document", () => {
  const active = { data: { archived: false }, updateTime };
  assert.equal(assertActivePatientDocument(active), active);

  assert.throws(
    () => assertActivePatientDocument(null, { missingMessage: "Missing chart" }),
    (error) => error.status === 409 && error.message === "Missing chart",
  );
  assert.throws(
    () => assertActivePatientDocument(
      { data: { archived: true }, updateTime },
      { archivedMessage: "Archived chart" },
    ),
    (error) => error.status === 409 && error.message === "Archived chart",
  );
});

test("limits payment management to administrators and reception", () => {
  const administrator = { uid: "admin-1", role: "admin" };
  const receptionist = { uid: "reception-1", role: "reception" };
  assert.equal(assertBillingStaff(administrator), administrator);
  assert.equal(assertBillingStaff(receptionist), receptionist);

  for (const staff of [{ uid: "doctor-1", role: "doctor" }, null]) {
    assert.throws(
      () => assertBillingStaff(staff),
      (error) => error.status === 403 && /administrators and reception/u.test(error.message),
    );
  }
});
