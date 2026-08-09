import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../server/razorpay/http.js";
import {
  normalizeStaffRoleAssignmentRequest,
  setStaffRoleAssignment,
} from "../server/staff/role-assignment.js";

const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };

function document(data, updateTime) {
  return { data, updateTime };
}

const ADMIN_TIME = "2026-08-10T10:00:00.123456Z";
const TARGET_TIME = "2026-08-10T10:01:00.123456Z";

function administrator(overrides = {}) {
  return document({
    active: true,
    role: "admin",
    displayName: "Clinic Admin",
    email: "admin-secret@example.test",
    ...overrides,
  }, ADMIN_TIME);
}

function target(overrides = {}) {
  return document({
    active: true,
    role: "reception",
    doctorName: "",
    displayName: "Reception One",
    email: "reception-secret@example.test",
    labReportOperator: true,
    ...overrides,
  }, TARGET_TIME);
}

function fakeDatabase(documents) {
  const reads = [];
  const commits = [];
  return {
    reads,
    commits,
    async getDocument(_env, path) {
      reads.push(path);
      return documents[path] || null;
    },
    verifyDocumentWrite(_env, path, updateTime) {
      return { verify: path, currentDocument: { updateTime } };
    },
    updateDocumentWrite(_env, path, data, fieldPaths, updateTime) {
      return {
        update: path,
        data,
        fieldPaths,
        currentDocument: { updateTime },
      };
    },
    createDocumentWrite(_env, path, data) {
      return { create: path, data, currentDocument: { exists: false } };
    },
    async commitWrites(_env, writes) {
      commits.push(writes);
      return {};
    },
  };
}

test("normalizes only canonical roles and doctor assignments", () => {
  assert.deepEqual(normalizeStaffRoleAssignmentRequest({
    uid: " doctor-1 ",
    role: "doctor",
    doctorName: "Dr. Shaik Reshma",
  }), {
    uid: "doctor-1",
    role: "doctor",
    doctorName: "Dr. Shaik Reshma",
    doctorId: "obg",
  });
  assert.deepEqual(normalizeStaffRoleAssignmentRequest({
    uid: "reception-1",
    role: "reception",
    doctorName: "",
  }), {
    uid: "reception-1",
    role: "reception",
    doctorName: "",
    doctorId: "unassigned",
  });

  for (const body of [
    null,
    { uid: "../staff", role: "reception", doctorName: "" },
    { uid: "staff-1", role: "owner", doctorName: "" },
    { uid: "staff-1", role: "doctor", doctorName: "Unknown Doctor" },
    { uid: "staff-1", role: "reception", doctorName: "Dr. Shaik Reshma" },
  ]) {
    assert.throws(
      () => normalizeStaffRoleAssignmentRequest(body),
      (error) => error instanceof HttpError && error.status === 400,
    );
  }
});

test("role changes are atomic, audited, and revoke explicit laboratory access", async () => {
  const database = fakeDatabase({
    "staff/admin-1": administrator(),
    "staff/reception-1": target(),
  });

  const result = await setStaffRoleAssignment(
    env,
    {
      uid: "reception-1",
      role: "doctor",
      doctorName: "Dr. Lt Col Shafi Ahamad",
    },
    { uid: "admin-1", role: "admin", email: "token-secret@example.test" },
    database,
  );

  assert.deepEqual(database.reads, ["staff/admin-1", "staff/reception-1"]);
  assert.equal(database.commits.length, 1);
  const [verifyAdministrator, updateTarget, audit] = database.commits[0];
  assert.deepEqual(verifyAdministrator, {
    verify: "staff/admin-1",
    currentDocument: { updateTime: ADMIN_TIME },
  });
  assert.equal(updateTarget.update, "staff/reception-1");
  assert.equal(updateTarget.currentDocument.updateTime, TARGET_TIME);
  assert.deepEqual(updateTarget.fieldPaths, [
    "role",
    "doctorName",
    "updatedBy",
    "updatedAt",
    "labReportOperator",
  ]);
  assert.equal(updateTarget.data.role, "doctor");
  assert.equal(updateTarget.data.doctorName, "Dr. Lt Col Shafi Ahamad");
  assert.equal(updateTarget.data.labReportOperator, false);
  assert.equal(updateTarget.data.updatedBy, "admin-1");

  assert.match(audit.create, /^auditLogs\/[0-9a-f-]{36}$/u);
  assert.equal(audit.currentDocument.exists, false);
  assert.deepEqual({ ...audit.data, createdAt: null }, {
    eventType: "staff.access_profile_changed",
    category: "staff_access",
    changeType: "role_and_doctor_assignment",
    actorUid: "admin-1",
    actorRole: "admin",
    targetUid: "reception-1",
    previousRole: "reception",
    nextRole: "doctor",
    previousDoctorId: "unassigned",
    nextDoctorId: "pediatrics",
    explicitLabAccessRevoked: true,
    createdAt: null,
  });
  const serializedAudit = JSON.stringify(audit);
  assert.equal(serializedAudit.includes("admin-secret@example.test"), false);
  assert.equal(serializedAudit.includes("reception-secret@example.test"), false);
  assert.equal(serializedAudit.includes("token-secret@example.test"), false);
  assert.equal(serializedAudit.includes("Dr. Lt Col Shafi Ahamad"), false);
  assert.equal(result.labReportOperator, false);
  assert.equal(result.changed, true);
});

test("doctor reassignment is audited and revokes the separate lab grant", async () => {
  const database = fakeDatabase({
    "staff/admin-1": administrator(),
    "staff/doctor-1": target({
      role: "doctor",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      labReportOperator: true,
    }),
  });

  const result = await setStaffRoleAssignment(
    env,
    { uid: "doctor-1", role: "doctor", doctorName: "Dr. Shaik Reshma" },
    { uid: "admin-1", role: "admin" },
    database,
  );
  const [, updateTarget, audit] = database.commits[0];
  assert.deepEqual(updateTarget.fieldPaths, [
    "role",
    "doctorName",
    "updatedBy",
    "updatedAt",
    "labReportOperator",
  ]);
  assert.equal(updateTarget.data.labReportOperator, false);
  assert.equal(audit.data.changeType, "doctor_assignment");
  assert.equal(audit.data.previousDoctorId, "pediatrics");
  assert.equal(audit.data.nextDoctorId, "obg");
  assert.equal(audit.data.explicitLabAccessRevoked, true);
  assert.equal(result.labReportOperator, false);
});

test("re-reads the administrator and rejects a missing, inactive, or demoted actor", async () => {
  for (const adminDocument of [
    null,
    administrator({ active: false }),
    administrator({ role: "reception" }),
  ]) {
    const database = fakeDatabase({
      ...(adminDocument ? { "staff/admin-1": adminDocument } : {}),
      "staff/reception-1": target(),
    });
    await assert.rejects(
      setStaffRoleAssignment(
        env,
        { uid: "reception-1", role: "admin", doctorName: "" },
        { uid: "admin-1", role: "admin" },
        database,
      ),
      (error) => error instanceof HttpError && error.status === 403,
    );
    assert.equal(database.commits.length, 0);
  }
});

test("rejects missing targets and self role changes", async () => {
  const missingDatabase = fakeDatabase({ "staff/admin-1": administrator() });
  await assert.rejects(
    setStaffRoleAssignment(
      env,
      { uid: "missing-1", role: "reception", doctorName: "" },
      { uid: "admin-1", role: "admin" },
      missingDatabase,
    ),
    (error) => error instanceof HttpError && error.status === 404,
  );

  const selfDatabase = fakeDatabase({ "staff/admin-1": administrator() });
  await assert.rejects(
    setStaffRoleAssignment(
      env,
      { uid: "admin-1", role: "reception", doctorName: "" },
      { uid: "admin-1", role: "admin" },
      selfDatabase,
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(selfDatabase.commits.length, 0);
});

test("an already-current assignment is an idempotent no-op", async () => {
  const database = fakeDatabase({
    "staff/admin-1": administrator(),
    "staff/reception-1": target({ labReportOperator: false }),
  });
  const result = await setStaffRoleAssignment(
    env,
    { uid: "reception-1", role: "reception", doctorName: "" },
    { uid: "admin-1", role: "admin" },
    database,
  );
  assert.equal(result.changed, false);
  assert.equal(result.labReportOperator, false);
  assert.equal(database.commits.length, 0);
});
