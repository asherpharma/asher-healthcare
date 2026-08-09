import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLabReportFinalizationAccess,
  finalizeLabReport,
  normalizeLabReportFinalizationRequest,
  verifyReportBytes,
} from "../server/labs/finalize-report.js";
import { HttpError } from "../server/razorpay/http.js";
import {
  labReportDocumentId,
  labReportDocumentPath,
  labReportStoragePath,
  legacyLabReportDocumentPath,
} from "../server/labs/report-identity.js";

const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };
const updateTime = "2026-08-10T10:15:30.123456Z";
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function activeStaff(overrides = {}) {
  return {
    data: {
      active: true,
      role: "reception",
      displayName: "Reception",
      doctorName: "",
      labReportOperator: false,
      ...overrides,
    },
    updateTime,
  };
}

function order(overrides = {}) {
  return {
    data: {
      patientId: "patient-1",
      clinician: "Stale ordering clinician",
      status: "processing",
      ...overrides,
    },
    updateTime,
  };
}

function patient(overrides = {}) {
  return {
    data: {
      archived: false,
      doctorId: "pediatrics",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      ...overrides,
    },
    updateTime,
  };
}

function ayusLink(overrides = {}) {
  return {
    data: {
      providerId: "ayuslab",
      labOrderId: "lab-order-1",
      patientId: "patient-1",
      status: "linked",
      version: 3,
      ...overrides,
    },
    updateTime,
  };
}

function request(overrides = {}) {
  return {
    labOrderId: "lab-order-1",
    stagedStoragePath: "pending-reports/patient-1/7ebf45a1-report.pdf",
    fileName: "lab-report.pdf",
    contentType: "application/pdf",
    size: pdfBytes.byteLength,
    sourceProvider: "manual",
    ...overrides,
  };
}

function fakeDatabase(documents, { failCommitNumber = 0 } = {}) {
  const commits = [];
  let revision = 0;
  return {
    commits,
    async getDocument(_env, path) {
      return documents[path] || null;
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
      if (failCommitNumber === commits.length) {
        failCommitNumber = 0;
        throw new Error("simulated interrupted database commit");
      }
      for (const write of writes) {
        if (write.kind === "create") {
          documents[write.path] = {
            data: { ...write.data },
            updateTime: `2026-08-10T10:16:${String(revision += 1).padStart(2, "0")}.000000Z`,
          };
        } else if (write.kind === "update") {
          const current = documents[write.path];
          if (current) {
            const nextData = { ...current.data };
            for (const field of write.fields) {
              if (Object.hasOwn(write.data, field)) nextData[field] = write.data[field];
              else delete nextData[field];
            }
            documents[write.path] = {
              data: nextData,
              updateTime: `2026-08-10T10:17:${String(revision += 1).padStart(2, "0")}.000000Z`,
            };
          }
        }
      }
      return {};
    },
  };
}

function fakeStorage(overrides = {}) {
  const calls = [];
  return {
    calls,
    async fetchStagedReportObject(_env, path) {
      calls.push(["fetch", path]);
      return {
        bytes: pdfBytes,
        size: pdfBytes.byteLength,
        contentType: "application/pdf",
        generation: "71",
        metadata: {
          patientId: "patient-1",
          labOrderId: "lab-order-1",
          uploadedBy: "staff-1",
        },
        ...overrides.staged,
      };
    },
    async fetchImmutableReportObject(_env, path) {
      calls.push(["fetch-permanent", path]);
      if (!overrides.discardedPermanentPresent) {
        throw new HttpError(404, "missing");
      }
      const bytes = overrides.discardedPermanentBytes || pdfBytes;
      return {
        bytes,
        size: bytes.byteLength,
        contentType: "application/pdf",
        generation: "70",
      };
    },
    async createImmutableReportObject(_env, path, object) {
      calls.push(["create", path, object]);
      return { generation: "72", created: true };
    },
    async deleteStagedReportObject(_env, path, generation) {
      calls.push(["delete", path, generation]);
      if (overrides.cleanupError) throw new Error("cleanup unavailable");
      return true;
    },
  };
}

function baseDocuments(staffOverrides = {}, patientOverrides = {}) {
  return {
    "staff/staff-1": activeStaff(staffOverrides),
    "labOrders/lab-order-1": order(),
    "patients/patient-1": patient(patientOverrides),
  };
}

function discardedIntent(overrides = {}) {
  return {
    schemaVersion: 1,
    attemptNumber: 1,
    status: "discarded",
    labOrderId: "lab-order-1",
    patientId: "patient-1",
    stagedStoragePath: "pending-reports/patient-1/oldreport-report.pdf",
    stagedGeneration: "69",
    destinationPath: "lab-reports/patient-1/lab-order-1.pdf",
    fileName: "lab-report.pdf",
    contentType: "application/pdf",
    size: pdfBytes.byteLength,
    sourceProvider: "manual",
    externalLinkVersion: 0,
    resultSummary: "",
    uploadedBy: "staff-1",
    preparedBy: "staff-1",
    preparedByRole: "reception",
    contentSha256: "a".repeat(64),
    requestFingerprint: "b".repeat(64),
    preparedAt: new Date("2026-08-10T08:00:00.000Z"),
    promotionStartedBy: "staff-1",
    promotionStartedAt: new Date("2026-08-10T08:01:00.000Z"),
    promotionLeaseExpiresAt: new Date("2026-08-10T08:16:00.000Z"),
    permanentGeneration: "70",
    promotedBy: "staff-1",
    promotedAt: new Date("2026-08-10T08:02:00.000Z"),
    discardGeneration: "70",
    discardObjectWasPresent: true,
    discardReasonCode: "wrong_file",
    discardRequestedBy: "admin-1",
    discardRequestedAt: new Date("2026-08-10T08:03:00.000Z"),
    discardedBy: "admin-1",
    discardedAt: new Date("2026-08-10T08:04:00.000Z"),
    updatedAt: new Date("2026-08-10T08:04:00.000Z"),
    ...overrides,
  };
}

test("reserves collision-resistant document IDs and a server-only object namespace", () => {
  assert.equal(labReportDocumentId("lab-order-1"), "lab-lab-order-1");
  assert.equal(
    labReportDocumentPath("patient-1", "lab-order-1"),
    "patients/patient-1/reports/lab-lab-order-1",
  );
  assert.equal(
    legacyLabReportDocumentPath("patient-1", "lab-order-1"),
    "patients/patient-1/reports/lab-order-1",
  );
  assert.equal(
    labReportStoragePath("patient-1", "lab-order-1", "pdf"),
    "lab-reports/patient-1/lab-order-1.pdf",
  );
  assert.throws(
    () => labReportStoragePath("patient-1", "lab-order-1", "exe"),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("normalizes only opaque staged paths, generic names, supported types, and bounded size", () => {
  assert.deepEqual(normalizeLabReportFinalizationRequest(request()), {
    labOrderId: "lab-order-1",
    stagedStoragePath: "pending-reports/patient-1/7ebf45a1-report.pdf",
    fileName: "lab-report.pdf",
    contentType: "application/pdf",
    extension: "pdf",
    size: pdfBytes.byteLength,
    sourceProvider: "manual",
    externalLinkVersion: null,
    resultSummary: "",
  });
  for (const unsafe of [
    request({ stagedStoragePath: "reports/patient-1/report.pdf" }),
    request({ stagedStoragePath: "pending-reports/patient-1/../report.pdf" }),
    request({ fileName: "Jane-Doe-blood-report.pdf" }),
    request({ sourceProvider: "manual", externalLinkVersion: 1 }),
    request({ sourceProvider: "ayuslab" }),
    request({ size: 10 * 1024 * 1024 + 1 }),
  ]) {
    assert.throws(
      () => normalizeLabReportFinalizationRequest(unsafe),
      (error) => error instanceof HttpError && error.status === 400,
    );
  }
});

test("validates PDF, JPEG, PNG, and WebP magic bytes against the declared MIME", () => {
  assert.equal(verifyReportBytes(pdfBytes, "application/pdf"), pdfBytes);
  assert.doesNotThrow(() => verifyReportBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"));
  assert.doesNotThrow(() => verifyReportBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"));
  assert.doesNotThrow(() => verifyReportBytes(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"));
  assert.throws(
    () => verifyReportBytes(new TextEncoder().encode("not a pdf"), "application/pdf"),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("authorizes operational reception and the current patient doctor, not a stale order clinician", () => {
  assert.equal(assertLabReportFinalizationAccess(
    { role: "reception", labReportOperator: false }, patient().data, "manual",
  ).role, "reception");
  assert.equal(assertLabReportFinalizationAccess({
    role: "doctor",
    doctorName: "Dr. Lt Col Shafi Ahamad",
    labReportOperator: false,
  }, patient().data, "manual").role, "doctor");
  assert.throws(
    () => assertLabReportFinalizationAccess({
      role: "doctor",
      doctorName: "Dr. Shaik Reshma",
      labReportOperator: true,
    }, patient().data, "manual"),
    (error) => error instanceof HttpError && error.status === 403,
  );
  assert.throws(
    () => assertLabReportFinalizationAccess({
      role: "reception",
      labReportOperator: false,
    }, patient().data, "ayuslab"),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test("promotes a validated manual report and atomically binds order, report, and audit", async () => {
  const database = fakeDatabase(baseDocuments());
  const storage = fakeStorage();
  const result = await finalizeLabReport(
    env,
    request(),
    { uid: "staff-1", role: "reception" },
    { database, storage, now: new Date("2026-08-10T09:30:00.000Z") },
  );

  assert.equal(result.finalized, true);
  assert.equal(result.reportId, "lab-lab-order-1");
  assert.deepEqual(storage.calls.map((call) => call[0]), ["fetch", "create", "delete"]);
  assert.equal(storage.calls[1][1], "lab-reports/patient-1/lab-order-1.pdf");
  assert.equal(database.commits.length, 4);
  const preparationWrites = database.commits[0];
  const promotionWrites = database.commits[1];
  const promotedWrites = database.commits[2];
  const writes = database.commits[3];
  const intentWrite = preparationWrites.find((write) => (
    write.path === "labReportFinalizationIntents/lab-order-1"
  ));
  const reportWrite = writes.find((write) => write.path === "patients/patient-1/reports/lab-lab-order-1");
  const orderWrite = writes.find((write) => write.kind === "update" && write.path === "labOrders/lab-order-1");
  const auditWrite = writes.find((write) => write.path?.startsWith("auditLogs/"));
  assert.equal(reportWrite.data.storagePath, "lab-reports/patient-1/lab-order-1.pdf");
  assert.equal(reportWrite.data.fileName, "lab-report.pdf");
  assert.equal(orderWrite.data.status, "completed");
  assert.equal(orderWrite.updateTime, updateTime);
  assert.equal(intentWrite.data.status, "prepared");
  assert.equal(intentWrite.data.uploadedBy, "staff-1");
  assert.match(intentWrite.data.contentSha256, /^[a-f0-9]{64}$/u);
  assert.match(intentWrite.data.requestFingerprint, /^[a-f0-9]{64}$/u);
  assert.ok(promotionWrites.some((write) => (
    write.kind === "update"
    && write.path === "labReportFinalizationIntents/lab-order-1"
    && write.data.status === "promoting"
  )));
  assert.ok(promotedWrites.some((write) => (
    write.kind === "update"
    && write.path === "labReportFinalizationIntents/lab-order-1"
    && write.data.status === "promoted"
    && write.data.permanentGeneration === "72"
  )));
  assert.ok(writes.some((write) => (
    write.kind === "update"
    && write.path === "labReportFinalizationIntents/lab-order-1"
    && write.data.status === "completed"
    && write.data.permanentGeneration === "72"
  )));
  assert.equal(auditWrite.data.eventType, "lab_report.finalized");
  assert.equal(auditWrite.data.uploadedBy, "staff-1");
  assert.equal(auditWrite.data.finalizedBy, "staff-1");
  assert.equal(auditWrite.data.adminHandoff, false);
  const auditJson = JSON.stringify(auditWrite.data).toLowerCase();
  for (const forbidden of ["pending-reports", "providerlabnumber", "password", "cookie", "token"]) {
    assert.equal(auditJson.includes(forbidden), false);
  }
});

test("only an administrator can finalize another staff member's staged report", async () => {
  const otherStaffStorage = fakeStorage({
    staged: {
      metadata: {
        patientId: "patient-1",
        labOrderId: "lab-order-1",
        uploadedBy: "staff-2",
      },
    },
  });
  await assert.rejects(
    finalizeLabReport(
      env,
      request(),
      { uid: "staff-1", role: "reception" },
      { database: fakeDatabase(baseDocuments()), storage: otherStaffStorage },
    ),
    (error) => error instanceof HttpError && error.status === 403,
  );

  const adminDocuments = baseDocuments({
    role: "admin",
    displayName: "Clinic administrator",
  });
  const adminDatabase = fakeDatabase(adminDocuments);
  await finalizeLabReport(
    env,
    request(),
    { uid: "staff-1", role: "admin" },
    { database: adminDatabase, storage: otherStaffStorage },
  );
  const auditWrite = adminDatabase.commits.at(-1).find((write) => write.path?.startsWith("auditLogs/"));
  assert.equal(auditWrite.data.uploadedBy, "staff-2");
  assert.equal(auditWrite.data.finalizedBy, "staff-1");
  assert.equal(auditWrite.data.adminHandoff, true);
});

test("Ayus finalization requires the exact current link and its update-time precondition", async () => {
  const documents = baseDocuments({ labReportOperator: true });
  documents["externalLabLinks/ayuslab_lab-order-1"] = ayusLink();
  const database = fakeDatabase(documents);
  await finalizeLabReport(
    env,
    request({ sourceProvider: "ayuslab", externalLinkVersion: 3 }),
    { uid: "staff-1", role: "reception" },
    { database, storage: fakeStorage() },
  );
  assert.ok(database.commits[0].some((write) => (
    write.kind === "verify"
    && write.path === "externalLabLinks/ayuslab_lab-order-1"
    && write.updateTime === updateTime
  )));

  await assert.rejects(
    finalizeLabReport(
      env,
      request({ sourceProvider: "ayuslab", externalLinkVersion: 2 }),
      { uid: "staff-1", role: "reception" },
      { database: fakeDatabase(documents), storage: fakeStorage() },
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("rejects cross-patient staging, existing reports, cancelled orders, metadata drift, and bad bytes", async () => {
  const cases = [
    [request({ stagedStoragePath: "pending-reports/patient-2/7ebf45a1-report.pdf" }), baseDocuments(), fakeStorage()],
    [request(), { ...baseDocuments(), "patients/patient-1/reports/lab-lab-order-1": { data: {}, updateTime } }, fakeStorage()],
    [request(), { ...baseDocuments(), "patients/patient-1/reports/lab-order-1": { data: {}, updateTime } }, fakeStorage()],
    [request(), { ...baseDocuments(), "labOrders/lab-order-1": order({ status: "cancelled" }) }, fakeStorage()],
    [request(), baseDocuments(), fakeStorage({ staged: { size: 99 } })],
    [request(), baseDocuments(), fakeStorage({ staged: { metadata: {
      patientId: "patient-1",
      labOrderId: "another-order",
      uploadedBy: "staff-1",
    } } })],
    [request(), baseDocuments(), fakeStorage({ staged: { bytes: new TextEncoder().encode("not pdf") } })],
  ];
  for (const [body, documents, storage] of cases) {
    const database = fakeDatabase(documents);
    await assert.rejects(
      finalizeLabReport(
        env,
        body,
        { uid: "staff-1", role: "reception" },
        { database, storage },
      ),
      (error) => error instanceof HttpError && error.status === 409,
    );
    assert.equal(database.commits.length, 0);
  }
});

test("reopens an audited discarded attempt and finalizes a newly staged different file", async () => {
  const documents = baseDocuments();
  documents["labReportFinalizationIntents/lab-order-1"] = {
    data: discardedIntent(),
    updateTime,
  };
  documents["auditLogs/prior-discard"] = {
    data: { eventType: "lab_report.finalization_discarded", finalizationAttemptNumber: 1 },
    updateTime,
  };
  const newBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32, 0x2e, 0x30]);
  const storage = fakeStorage({
    staged: { bytes: newBytes, size: newBytes.byteLength, generation: "71" },
  });
  const database = fakeDatabase(documents);

  const result = await finalizeLabReport(
    env,
    request({ size: newBytes.byteLength }),
    { uid: "staff-1", role: "reception" },
    { database, storage, now: new Date("2026-08-10T09:30:00.000Z") },
  );

  assert.equal(result.finalized, true);
  assert.equal(documents["auditLogs/prior-discard"].data.eventType, "lab_report.finalization_discarded");
  const reopenWrites = database.commits[0];
  const reopenIntent = reopenWrites.find((write) => (
    write.kind === "update"
    && write.path === "labReportFinalizationIntents/lab-order-1"
  ));
  const reopenAudit = reopenWrites.find((write) => (
    write.kind === "create"
    && write.path.startsWith("auditLogs/")
  ));
  assert.equal(reopenIntent.data.status, "prepared");
  assert.equal(reopenIntent.data.attemptNumber, 2);
  assert.equal(reopenIntent.data.stagedStoragePath, request().stagedStoragePath);
  assert.equal(reopenAudit.data.eventType, "lab_report.finalization_reopened");
  assert.equal(reopenAudit.data.previousAttemptNumber, 1);
  assert.equal(reopenAudit.data.nextAttemptNumber, 2);
  assert.ok(reopenWrites.some((write) => (
    write.currentDocument?.exists === false
    && write.verify?.endsWith("/patients/patient-1/reports/lab-lab-order-1")
  )));
  assert.ok(reopenWrites.some((write) => (
    write.currentDocument?.exists === false
    && write.verify?.endsWith("/patients/patient-1/reports/lab-order-1")
  )));
  for (const staleField of [
    "promotionStartedBy",
    "promotionStartedAt",
    "promotionLeaseExpiresAt",
    "permanentGeneration",
    "promotedBy",
    "promotedAt",
    "discardGeneration",
    "discardObjectWasPresent",
    "discardReasonCode",
    "discardRequestedBy",
    "discardRequestedAt",
    "discardedBy",
    "discardedAt",
  ]) {
    assert.equal(Object.hasOwn(reopenIntent.data, staleField), false, staleField);
    assert.equal(reopenIntent.fields.includes(staleField), true, staleField);
  }
  const reopened = documents["labReportFinalizationIntents/lab-order-1"].data;
  assert.equal(reopened.status, "completed");
  assert.equal(reopened.attemptNumber, 2);
  assert.deepEqual(storage.calls.map((call) => call[0]), [
    "fetch",
    "fetch-permanent",
    "create",
    "delete",
  ]);
});

test("does not reopen a discarded attempt until the exact old permanent object is absent", async () => {
  const documents = baseDocuments();
  documents["labReportFinalizationIntents/lab-order-1"] = {
    data: discardedIntent(),
    updateTime,
  };
  const database = fakeDatabase(documents);
  await assert.rejects(
    finalizeLabReport(
      env,
      request(),
      { uid: "staff-1", role: "reception" },
      { database, storage: fakeStorage({ discardedPermanentPresent: true }) },
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(database.commits.length, 0);
});

test("validates the new staging metadata and current Ayus link before reopening", async () => {
  const invalidStageDocuments = baseDocuments();
  invalidStageDocuments["labReportFinalizationIntents/lab-order-1"] = {
    data: discardedIntent(),
    updateTime,
  };
  const invalidStageDatabase = fakeDatabase(invalidStageDocuments);
  await assert.rejects(
    finalizeLabReport(
      env,
      request(),
      { uid: "staff-1", role: "reception" },
      {
        database: invalidStageDatabase,
        storage: fakeStorage({ staged: { metadata: {
          patientId: "patient-1",
          labOrderId: "another-order",
          uploadedBy: "staff-1",
        } } }),
      },
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(invalidStageDatabase.commits.length, 0);

  const missingLinkDocuments = baseDocuments({ labReportOperator: true });
  missingLinkDocuments["labReportFinalizationIntents/lab-order-1"] = {
    data: discardedIntent({
      sourceProvider: "ayuslab",
      externalLinkVersion: 2,
      discardReasonCode: "provider_link_changed",
    }),
    updateTime,
  };
  const missingLinkDatabase = fakeDatabase(missingLinkDocuments);
  await assert.rejects(
    finalizeLabReport(
      env,
      request({ sourceProvider: "ayuslab", externalLinkVersion: 3 }),
      { uid: "staff-1", role: "reception" },
      { database: missingLinkDatabase, storage: fakeStorage() },
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(missingLinkDatabase.commits.length, 0);
});

test("cleanup failure does not roll back an already committed permanent report", async () => {
  const database = fakeDatabase(baseDocuments());
  const result = await finalizeLabReport(
    env,
    request(),
    { uid: "staff-1", role: "reception" },
    { database, storage: fakeStorage({ cleanupError: true }) },
  );
  assert.equal(result.finalized, true);
  assert.equal(result.stagingCleaned, false);
  assert.equal(database.commits.length, 4);
});

test("an interrupted pointer commit leaves a durable intent and only the exact request can retry", async () => {
  const documents = baseDocuments();
  const database = fakeDatabase(documents, { failCommitNumber: 4 });
  const storage = fakeStorage();
  await assert.rejects(
    finalizeLabReport(
      env,
      request(),
      { uid: "staff-1", role: "reception" },
      { database, storage },
    ),
    /simulated interrupted database commit/u,
  );
  assert.equal(documents["labReportFinalizationIntents/lab-order-1"].data.status, "promoted");
  assert.equal(
    documents["labReportFinalizationIntents/lab-order-1"].data.permanentGeneration,
    "72",
  );
  assert.equal(documents["patients/patient-1/reports/lab-lab-order-1"], undefined);

  await assert.rejects(
    finalizeLabReport(
      env,
      request({ stagedStoragePath: "pending-reports/patient-1/another000-report.pdf" }),
      { uid: "staff-1", role: "reception" },
      { database, storage },
    ),
    (error) => error instanceof HttpError && error.status === 409,
  );

  const recovered = await finalizeLabReport(
    env,
    request(),
    { uid: "staff-1", role: "reception" },
    { database, storage },
  );
  assert.equal(recovered.finalized, true);
  assert.equal(documents["labReportFinalizationIntents/lab-order-1"].data.status, "completed");
  assert.equal(storage.calls.filter((call) => call[0] === "create").length, 2);
});

test("a current doctor can atomically save a bounded clinical summary but reception cannot", async () => {
  const doctorDocuments = baseDocuments({
    role: "doctor",
    displayName: "Dr. Lt Col Shafi Ahamad",
    doctorName: "Dr. Lt Col Shafi Ahamad",
  });
  const doctorDatabase = fakeDatabase(doctorDocuments);
  await finalizeLabReport(
    env,
    request({ resultSummary: "Reviewed: no critical abnormality." }),
    { uid: "staff-1", role: "doctor" },
    { database: doctorDatabase, storage: fakeStorage() },
  );
  const orderWrite = doctorDatabase.commits.at(-1).find((write) => (
    write.kind === "update" && write.path === "labOrders/lab-order-1"
  ));
  assert.equal(orderWrite.data.resultSummary, "Reviewed: no critical abnormality.");

  await assert.rejects(
    finalizeLabReport(
      env,
      request({ resultSummary: "Reception interpretation" }),
      { uid: "staff-1", role: "reception" },
      { database: fakeDatabase(baseDocuments()), storage: fakeStorage() },
    ),
    (error) => error instanceof HttpError && error.status === 403,
  );
  assert.throws(
    () => normalizeLabReportFinalizationRequest(request({ resultSummary: "x".repeat(5_001) })),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("Firestore rules reserve lab-linked report creation and order pointers for the trusted finalizer", async () => {
  const { readFile } = await import("node:fs/promises");
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /only the trusted[\s\S]*finalizer can bind immutable Storage metadata/u);
  assert.match(rules, /!reportKeys\.hasAny\(\['labOrderId'\]\)/u);
  const reportRules = rules.match(
    /match \/reports\/\{reportId\} \{([\s\S]*?)\n      \}/u,
  )?.[1] || "";
  assert.match(rules, /!reportId\.matches\('\^lab-\.\*'\)/u);
  assert.match(rules, /!exists\(\/databases\/\$\(database\)\/documents\/labOrders\/\$\(reportId\)\)/u);
  assert.match(
    rules,
    /match \/labReportFinalizationIntents\/\{intentId\} \{\s*allow read, create, update, delete: if false;/u,
  );
  assert.doesNotMatch(
    reportRules,
    /validReceptionLabReportCreate/u,
  );
});
