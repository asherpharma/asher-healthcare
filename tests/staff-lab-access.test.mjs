import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStaffLabAccessRequest,
  setStaffLabReportAccess,
} from "../server/staff/lab-report-access.js";
import { HttpError } from "../server/razorpay/http.js";

const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };
const updateTime = "2026-08-10T08:15:30.123456Z";

function document(data, suffix = "") {
  return {
    data,
    updateTime: suffix ? updateTime.replace("30.", `${suffix}.`) : updateTime,
  };
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
    verifyDocumentWrite(_env, path, currentUpdateTime) {
      return { verify: path, currentDocument: { updateTime: currentUpdateTime } };
    },
    updateDocumentWrite(_env, path, data, fieldPaths, currentUpdateTime) {
      return {
        update: path,
        data,
        fieldPaths,
        currentDocument: { updateTime: currentUpdateTime },
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

function administrator(overrides = {}) {
  return document({
    active: true,
    role: "admin",
    displayName: "Clinic Admin",
    email: "secret-admin@example.test",
    ...overrides,
  }, "31");
}

function target(overrides = {}) {
  return document({
    active: true,
    role: "reception",
    displayName: "Reception One",
    email: "secret-reception@example.test",
    labReportOperator: false,
    ...overrides,
  }, "32");
}

test("accepts only a valid staff ID and an explicit boolean", () => {
  assert.deepEqual(
    normalizeStaffLabAccessRequest({ uid: " reception-1 ", allowed: true }),
    { uid: "reception-1", allowed: true },
  );
  for (const body of [
    { uid: "", allowed: true },
    { uid: "../staff", allowed: true },
    { uid: "reception-1", allowed: "true" },
    { uid: "reception-1" },
  ]) {
    assert.throws(
      () => normalizeStaffLabAccessRequest(body),
      (error) => error instanceof HttpError && error.status === 400,
    );
  }
});

for (const [allowed, eventType] of [
  [true, "staff.lab_report_access_granted"],
  [false, "staff.lab_report_access_revoked"],
]) {
  test(`${allowed ? "grants" : "revokes"} access with current-document checks and a redacted audit`, async () => {
    const database = fakeDatabase({
      "staff/admin-1": administrator(),
      "staff/reception-1": target({ labReportOperator: !allowed }),
    });

    const result = await setStaffLabReportAccess(
      env,
      { uid: "reception-1", allowed },
      { uid: "admin-1", role: "admin", email: "token-secret@example.test" },
      database,
    );

    assert.deepEqual(database.reads, ["staff/admin-1", "staff/reception-1"]);
    assert.equal(database.commits.length, 1);
    const [verifyAdministrator, updateTarget, audit] = database.commits[0];
    assert.equal(verifyAdministrator.verify, "staff/admin-1");
    assert.equal(verifyAdministrator.currentDocument.updateTime, administrator().updateTime);
    assert.equal(updateTarget.update, "staff/reception-1");
    assert.deepEqual(updateTarget.fieldPaths, ["labReportOperator", "updatedAt"]);
    assert.equal(updateTarget.data.labReportOperator, allowed);
    assert.equal(updateTarget.currentDocument.updateTime, target().updateTime);
    assert.match(audit.create, /^auditLogs\/[0-9a-f-]{36}$/u);
    assert.equal(audit.data.eventType, eventType);
    assert.equal(audit.data.actorUid, "admin-1");
    assert.equal(audit.data.actorRole, "admin");
    assert.equal(audit.data.actorName, "Clinic Admin");
    assert.equal(audit.data.targetUid, "reception-1");
    assert.equal(audit.data.targetRole, "reception");
    assert.equal(audit.data.targetName, "Reception One");
    assert.equal(audit.data.allowed, allowed);
    assert.equal(audit.currentDocument.exists, false);
    assert.equal(result.changed, true);
    assert.equal(result.labReportOperator, allowed);

    const serializedAudit = JSON.stringify(audit);
    assert.equal(serializedAudit.includes("secret-admin@example.test"), false);
    assert.equal(serializedAudit.includes("secret-reception@example.test"), false);
    assert.equal(serializedAudit.includes("token-secret@example.test"), false);
  });
}

test("re-reads and rejects an inactive or demoted administrator", async () => {
  for (const adminDocument of [
    administrator({ active: false }),
    administrator({ role: "reception" }),
    null,
  ]) {
    const database = fakeDatabase({
      ...(adminDocument ? { "staff/admin-1": adminDocument } : {}),
      "staff/reception-1": target(),
    });
    await assert.rejects(
      setStaffLabReportAccess(
        env,
        { uid: "reception-1", allowed: true },
        { uid: "admin-1", role: "admin" },
        database,
      ),
      (error) => error instanceof HttpError && error.status === 403,
    );
    assert.equal(database.commits.length, 0);
  }
});

test("rejects missing, inactive, unsupported, and administrator targets", async () => {
  for (const [targetDocument, status] of [
    [null, 404],
    [target({ active: false }), 409],
    [target({ role: "contractor" }), 409],
    [target({ role: "admin" }), 409],
  ]) {
    const database = fakeDatabase({
      "staff/admin-1": administrator(),
      ...(targetDocument ? { "staff/target-1": targetDocument } : {}),
    });
    await assert.rejects(
      setStaffLabReportAccess(
        env,
        { uid: "target-1", allowed: true },
        { uid: "admin-1", role: "admin" },
        database,
      ),
      (error) => error instanceof HttpError && error.status === status,
    );
    assert.equal(database.commits.length, 0);
  }
});

test("treats an already-applied access state as an idempotent no-op", async () => {
  const database = fakeDatabase({
    "staff/admin-1": administrator(),
    "staff/reception-1": target({ labReportOperator: true }),
  });
  const result = await setStaffLabReportAccess(
    env,
    { uid: "reception-1", allowed: true },
    { uid: "admin-1", role: "admin" },
    database,
  );
  assert.equal(result.changed, false);
  assert.equal(result.labReportOperator, true);
  assert.equal(database.commits.length, 0);
});
