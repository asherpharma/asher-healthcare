import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLabReportReadAccess,
  normalizeLabReportAccessRequest,
  recordLabReportAccess,
} from "../server/labs/report-access.js";
import { HttpError } from "../server/razorpay/http.js";

const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };
const updateTime = "2026-08-09T10:15:30.123456Z";

function staff(overrides = {}) {
  return {
    data: {
      active: true,
      role: "doctor",
      displayName: "Dr. Shaik Reshma",
      doctorName: "Dr. Shaik Reshma",
      labReportOperator: true,
      ...overrides,
    },
    updateTime,
  };
}

function order(overrides = {}) {
  return {
    data: {
      patientId: "patient-1",
      clinician: "Dr. Shaik Reshma",
      status: "completed",
      reportStoragePath: "lab-reports/patient-1/opaque-report.pdf",
      ...overrides,
    },
    updateTime,
  };
}

function patient(overrides = {}) {
  return {
    data: {
      archived: false,
      doctorName: "Dr. Shaik Reshma",
      doctorId: "obg",
      ...overrides,
    },
    updateTime,
  };
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

test("accepts only supported report access actions and valid order IDs", () => {
  assert.deepEqual(normalizeLabReportAccessRequest({
    labOrderId: "lab-order-1",
    action: " PRINT ",
  }), {
    labOrderId: "lab-order-1",
    action: "print",
  });
  for (const body of [
    { labOrderId: "", action: "preview" },
    { labOrderId: "../order", action: "preview" },
    { labOrderId: "lab-order-1", action: "share" },
    { labOrderId: "lab-order-1", action: "" },
  ]) {
    assert.throws(
      () => normalizeLabReportAccessRequest(body),
      (error) => error instanceof HttpError && error.status === 400,
    );
  }
});

test("allows administrators, explicitly authorized lab operators, and the assigned doctor", () => {
  const matchingPatient = patient().data;
  assert.equal(assertLabReportReadAccess({ role: "admin" }, matchingPatient).role, "admin");
  assert.equal(assertLabReportReadAccess({
    role: "reception",
    labReportOperator: true,
  }, matchingPatient).role, "reception");
  assert.equal(assertLabReportReadAccess({
    role: "doctor",
    doctorName: "Dr. Shaik Reshma",
  }, matchingPatient).role, "doctor");

  for (const actor of [
    { role: "reception", labReportOperator: false },
    { role: "doctor", doctorName: "Dr. Lt Col Shafi Ahamad" },
    { role: "doctor", doctorName: "" },
  ]) {
    assert.throws(
      () => assertLabReportReadAccess(actor, matchingPatient),
      (error) => error instanceof HttpError && error.status === 403,
    );
  }
});

test("atomically verifies current staff, order, and patient before appending a redacted audit", async () => {
  for (const [action, eventType] of Object.entries({
    preview: "lab_report.preview_authorized",
    download: "lab_report.download_authorized",
    print: "lab_report.print_authorized",
  })) {
    const database = fakeDatabase({
      "staff/admin-1": staff({
        role: "admin",
        displayName: "Clinic Admin",
        doctorName: "",
      }),
      "labOrders/lab-order-1": order({
        providerLabNumber: "BLU-11267",
        patientPhone: "+919876543210",
        reportStoragePath: "lab-reports/patient-1/sensitive-patient-name.pdf",
      }),
      "patients/patient-1": patient({
        fullName: "Sensitive Patient",
        phone: "+919876543210",
      }),
    });

    const result = await recordLabReportAccess(env, {
      labOrderId: "lab-order-1",
      action,
    }, {
      uid: "admin-1",
      role: "admin",
      displayName: "Clinic Admin",
    }, database);

    assert.deepEqual(result, {
      recorded: true,
      action,
      patientId: "patient-1",
      storagePath: "lab-reports/patient-1/sensitive-patient-name.pdf",
    });
    assert.equal(database.commits.length, 1);
    const writes = database.commits[0];
    assert.deepEqual(
      writes.slice(0, 3).map((write) => write.verify),
      ["staff/admin-1", "labOrders/lab-order-1", "patients/patient-1"],
    );
    assert.ok(writes.slice(0, 3).every((write) => (
      write.currentDocument.updateTime === updateTime
    )));

    const audit = writes[3];
    assert.match(audit.create, /^auditLogs\/[0-9a-f-]{36}$/u);
    assert.equal(audit.data.eventType, eventType);
    assert.equal(audit.data.labOrderId, "lab-order-1");
    assert.equal(audit.data.patientId, "patient-1");
    assert.equal(audit.data.actorUid, "admin-1");
    assert.equal(audit.data.outcome, "authorized");
    assert.doesNotMatch(audit.data.eventType, /(?:viewed|previewed|downloaded|printed)$/u);
    assert.equal(audit.currentDocument.exists, false);

    const serialized = JSON.stringify(audit);
    for (const forbidden of [
      "BLU-11267",
      "+919876543210",
      "sensitive-patient-name.pdf",
      "lab-reports/patient-1/",
      "Sensitive Patient",
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  }
});

test("legacy lab report object pointers remain readable during namespace migration", async () => {
  const database = fakeDatabase({
    "staff/admin-1": staff({ role: "admin", doctorName: "" }),
    "labOrders/lab-order-1": order({
      reportStoragePath: "reports/patient-1/legacy-lab-report.pdf",
    }),
    "patients/patient-1": patient(),
  });
  const result = await recordLabReportAccess(env, {
    labOrderId: "lab-order-1",
    action: "preview",
  }, { uid: "admin-1", role: "admin" }, database);
  assert.equal(result.storagePath, "reports/patient-1/legacy-lab-report.pdf");
  assert.equal(database.commits.length, 1);
});

test("assigned doctor access succeeds without requiring the external portal operator grant", async () => {
  const database = fakeDatabase({
    "staff/doctor-1": staff({ labReportOperator: false }),
    "labOrders/lab-order-1": order(),
    "patients/patient-1": patient(),
  });
  await recordLabReportAccess(env, {
    labOrderId: "lab-order-1",
    action: "preview",
  }, {
    uid: "doctor-1",
    role: "doctor",
  }, database);
  assert.equal(database.commits.length, 1);
});

test("patient reassignment controls access even when the historical order clinician differs", async () => {
  const allowedDatabase = fakeDatabase({
    "staff/doctor-1": staff({ doctorName: "Dr. Lt Col Shafi Ahamad" }),
    "labOrders/lab-order-1": order({ clinician: "Dr. Shaik Reshma" }),
    "patients/patient-1": patient({
      doctorName: "Dr. Lt Col Shafi Ahamad",
      doctorId: "pediatrics",
    }),
  });
  await recordLabReportAccess(env, {
    labOrderId: "lab-order-1",
    action: "preview",
  }, { uid: "doctor-1", role: "doctor" }, allowedDatabase);
  assert.equal(allowedDatabase.commits.length, 1);

  const blockedDatabase = fakeDatabase({
    "staff/doctor-1": staff({ doctorName: "Dr. Shaik Reshma" }),
    "labOrders/lab-order-1": order({ clinician: "Dr. Shaik Reshma" }),
    "patients/patient-1": patient({
      doctorName: "Dr. Lt Col Shafi Ahamad",
      doctorId: "pediatrics",
    }),
  });
  await assert.rejects(
    recordLabReportAccess(env, {
      labOrderId: "lab-order-1",
      action: "preview",
    }, { uid: "doctor-1", role: "doctor" }, blockedDatabase),
    (error) => error instanceof HttpError && error.status === 403,
  );
  assert.equal(blockedDatabase.commits.length, 0);
});

test("re-reads staff authorization and blocks reception without a grant or an unassigned doctor", async () => {
  for (const [staffDocument, authenticatedStaff] of [
    [staff({ role: "reception", doctorName: "", labReportOperator: false }), {
      uid: "staff-1",
      role: "admin",
    }],
    [staff({ doctorName: "Dr. Lt Col Shafi Ahamad" }), {
      uid: "staff-1",
      role: "doctor",
    }],
  ]) {
    const database = fakeDatabase({
      "staff/staff-1": staffDocument,
      "labOrders/lab-order-1": order(),
      "patients/patient-1": patient(),
    });
    await assert.rejects(
      recordLabReportAccess(env, {
        labOrderId: "lab-order-1",
        action: "download",
      }, authenticatedStaff, database),
      (error) => error instanceof HttpError && error.status === 403,
    );
    assert.equal(database.commits.length, 0);
  }
});

test("an explicitly authorized reception lab operator can download an attached lab report", async () => {
  const database = fakeDatabase({
    "staff/reception-1": staff({
      role: "reception",
      displayName: "Lab desk",
      doctorName: "",
      labReportOperator: true,
    }),
    "labOrders/lab-order-1": order(),
    "patients/patient-1": patient(),
  });
  await recordLabReportAccess(env, {
    labOrderId: "lab-order-1",
    action: "download",
  }, {
    uid: "reception-1",
    role: "reception",
  }, database);
  assert.equal(database.commits.length, 1);
  const audit = database.commits[0].find((write) => write.create?.startsWith("auditLogs/"));
  assert.equal(audit.data.actorRole, "reception");
  assert.equal(audit.data.eventType, "lab_report.download_authorized");
});

test("blocks cancelled, unattached, mismatched-path, and archived reports", async () => {
  for (const [orderOverrides, patientOverrides] of [
    [{ status: "cancelled" }, {}],
    [{ reportStoragePath: "" }, {}],
    [{ reportStoragePath: "reports/another-patient/report.pdf" }, {}],
    [{}, { archived: true }],
  ]) {
    const database = fakeDatabase({
      "staff/admin-1": staff({ role: "admin", doctorName: "" }),
      "labOrders/lab-order-1": order(orderOverrides),
      "patients/patient-1": patient(patientOverrides),
    });
    await assert.rejects(
      recordLabReportAccess(env, {
        labOrderId: "lab-order-1",
        action: "print",
      }, { uid: "admin-1", role: "admin" }, database),
      (error) => error instanceof HttpError && error.status === 409,
    );
    assert.equal(database.commits.length, 0);
  }
});
