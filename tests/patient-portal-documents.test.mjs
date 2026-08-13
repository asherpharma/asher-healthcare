import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/razorpay/http.js";
import { recordPortalDocumentAccess } from "../server/patients/portal-document-access.js";
import { recordPortalReportAccess } from "../server/patients/portal-report-access.js";

const updateTime = "2026-08-13T10:00:00.000000Z";
const doc = (data) => ({ data, updateTime });
const account = { uid: "account-A", email: "a@example.test", authenticationTime: Date.now() };
const grant = (scope) => ({ id: "grant-A", data: { patientId: "patient-A", status: "active", scopes: [scope] }, updateTime });
function db(documents) { const commits = []; return { commits, async getDocument(_e, path) { return documents[path] || null; }, verifyDocumentWrite(_e, path) { return { verify: path }; }, createDocumentWrite(_e, path, data) { return { create: path, data }; }, async commitWrites(_e, writes) { commits.push(writes); } }; }
function base(scope) { return { "patientAccounts/account-A": doc({ uid: "account-A", email: "a@example.test", status: "active" }), "patientAccounts/account-A/grants/grant-A": grant(scope), "patients/patient-A": doc({}) }; }

test("exact prescription access is audited and returns only the document payload", async () => {
  const database = db({ ...base("prescriptions"), "patients/patient-A/prescriptions/rx-1": doc({ doctorName: "Doctor", medicines: [{ name: "Medicine" }] }) });
  const result = await recordPortalDocumentAccess({}, { patientId: "patient-A", documentId: "rx-1", documentType: "prescription", action: "download" }, account, { database, grantAuthorizer: async () => grant("prescriptions") });
  assert.equal(result.document.medicines[0].name, "Medicine");
  assert.match(database.commits[0].at(-1).data.eventType, /download_authorized$/u);
});

test("account A cannot obtain patient B receipt or cross-patient report path", async () => {
  const receiptDatabase = db({ ...base("billing"), "invoices/invoice-B": doc({ patientId: "patient-B" }) });
  await assert.rejects(recordPortalDocumentAccess({}, { patientId: "patient-A", documentId: "invoice-B", documentType: "receipt", action: "print" }, account, { database: receiptDatabase, grantAuthorizer: async () => grant("billing") }), (error) => error instanceof HttpError && error.status === 404);
  const reportDatabase = db({ ...base("reports"), "patients/patient-A/reports/report-B": doc({ storagePath: "reports/patient-B/report.pdf" }) });
  await assert.rejects(recordPortalReportAccess({}, { patientId: "patient-A", reportId: "report-B", action: "download" }, account, { database: reportDatabase, grantAuthorizer: async () => grant("reports") }));
  assert.equal(receiptDatabase.commits.length + reportDatabase.commits.length, 0);
});

test("revoked, expired, and stale-auth sessions cannot authorize a document", async () => {
  for (const grantData of [{ status: "revoked", scopes: ["prescriptions"] }, { status: "active", scopes: ["prescriptions"], expiresAt: "2020-01-01T00:00:00Z" }]) {
    const database = db({ ...base("prescriptions"), "patientAccounts/account-A/grants/grant-A": doc({ patientId: "patient-A", ...grantData }), "patients/patient-A/prescriptions/rx-1": doc({}) });
    await assert.rejects(recordPortalDocumentAccess({}, { patientId: "patient-A", documentId: "rx-1", documentType: "prescription", action: "download" }, account, { database, grantAuthorizer: async () => grant("prescriptions") }), (error) => error instanceof HttpError && error.status === 404);
  }
  const database = db({ ...base("prescriptions"), "patients/patient-A/prescriptions/rx-1": doc({}) });
  await assert.rejects(recordPortalDocumentAccess({}, { patientId: "patient-A", documentId: "rx-1", documentType: "prescription", action: "print" }, { ...account, authenticationTime: Date.now() - 31 * 60_000 }, { database, grantAuthorizer: async () => grant("prescriptions") }), (error) => error instanceof HttpError && error.status === 404);
});

test("report bytes reject view bypass and stale authentication", async () => {
  await assert.rejects(recordPortalReportAccess({}, { patientId: "patient-A", reportId: "report-1", action: "view" }, account), (error) => error instanceof HttpError && error.status === 404);
  const database = db({ ...base("reports"), "patients/patient-A/reports/report-1": doc({ storagePath: "reports/patient-A/report.pdf" }) });
  await assert.rejects(recordPortalReportAccess({}, { patientId: "patient-A", reportId: "report-1", action: "download" }, { ...account, authenticationTime: Date.now() - 31 * 60_000 }, { database, grantAuthorizer: async () => grant("reports") }), (error) => error instanceof HttpError && error.status === 404);
});

test("archiving a chart after grant creation blocks prescription and report access", async () => {
  const prescriptionDatabase = db({ ...base("prescriptions"), "patients/patient-A": doc({ archived: true }), "patients/patient-A/prescriptions/rx-1": doc({}) });
  await assert.rejects(recordPortalDocumentAccess({}, { patientId: "patient-A", documentId: "rx-1", documentType: "prescription", action: "download" }, account, { database: prescriptionDatabase, grantAuthorizer: async () => grant("prescriptions") }), (error) => error instanceof HttpError && error.status === 404);
  const reportDatabase = db({ ...base("reports"), "patients/patient-A": doc({ archived: true }), "patients/patient-A/reports/report-1": doc({ storagePath: "reports/patient-A/report.pdf" }) });
  await assert.rejects(recordPortalReportAccess({}, { patientId: "patient-A", reportId: "report-1", action: "download" }, account, { database: reportDatabase, grantAuthorizer: async () => grant("reports") }), (error) => error instanceof HttpError && error.status === 404);
});
