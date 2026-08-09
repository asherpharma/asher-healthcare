import assert from "node:assert/strict";
import test from "node:test";

import {
  finalizationRequestFingerprint,
  preparedFinalizationIntent,
  sha256Hex,
} from "../server/labs/finalization-intents.js";
import {
  normalizeFinalizationReconciliationRequest,
  reconcileLabReportFinalization,
} from "../server/labs/reconcile-finalization.js";
import { HttpError } from "../server/razorpay/http.js";

const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };
const updateTime = "2026-08-10T10:15:30.123456Z";
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const input = {
  labOrderId: "lab-order-1",
  stagedStoragePath: "pending-reports/patient-1/7ebf45a1-report.pdf",
  fileName: "lab-report.pdf",
  contentType: "application/pdf",
  extension: "pdf",
  size: pdfBytes.byteLength,
  sourceProvider: "manual",
  externalLinkVersion: null,
  resultSummary: "",
};

async function intent(overrides = {}) {
  const contentSha256 = await sha256Hex(pdfBytes);
  const requestFingerprint = await finalizationRequestFingerprint({
    input,
    patientId: "patient-1",
    stagedGeneration: "71",
    destinationPath: "lab-reports/patient-1/lab-order-1.pdf",
    uploadedBy: "staff-1",
    contentSha256,
  });
  return {
    ...preparedFinalizationIntent({
      input,
      patientId: "patient-1",
      stagedGeneration: "71",
      destinationPath: "lab-reports/patient-1/lab-order-1.pdf",
      uploadedBy: "staff-1",
      contentSha256,
      requestFingerprint,
      actor: { uid: "staff-1", role: "reception" },
      now: new Date("2026-08-10T09:00:00.000Z"),
    }),
    ...overrides,
  };
}

function fakeDatabase(initialDocuments) {
  const documents = new Map(Object.entries(initialDocuments));
  const commits = [];
  let revision = 0;
  const nextUpdateTime = () => `2026-08-10T10:15:${String(revision += 1).padStart(2, "0")}.000000Z`;
  const pathFromName = (name) => String(name || "").split("/documents/").at(-1) || "";
  return {
    commits,
    documents,
    async getDocument(_env, path) {
      return documents.get(path) || null;
    },
    verifyDocumentWrite(_env, path, currentUpdateTime) {
      return { kind: "verify", path, updateTime: currentUpdateTime };
    },
    createDocumentWrite(_env, path, data) {
      return { kind: "create", path, data };
    },
    updateDocumentWrite(_env, path, data, fields, currentUpdateTime) {
      return { kind: "update", path, data, fields, updateTime: currentUpdateTime };
    },
    async commitWrites(_env, writes) {
      commits.push(writes);
      for (const write of writes) {
        if (write.kind === "create") {
          if (documents.has(write.path)) throw new Error("already exists");
          documents.set(write.path, { data: { ...write.data }, updateTime: nextUpdateTime() });
        } else if (write.kind === "update") {
          const current = documents.get(write.path);
          if (!current) throw new Error("missing update target");
          documents.set(write.path, {
            data: { ...current.data, ...write.data },
            updateTime: nextUpdateTime(),
          });
        } else if (write.verify && write.currentDocument?.exists === false) {
          const path = pathFromName(write.verify);
          if (documents.has(path)) throw new Error("expected missing document");
        }
      }
      return {};
    },
  };
}

function baseDocuments(intentData, orderOverrides = {}) {
  return {
    "staff/admin-1": {
      data: { active: true, role: "admin", displayName: "Clinic Admin" },
      updateTime,
    },
    "labOrders/lab-order-1": {
      data: { patientId: "patient-1", status: "processing", ...orderOverrides },
      updateTime,
    },
    "patients/patient-1": {
      data: { archived: false, doctorName: "Dr. Lt Col Shafi Ahamad" },
      updateTime,
    },
    "labReportFinalizationIntents/lab-order-1": {
      data: intentData,
      updateTime,
    },
  };
}

function fakeStorage(overrides = {}) {
  const calls = [];
  return {
    calls,
    async fetchImmutableReportObject(_env, path) {
      calls.push(["fetch-permanent", path]);
      if (overrides.missingPermanent) {
        throw new HttpError(404, "missing");
      }
      return {
        bytes: overrides.bytes || pdfBytes,
        size: (overrides.bytes || pdfBytes).byteLength,
        contentType: "application/pdf",
        generation: "72",
      };
    },
    async deleteImmutableReportObject(_env, path, generation, options) {
      calls.push(["delete-permanent", path, generation, options]);
      return { deleted: true, missing: false };
    },
    async deleteStagedReportObject(_env, path, generation) {
      calls.push(["delete-staged", path, generation]);
      return true;
    },
  };
}

const admin = { uid: "admin-1", role: "admin", displayName: "Clinic Admin" };

test("normalizes only explicit administrator reconciliation operations and fixed discard reasons", () => {
  assert.deepEqual(
    normalizeFinalizationReconciliationRequest({ labOrderId: "lab-order-1", operation: "inspect" }),
    { labOrderId: "lab-order-1", operation: "inspect", discardReasonCode: "" },
  );
  assert.deepEqual(
    normalizeFinalizationReconciliationRequest({
      labOrderId: "lab-order-1",
      operation: "discard",
      discardReasonCode: "order_cancelled",
    }),
    {
      labOrderId: "lab-order-1",
      operation: "discard",
      discardReasonCode: "order_cancelled",
    },
  );
  assert.throws(
    () => normalizeFinalizationReconciliationRequest({
      labOrderId: "lab-order-1",
      operation: "discard",
      discardReasonCode: "free form patient details",
    }),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("checks active administrator access before disclosing whether an intent exists", async () => {
  const database = fakeDatabase({
    "staff/reception-1": {
      data: { active: true, role: "reception", displayName: "Reception" },
      updateTime,
    },
  });
  await assert.rejects(
    reconcileLabReportFinalization(
      env,
      { labOrderId: "missing-order", operation: "inspect" },
      { uid: "reception-1", role: "reception" },
      { database, storage: fakeStorage() },
    ),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test("inspect verifies the immutable object but returns no path, hash, or clinical summary", async () => {
  const intentData = await intent({ resultSummary: "Private clinical summary" });
  const result = await reconcileLabReportFinalization(
    env,
    { labOrderId: "lab-order-1", operation: "inspect" },
    admin,
    { database: fakeDatabase(baseDocuments(intentData)), storage: fakeStorage() },
  );
  assert.equal(result.intent.object.present, true);
  assert.equal(result.intent.object.verified, true);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["pending-reports", "lab-reports", "contentsha256", "private clinical summary"] ) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false);
  }
});

test("complete atomically binds report, order, audit, and completed intent", async () => {
  const intentData = await intent();
  const database = fakeDatabase(baseDocuments(intentData));
  const storage = fakeStorage();
  const result = await reconcileLabReportFinalization(
    env,
    { labOrderId: "lab-order-1", operation: "complete" },
    admin,
    { database, storage, now: new Date("2026-08-10T11:00:00.000Z") },
  );
  assert.equal(result.finalized, true);
  assert.equal(database.commits.length, 1);
  const writes = database.commits[0];
  assert.ok(writes.some((write) => (
    write.kind === "create"
    && write.path === "patients/patient-1/reports/lab-lab-order-1"
  )));
  assert.ok(writes.some((write) => (
    write.kind === "update"
    && write.path === "labOrders/lab-order-1"
    && write.data.reportStoragePath === "lab-reports/patient-1/lab-order-1.pdf"
  )));
  assert.ok(writes.some((write) => (
    write.kind === "update"
    && write.path === "labReportFinalizationIntents/lab-order-1"
    && write.data.status === "completed"
    && write.data.permanentGeneration === "72"
  )));
  assert.deepEqual(storage.calls.at(-1), [
    "delete-staged",
    "pending-reports/patient-1/7ebf45a1-report.pdf",
    "71",
  ]);
});

test("prepared completion fails closed when a legacy report document already exists", async () => {
  const intentData = await intent();
  const documents = baseDocuments(intentData);
  documents["patients/patient-1/reports/lab-order-1"] = {
    data: { storagePath: "reports/patient-1/legacy-lab-report.pdf" },
    updateTime,
  };
  await assert.rejects(
    reconcileLabReportFinalization(
      env,
      { labOrderId: "lab-order-1", operation: "complete" },
      admin,
      { database: fakeDatabase(documents), storage: fakeStorage() },
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("completed reconciliation is idempotent only while order, report, and object still match", async () => {
  const intentData = await intent({
    status: "completed",
    permanentGeneration: "72",
    completedBy: "admin-1",
    completedAt: new Date("2026-08-10T11:00:00.000Z"),
  });
  const completeDocuments = baseDocuments(intentData, {
    status: "completed",
    reportStoragePath: intentData.destinationPath,
    reportContentType: intentData.contentType,
    reportSize: intentData.size,
  });
  completeDocuments["patients/patient-1/reports/lab-lab-order-1"] = {
    data: {
      storagePath: intentData.destinationPath,
      contentType: intentData.contentType,
      size: intentData.size,
      finalizationIntentId: "lab-order-1",
    },
    updateTime,
  };
  const allowed = await reconcileLabReportFinalization(
    env,
    { labOrderId: "lab-order-1", operation: "complete" },
    admin,
    { database: fakeDatabase(completeDocuments), storage: fakeStorage() },
  );
  assert.equal(allowed.alreadyFinalized, true);

  delete completeDocuments["patients/patient-1/reports/lab-lab-order-1"];
  await assert.rejects(
    reconcileLabReportFinalization(
      env,
      { labOrderId: "lab-order-1", operation: "complete" },
      admin,
      { database: fakeDatabase(completeDocuments), storage: fakeStorage() },
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("discard claims a cancelled order intent before deleting only its verified generation", async () => {
  const intentData = await intent();
  const database = fakeDatabase(baseDocuments(intentData, { status: "cancelled" }));
  const storage = fakeStorage();
  const result = await reconcileLabReportFinalization(
    env,
    {
      labOrderId: "lab-order-1",
      operation: "discard",
      discardReasonCode: "order_cancelled",
    },
    admin,
    { database, storage, now: new Date("2026-08-10T11:00:00.000Z") },
  );
  assert.equal(result.discarded, true);
  assert.equal(database.commits.length, 2);
  assert.ok(database.commits[0].some((write) => (
    write.kind === "update"
    && write.path === "labReportFinalizationIntents/lab-order-1"
    && write.data.status === "discarding"
    && write.data.discardGeneration === "72"
  )));
  assert.ok(storage.calls.some((call) => (
    call[0] === "delete-permanent"
    && call[1] === "lab-reports/patient-1/lab-order-1.pdf"
    && call[2] === "72"
    && call[3].allowMissing === true
  )));
  assert.ok(database.commits[1].some((write) => (
    write.kind === "create"
    && write.path.startsWith("auditLogs/")
    && write.data.eventType === "lab_report.finalization_discarded"
  )));
});

test("discard permits a missing order but blocks any current or legacy patient report pointer", async () => {
  const intentData = await intent();
  const missingOrderDocuments = baseDocuments(intentData);
  delete missingOrderDocuments["labOrders/lab-order-1"];
  const allowedStorage = fakeStorage();
  const allowed = await reconcileLabReportFinalization(
    env,
    {
      labOrderId: "lab-order-1",
      operation: "discard",
      discardReasonCode: "other_verified",
    },
    admin,
    { database: fakeDatabase(missingOrderDocuments), storage: allowedStorage },
  );
  assert.equal(allowed.discarded, true);

  for (const reportPath of [
    "patients/patient-1/reports/lab-lab-order-1",
    "patients/patient-1/reports/lab-order-1",
  ]) {
    const documents = baseDocuments(intentData);
    documents[reportPath] = { data: { storagePath: intentData.destinationPath }, updateTime };
    const storage = fakeStorage();
    await assert.rejects(
      reconcileLabReportFinalization(
        env,
        {
          labOrderId: "lab-order-1",
          operation: "discard",
          discardReasonCode: "duplicate_upload",
        },
        admin,
        { database: fakeDatabase(documents), storage },
      ),
      (error) => error instanceof HttpError && error.status === 409,
    );
    assert.equal(storage.calls.some((call) => call[0] === "delete-permanent"), false);
  }
});

test("discard never deletes a permanent object whose bytes do not match the intent", async () => {
  const intentData = await intent();
  const storage = fakeStorage({ bytes: new Uint8Array([...pdfBytes, 0x00]) });
  await assert.rejects(
    reconcileLabReportFinalization(
      env,
      {
        labOrderId: "lab-order-1",
        operation: "discard",
        discardReasonCode: "wrong_file",
      },
      admin,
      { database: fakeDatabase(baseDocuments(intentData)), storage },
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(storage.calls.some((call) => call[0] === "delete-permanent"), false);
});

test("discard cannot race an in-flight promotion and may recover only after its lease expires", async () => {
  const promoting = await intent({
    status: "promoting",
    promotionStartedBy: "staff-1",
    promotionStartedAt: new Date("2026-08-10T10:00:00.000Z"),
    promotionLeaseExpiresAt: new Date("2026-08-10T10:15:00.000Z"),
  });
  const storage = fakeStorage({ missingPermanent: true });
  await assert.rejects(
    reconcileLabReportFinalization(
      env,
      {
        labOrderId: "lab-order-1",
        operation: "discard",
        discardReasonCode: "other_verified",
      },
      admin,
      {
        database: fakeDatabase(baseDocuments(promoting)),
        storage,
        now: new Date("2026-08-10T10:05:00.000Z"),
      },
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );

  const recovered = await reconcileLabReportFinalization(
    env,
    {
      labOrderId: "lab-order-1",
      operation: "discard",
      discardReasonCode: "other_verified",
    },
    admin,
    {
      database: fakeDatabase(baseDocuments(promoting)),
      storage: fakeStorage({ missingPermanent: true }),
      now: new Date("2026-08-10T10:16:00.000Z"),
    },
  );
  assert.equal(recovered.discarded, true);
});

test("a claimed discard can finish idempotently after the exact object is already gone", async () => {
  const intentData = await intent({
    status: "discarding",
    discardGeneration: "72",
    discardObjectWasPresent: true,
    discardReasonCode: "wrong_file",
    discardRequestedBy: "admin-1",
    discardRequestedAt: new Date("2026-08-10T10:00:00.000Z"),
  });
  const database = fakeDatabase(baseDocuments(intentData));
  const storage = fakeStorage({ missingPermanent: true });
  const result = await reconcileLabReportFinalization(
    env,
    {
      labOrderId: "lab-order-1",
      operation: "discard",
      discardReasonCode: "wrong_file",
    },
    admin,
    { database, storage },
  );
  assert.equal(result.discarded, true);
  assert.ok(storage.calls.some((call) => call[0] === "delete-permanent" && call[2] === "72"));
});
