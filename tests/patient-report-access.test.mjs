import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPatientReportReadAccess,
  normalizePatientReportAccessRequest,
  recordPatientReportAccess,
} from "../server/patients/report-access.js";
import { HttpError } from "../server/razorpay/http.js";

const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };
const updateTime = "2026-08-10T10:15:30.123456Z";
const storagePath = "reports/patient-1/1750000000000-a1b2c3d4-report.pdf";

function document(data) {
  return { data, updateTime };
}

function fakeDatabase(documents) {
  const commits = [];
  return {
    commits,
    async getDocument(_env, path) {
      return documents[path] || null;
    },
    verifyDocumentWrite(_env, path, currentUpdateTime) {
      return { verify: path, currentDocument: { updateTime: currentUpdateTime } };
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

test("normalizes only valid generic report actions and document IDs", () => {
  assert.deepEqual(normalizePatientReportAccessRequest({
    patientId: "patient-1",
    reportId: "report-1",
    action: " PRINT ",
  }), {
    patientId: "patient-1",
    reportId: "report-1",
    action: "print",
  });
  for (const body of [
    { patientId: "../patient", reportId: "report-1", action: "view" },
    { patientId: "patient-1", reportId: "", action: "view" },
    { patientId: "patient-1", reportId: "report-1", action: "share" },
  ]) {
    assert.throws(
      () => normalizePatientReportAccessRequest(body),
      (error) => error instanceof HttpError && error.status === 400,
    );
  }
});

test("current patient assignment, including canonical legacy fallback, controls doctor access", () => {
  const doctor = { role: "doctor", doctorName: "Dr. Lt Col Shafi Ahamad" };
  assert.equal(assertPatientReportReadAccess(doctor, {
    doctorName: "Dr. Lt Col Shafi Ahamad",
    doctorId: "obg",
  }).role, "doctor");
  assert.equal(assertPatientReportReadAccess(doctor, {
    doctorName: "",
    doctorId: "pediatrics",
  }).role, "doctor");
  assert.throws(
    () => assertPatientReportReadAccess(doctor, {
      doctorName: "Dr. Shaik Reshma",
      doctorId: "pediatrics",
    }),
    (error) => error instanceof HttpError && error.status === 403,
  );
  assert.throws(
    () => assertPatientReportReadAccess({ role: "reception" }, {
      doctorName: "Dr. Lt Col Shafi Ahamad",
    }),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test("re-reads staff, patient, and report then appends one immutable redacted audit", async () => {
  const database = fakeDatabase({
    "staff/doctor-1": document({
      active: true,
      role: "doctor",
      displayName: "Pediatrician",
      doctorName: "Dr. Lt Col Shafi Ahamad",
    }),
    "patients/patient-1": document({
      archived: false,
      fullName: "Sensitive Patient",
      phone: "+919876543210",
      doctorName: "Dr. Lt Col Shafi Ahamad",
    }),
    "patients/patient-1/reports/report-1": document({
      storagePath,
      fileName: "sensitive-patient-name.pdf",
    }),
  });

  const result = await recordPatientReportAccess(env, {
    patientId: "patient-1",
    reportId: "report-1",
    action: "download",
  }, { uid: "doctor-1", role: "doctor" }, database);
  assert.deepEqual(result, {
    recorded: true,
    action: "download",
    patientId: "patient-1",
    storagePath,
  });
  assert.equal(database.commits.length, 1);
  const writes = database.commits[0];
  assert.deepEqual(writes.slice(0, 3).map((write) => write.verify), [
    "staff/doctor-1",
    "patients/patient-1",
    "patients/patient-1/reports/report-1",
  ]);
  const audit = writes[3];
  assert.match(audit.create, /^auditLogs\/[0-9a-f-]{36}$/u);
  assert.equal(audit.data.eventType, "patient_report.download_authorized");
  assert.equal(audit.data.outcome, "authorized");
  assert.doesNotMatch(audit.data.eventType, /(?:viewed|downloaded|printed)$/u);
  assert.equal(audit.data.patientId, "patient-1");
  assert.equal(audit.data.reportId, "report-1");
  assert.equal(audit.currentDocument.exists, false);

  const serialized = JSON.stringify(audit);
  for (const forbidden of [
    "Sensitive Patient",
    "+919876543210",
    "sensitive-patient-name.pdf",
    storagePath,
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("audit events describe authorization rather than claiming delivery completed", async () => {
  for (const [action, eventType] of Object.entries({
    view: "patient_report.view_authorized",
    download: "patient_report.download_authorized",
    print: "patient_report.print_authorized",
  })) {
    const database = fakeDatabase({
      "staff/admin-1": document({
        active: true,
        role: "admin",
        displayName: "Clinic administrator",
      }),
      "patients/patient-1": document({ archived: false }),
      "patients/patient-1/reports/report-1": document({ storagePath }),
    });
    await recordPatientReportAccess(env, {
      patientId: "patient-1",
      reportId: "report-1",
      action,
    }, { uid: "admin-1", role: "admin" }, database);

    const audit = database.commits[0].at(-1);
    assert.equal(audit.data.eventType, eventType);
    assert.equal(audit.data.action, action);
    assert.equal(audit.data.outcome, "authorized");
  }
});

test("blocks reception, reassigned doctors, archived charts, and cross-patient paths", async () => {
  const cases = [
    {
      staff: { role: "reception", doctorName: "" },
      patient: { doctorName: "Dr. Lt Col Shafi Ahamad" },
      reportPath: storagePath,
      status: 403,
    },
    {
      staff: { role: "doctor", doctorName: "Dr. Shaik Reshma" },
      patient: { doctorName: "Dr. Lt Col Shafi Ahamad" },
      reportPath: storagePath,
      status: 403,
    },
    {
      staff: { role: "doctor", doctorName: "Dr. Lt Col Shafi Ahamad" },
      patient: { doctorName: "Dr. Lt Col Shafi Ahamad", archived: true },
      reportPath: storagePath,
      status: 409,
    },
    {
      staff: { role: "doctor", doctorName: "Dr. Lt Col Shafi Ahamad" },
      patient: { doctorName: "Dr. Lt Col Shafi Ahamad" },
      reportPath: "reports/patient-2/1750000000000-a1b2c3d4-report.pdf",
      status: 409,
    },
    {
      staff: { role: "doctor", doctorName: "Dr. Lt Col Shafi Ahamad" },
      patient: { doctorName: "Dr. Lt Col Shafi Ahamad" },
      reportPath: "lab-reports/patient-1/lab-order-1.pdf",
      status: 409,
    },
  ];

  for (const item of cases) {
    const database = fakeDatabase({
      "staff/staff-1": document({
        active: true,
        displayName: "Clinic staff",
        ...item.staff,
      }),
      "patients/patient-1": document({ archived: false, ...item.patient }),
      "patients/patient-1/reports/report-1": document({ storagePath: item.reportPath }),
    });
    await assert.rejects(
      recordPatientReportAccess(env, {
        patientId: "patient-1",
        reportId: "report-1",
        action: "view",
      }, { uid: "staff-1", role: item.staff.role }, database),
      (error) => error instanceof HttpError && error.status === item.status,
    );
    assert.equal(database.commits.length, 0);
  }
});
