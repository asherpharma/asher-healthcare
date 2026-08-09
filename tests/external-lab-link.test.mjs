import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAyusLinkAccess,
  linkAyusLabNumber,
  normalizeAyusLabNumber,
  normalizeAyusLinkRequest,
  readAyusLabLink,
} from "../server/labs/ayus-link.js";
import { HttpError } from "../server/razorpay/http.js";
import { publicExternalLabProvider } from "../server/labs/providers.js";

const env = { FIREBASE_PROJECT_ID: "asher-healthcare-test" };
const updateTime = "2026-08-09T10:15:30.123456Z";

function activeStaff(overrides = {}) {
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
      doctorId: "obg",
      doctorName: "Dr. Shaik Reshma",
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
    async commitWrites(_env, writes) {
      commits.push(writes);
      return {};
    },
  };
}

async function referencePath(ayusLabNumber) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `asher-external-lab-reference-v1\nayuslab\n${normalizeAyusLabNumber(ayusLabNumber)}`,
    ),
  );
  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `externalLabReferenceKeys/${hex}`;
}

async function linkedReferenceFixture(ayusLabNumber, overrides = {}) {
  const path = await referencePath(ayusLabNumber);
  const digest = path.split("/").at(-1);
  return {
    path,
    link: {
      data: {
        providerId: "ayuslab",
        workflowMode: "manual_portal",
        labOrderId: "lab-order-1",
        patientId: "patient-1",
        providerLabNumber: ayusLabNumber,
        referenceFingerprint: digest.slice(0, 16),
        status: "linked",
        version: 1,
        ...overrides,
      },
      updateTime,
    },
    reservation: {
      data: {
        providerId: "ayuslab",
        externalLabLinkId: "ayuslab_lab-order-1",
        labOrderId: "lab-order-1",
      },
      updateTime,
    },
  };
}

test("publishes only non-secret AyusLab provider metadata", () => {
  const provider = publicExternalLabProvider("ayuslab");
  assert.deepEqual(provider.capabilities, {
    portalLaunch: true,
    statusLookup: false,
    reportFetch: false,
    signedWebhooks: false,
  });
  assert.equal(provider.portalLoginUrl, "https://ayuslab.com/users/sign_in");
  assert.equal(provider.portalReportsUrl, "https://ayuslab.com/report_viewer/reports");
  const serialized = JSON.stringify(provider).toLowerCase();
  for (const forbidden of ["password", "api_key", "secret", "cookie", "token"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("normalizes a human-entered Ayus Lab No without accepting unsafe characters", () => {
  assert.equal(normalizeAyusLabNumber("  blu 11267/alcds  "), "BLU 11267/ALCDS");
  assert.deepEqual(normalizeAyusLinkRequest({
    labOrderId: "lab-order-1",
    ayusLabNumber: " ay-2026_1001 ",
  }), {
    labOrderId: "lab-order-1",
    ayusLabNumber: "AY-2026_1001",
    replacementReason: "",
  });
  for (const value of ["", "A", "#123", "AYUS?123", "AYUS\n123"]) {
    assert.throws(
      () => normalizeAyusLabNumber(value),
      (error) => error instanceof HttpError && error.status === 400,
    );
  }
});

test("requires an explicit operator grant and enforces current patient assignment", () => {
  const matchingPatient = patient().data;
  assert.equal(assertAyusLinkAccess({
    role: "doctor",
    doctorName: "Dr. Shaik Reshma",
    labReportOperator: true,
  }, matchingPatient).role, "doctor");
  assert.equal(assertAyusLinkAccess({ role: "admin" }, matchingPatient).role, "admin");
  assert.equal(assertAyusLinkAccess({
    role: "reception",
    labReportOperator: true,
  }, matchingPatient).role, "reception");

  assert.throws(
    () => assertAyusLinkAccess({
      role: "doctor",
      doctorName: "Dr. Shaik Reshma",
      labReportOperator: false,
    }, matchingPatient),
    (error) => error instanceof HttpError && error.status === 403,
  );
  assert.throws(
    () => assertAyusLinkAccess({
      role: "reception",
      labReportOperator: false,
    }, matchingPatient),
    (error) => error instanceof HttpError && error.status === 403,
  );
  assert.throws(
    () => assertAyusLinkAccess({
      role: "doctor",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      labReportOperator: true,
    }, matchingPatient),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test("creates a private link, a uniqueness reservation, and a redacted audit atomically", async () => {
  const database = fakeDatabase({
    "staff/doctor-1": activeStaff(),
    "labOrders/lab-order-1": order(),
    "patients/patient-1": patient(),
  });
  const result = await linkAyusLabNumber(env, {
    labOrderId: "lab-order-1",
    ayusLabNumber: "BLU-11267",
  }, {
    uid: "doctor-1",
    role: "doctor",
    displayName: "Dr. Shaik Reshma",
  }, database);

  assert.equal(result.link.ayusLabNumber, "BLU-11267");
  assert.equal(result.alreadyLinked, false);
  assert.equal(database.commits.length, 1);
  const writes = database.commits[0];
  const createNames = writes
    .filter((write) => write.update && write.currentDocument?.exists === false)
    .map((write) => write.update.name);
  assert.ok(createNames.some((name) => name.includes("/externalLabReferenceKeys/")));
  assert.ok(createNames.some((name) => name.endsWith("/externalLabLinks/ayuslab_lab-order-1")));
  assert.ok(createNames.some((name) => name.includes("/auditLogs/")));
  assert.ok(writes.some((write) => (
    write.verify?.endsWith("/patients/patient-1/reports/lab-lab-order-1")
    && write.currentDocument?.exists === false
  )));
  assert.ok(writes.some((write) => (
    write.verify?.endsWith("/patients/patient-1/reports/lab-order-1")
    && write.currentDocument?.exists === false
  )));

  const auditWrite = writes.find((write) => write.update?.name.includes("/auditLogs/"));
  const auditJson = JSON.stringify(auditWrite);
  assert.equal(auditJson.includes("BLU-11267"), false);
  assert.equal(auditJson.toLowerCase().includes("password"), false);
  assert.equal(auditJson.toLowerCase().includes("cookie"), false);
});

test("an identical retry is idempotent and does not append a second audit", async () => {
  const existing = await linkedReferenceFixture("BLU-11267");
  const database = fakeDatabase({
    "staff/doctor-1": activeStaff(),
    "labOrders/lab-order-1": order({
      status: "completed",
      reportFileName: "lab-report.pdf",
      reportStoragePath: "reports/patient-1/lab-order-1.pdf",
      reportContentType: "application/pdf",
      reportSize: 1024,
    }),
    "patients/patient-1": patient(),
    "externalLabLinks/ayuslab_lab-order-1": existing.link,
    [existing.path]: existing.reservation,
  });
  const result = await linkAyusLabNumber(env, {
    labOrderId: "lab-order-1",
    ayusLabNumber: "blu-11267",
  }, { uid: "doctor-1", role: "doctor" }, database);
  assert.equal(result.alreadyLinked, true);
  assert.equal(database.commits.length, 0);
});

test("an identical retry rejects a broken link fingerprint or uniqueness reservation", async () => {
  const existing = await linkedReferenceFixture("BLU-11267");
  for (const documents of [
    {
      "externalLabLinks/ayuslab_lab-order-1": existing.link,
    },
    {
      "externalLabLinks/ayuslab_lab-order-1": {
        ...existing.link,
        data: { ...existing.link.data, referenceFingerprint: "incorrect" },
      },
      [existing.path]: existing.reservation,
    },
    {
      "externalLabLinks/ayuslab_lab-order-1": existing.link,
      [existing.path]: {
        ...existing.reservation,
        data: { ...existing.reservation.data, labOrderId: "lab-order-2" },
      },
    },
  ]) {
    const database = fakeDatabase({
      "staff/doctor-1": activeStaff(),
      "labOrders/lab-order-1": order(),
      "patients/patient-1": patient(),
      ...documents,
    });
    await assert.rejects(
      linkAyusLabNumber(env, {
        labOrderId: "lab-order-1",
        ayusLabNumber: "BLU-11267",
      }, { uid: "doctor-1", role: "doctor" }, database),
      (error) => error instanceof HttpError && error.status === 409,
    );
    assert.equal(database.commits.length, 0);
  }
});

test("blocks first linkage and replacement after an immutable report is attached", async () => {
  const oldReference = await linkedReferenceFixture("OLD-100", {
    linkedBy: "doctor-1",
    linkedAt: "2026-08-08T10:00:00.000Z",
  });
  const attachedOrder = order({
    status: "completed",
    reportFileName: "lab-report.pdf",
    reportStoragePath: "reports/patient-1/lab-order-1.pdf",
    reportContentType: "application/pdf",
    reportSize: 1024,
  });
  const cases = [
    {
      body: { labOrderId: "lab-order-1", ayusLabNumber: "NEW-200" },
      documents: { "labOrders/lab-order-1": attachedOrder },
    },
    {
      body: {
        labOrderId: "lab-order-1",
        ayusLabNumber: "NEW-200",
        replacementReason: "Corrected transcription from the printed slip",
      },
      documents: {
        "labOrders/lab-order-1": attachedOrder,
        "externalLabLinks/ayuslab_lab-order-1": oldReference.link,
        [oldReference.path]: oldReference.reservation,
      },
    },
    {
      body: { labOrderId: "lab-order-1", ayusLabNumber: "NEW-200" },
      documents: {
        "labOrders/lab-order-1": order({ status: "completed" }),
        "patients/patient-1/reports/lab-order-1": {
          data: { storagePath: "reports/patient-1/lab-order-1.pdf" },
          updateTime,
        },
      },
    },
    {
      body: { labOrderId: "lab-order-1", ayusLabNumber: "NEW-200" },
      documents: {
        "labOrders/lab-order-1": order({ status: "completed" }),
        "patients/patient-1/reports/lab-lab-order-1": {
          data: { storagePath: "lab-reports/patient-1/lab-order-1.pdf" },
          updateTime,
        },
      },
    },
  ];

  for (const entry of cases) {
    const database = fakeDatabase({
      "staff/admin-1": activeStaff({
        role: "admin",
        displayName: "Clinic Admin",
        doctorName: "",
      }),
      "patients/patient-1": patient(),
      ...entry.documents,
    });
    await assert.rejects(
      linkAyusLabNumber(
        env,
        entry.body,
        { uid: "admin-1", role: "admin", displayName: "Clinic Admin" },
        database,
      ),
      (error) => error instanceof HttpError
        && error.status === 409
        && /immutable report/iu.test(error.message),
    );
    assert.equal(database.commits.length, 0);
  }
});

test("blocks a Lab No reserved for a different Asher order", async () => {
  const duplicatePath = await referencePath("BLU-11267");
  const duplicateDatabase = fakeDatabase({
    "staff/doctor-1": activeStaff(),
    "labOrders/lab-order-1": order(),
    "patients/patient-1": patient(),
    [duplicatePath]: {
      data: {
        providerId: "ayuslab",
        externalLabLinkId: "ayuslab_lab-order-2",
        labOrderId: "lab-order-2",
      },
      updateTime,
    },
  });
  await assert.rejects(
    linkAyusLabNumber(env, {
      labOrderId: "lab-order-1",
      ayusLabNumber: "BLU-11267",
    }, { uid: "doctor-1", role: "doctor" }, duplicateDatabase),
    (error) => error instanceof HttpError && error.status === 409,
  );
  assert.equal(duplicateDatabase.commits.length, 0);
});

test("blocks cancelled orders, archived patients, and non-admin replacement", async () => {
  await assert.rejects(
    linkAyusLabNumber(env, {
      labOrderId: "lab-order-1",
      ayusLabNumber: "BLU-11267",
    }, { uid: "doctor-1", role: "doctor" }, fakeDatabase({
      "staff/doctor-1": activeStaff(),
      "labOrders/lab-order-1": order({ status: "cancelled" }),
    })),
    (error) => error instanceof HttpError && error.status === 409,
  );
  await assert.rejects(
    linkAyusLabNumber(env, {
      labOrderId: "lab-order-1",
      ayusLabNumber: "BLU-11267",
    }, { uid: "doctor-1", role: "doctor" }, fakeDatabase({
      "staff/doctor-1": activeStaff(),
      "labOrders/lab-order-1": order(),
      "patients/patient-1": patient({ archived: true }),
    })),
    (error) => error instanceof HttpError && error.status === 409,
  );
  await assert.rejects(
    linkAyusLabNumber(env, {
      labOrderId: "lab-order-1",
      ayusLabNumber: "NEW-100",
    }, { uid: "doctor-1", role: "doctor" }, fakeDatabase({
      "staff/doctor-1": activeStaff(),
      "labOrders/lab-order-1": order(),
      "patients/patient-1": patient(),
      "externalLabLinks/ayuslab_lab-order-1": {
        data: {
          providerId: "ayuslab",
          labOrderId: "lab-order-1",
          providerLabNumber: "OLD-100",
        },
        updateTime,
      },
    })),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test("an administrator can replace a reference with a redacted immutable audit", async () => {
  const oldReferencePath = await referencePath("OLD-100");
  const oldReferenceFingerprint = oldReferencePath.split("/").at(-1).slice(0, 16);
  const database = fakeDatabase({
    "staff/admin-1": activeStaff({
      role: "admin",
      displayName: "Clinic Admin",
      doctorName: "",
      labReportOperator: false,
    }),
    "labOrders/lab-order-1": order(),
    "patients/patient-1": patient(),
    "externalLabLinks/ayuslab_lab-order-1": {
      data: {
        providerId: "ayuslab",
        workflowMode: "manual_portal",
        labOrderId: "lab-order-1",
        patientId: "patient-1",
        providerLabNumber: "OLD-100",
        referenceFingerprint: oldReferenceFingerprint,
        status: "linked",
        version: 1,
        linkedBy: "doctor-1",
        linkedAt: "2026-08-08T10:00:00.000Z",
      },
      updateTime,
    },
    [oldReferencePath]: {
      data: {
        providerId: "ayuslab",
        externalLabLinkId: "ayuslab_lab-order-1",
        labOrderId: "lab-order-1",
      },
      updateTime,
    },
  });

  const result = await linkAyusLabNumber(env, {
    labOrderId: "lab-order-1",
    ayusLabNumber: "NEW-200",
    replacementReason: "Corrected transcription from the printed slip",
  }, { uid: "admin-1", role: "admin", displayName: "Clinic Admin" }, database);

  assert.equal(result.link.ayusLabNumber, "NEW-200");
  assert.equal(result.link.version, 2);
  const writes = database.commits[0];
  assert.ok(writes.some((write) => write.delete?.includes("/externalLabReferenceKeys/")));
  const linkWrite = writes.find((write) => (
    write.update?.name.endsWith("/externalLabLinks/ayuslab_lab-order-1")
  ));
  assert.equal(linkWrite.update.fields.providerLabNumber.stringValue, "NEW-200");
  assert.equal(linkWrite.update.fields.version.integerValue, "2");

  const auditWrite = writes.find((write) => write.update?.name.includes("/auditLogs/"));
  const auditJson = JSON.stringify(auditWrite);
  assert.ok(auditJson.includes("external_lab.reference_replaced"));
  assert.ok(auditJson.includes("administrator_correction"));
  assert.equal(auditJson.includes("Corrected transcription from the printed slip"), false);
  assert.equal(auditJson.includes("OLD-100"), false);
  assert.equal(auditJson.includes("NEW-200"), false);
});

test("Firestore rules explicitly deny browser access to external lab mappings", async () => {
  const { readFile } = await import("node:fs/promises");
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  for (const collection of ["externalLabLinks", "externalLabReferenceKeys"]) {
    const match = rules.match(new RegExp(
      `match /${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`,
      "u",
    ));
    assert.ok(match, `${collection} must have an explicit rules block`);
    assert.match(match[1], /allow read, create, update, delete: if false;/u);
  }
});

test("read API never exposes a link to an unassigned doctor", async () => {
  await assert.rejects(
    readAyusLabLink(env, "lab-order-1", { uid: "doctor-1" }, fakeDatabase({
      "staff/doctor-1": activeStaff({ doctorName: "Dr. Lt Col Shafi Ahamad" }),
      "labOrders/lab-order-1": order(),
      "patients/patient-1": patient(),
    })),
    (error) => error instanceof HttpError && error.status === 403,
  );
});

test("read API revalidates the active patient, order state, and link binding", async () => {
  const link = {
    data: {
      providerId: "ayuslab",
      labOrderId: "lab-order-1",
      patientId: "patient-1",
      providerLabNumber: "BLU-11267",
      version: 1,
    },
    updateTime,
  };
  const base = {
    "staff/doctor-1": activeStaff(),
    "labOrders/lab-order-1": order(),
    "patients/patient-1": patient(),
    "externalLabLinks/ayuslab_lab-order-1": link,
  };
  const result = await readAyusLabLink(
    env,
    "lab-order-1",
    { uid: "doctor-1", role: "doctor" },
    fakeDatabase(base),
  );
  assert.equal(result.link.ayusLabNumber, "BLU-11267");

  await assert.rejects(
    readAyusLabLink(env, "lab-order-1", { uid: "doctor-1" }, fakeDatabase({
      ...base,
      "labOrders/lab-order-1": order({ status: "cancelled" }),
    })),
    (error) => error instanceof HttpError && error.status === 409,
  );
  await assert.rejects(
    readAyusLabLink(env, "lab-order-1", { uid: "doctor-1" }, fakeDatabase({
      ...base,
      "patients/patient-1": patient({ archived: true }),
    })),
    (error) => error instanceof HttpError && error.status === 409,
  );
  await assert.rejects(
    readAyusLabLink(env, "lab-order-1", { uid: "doctor-1" }, fakeDatabase({
      ...base,
      "externalLabLinks/ayuslab_lab-order-1": {
        ...link,
        data: { ...link.data, patientId: "patient-2" },
      },
    })),
    (error) => error instanceof HttpError && error.status === 409,
  );
});
