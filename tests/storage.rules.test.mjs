import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import {
  deleteObject,
  getBytes,
  getMetadata,
  listAll,
  ref,
  updateMetadata,
  uploadBytes,
} from "firebase/storage";

const PROJECT_ID = "asher-healthcare-rules-test";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199";
const [firestoreHost, firestorePortText] = FIRESTORE_HOST.split(":");
const [storageHost, storagePortText] = STORAGE_HOST.split(":");
const firestoreRules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const storageRules = readFileSync(new URL("../storage.rules", import.meta.url), "utf8");
const reportBytes = new TextEncoder().encode("rules-test-report");

const staff = {
  admin: {
    uid: "admin-1",
    record: { active: true, role: "admin", displayName: "Clinic Admin" },
  },
  reception: {
    uid: "reception-1",
    record: { active: true, role: "reception", displayName: "Reception Desk" },
  },
  receptionBackup: {
    uid: "reception-2",
    record: { active: true, role: "reception", displayName: "Backup Reception" },
  },
  pediatrics: {
    uid: "doctor-pediatrics",
    record: {
      active: true,
      role: "doctor",
      displayName: "Dr. Lt Col Shafi Ahamad",
      doctorName: "Dr. Lt Col Shafi Ahamad",
    },
  },
  obg: {
    uid: "doctor-obg",
    record: {
      active: true,
      role: "doctor",
      displayName: "Dr. Shaik Reshma",
      doctorName: "Dr. Shaik Reshma",
    },
  },
  inactive: {
    uid: "doctor-inactive",
    record: {
      active: false,
      role: "doctor",
      displayName: "Inactive Doctor",
      doctorName: "Dr. Lt Col Shafi Ahamad",
    },
  },
};

let testEnv;

function staffStorage(key) {
  return testEnv.authenticatedContext(staff[key].uid).storage();
}

function reportReference(storage, patientId, fileName = "1750000000000-report.pdf") {
  return ref(storage, `reports/${patientId}/${fileName}`);
}

function pendingReportReference(storage, patientId, fileName = "a1b2c3d4-report.pdf") {
  return ref(storage, `pending-reports/${patientId}/${fileName}`);
}

function labReportReference(storage, patientId, fileName = "lab-order-1.pdf") {
  return ref(storage, `lab-reports/${patientId}/${fileName}`);
}

function reportMetadata(key, patientId, extra = {}) {
  return {
    contentType: "application/pdf",
    customMetadata: {
      patientId,
      uploadedBy: staff[key].uid,
      ...extra,
    },
  };
}

async function seedDocuments(entries) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all(entries.map(([path, data]) => setDoc(doc(database, path), data)));
  });
}

async function seedReport(patientId, fileName = "1750000000000-report.pdf") {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(
      reportReference(context.storage(), patientId, fileName),
      reportBytes,
      {
        contentType: "application/pdf",
        customMetadata: { patientId, uploadedBy: staff.admin.uid },
      },
    );
  });
}

async function seedLabReport(patientId, fileName = "lab-order-1.pdf") {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(
      labReportReference(context.storage(), patientId, fileName),
      reportBytes,
      {
        contentType: "application/pdf",
        customMetadata: { patientId },
      },
    );
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: firestoreHost,
      port: Number(firestorePortText),
      rules: firestoreRules,
    },
    storage: {
      host: storageHost,
      port: Number(storagePortText),
      rules: storageRules,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnv.clearFirestore();
  await seedDocuments([
    ...Object.values(staff).map((member) => [`staff/${member.uid}`, member.record]),
    ["patients/patient-pediatrics", { fullName: "Pediatric Patient", doctorName: "Dr. Lt Col Shafi Ahamad" }],
    ["patients/patient-obg", { fullName: "OBG Patient", doctorName: "Dr. Shaik Reshma" }],
    ["patients/patient-unassigned", { fullName: "Unassigned Patient", doctorName: "" }],
    ["patients/patient-legacy-doctor-id", { fullName: "Legacy Pediatric Patient", doctorId: "pediatrics" }],
    ["patients/patient-empty-name-doctor-id", { fullName: "Empty Name Pediatric Patient", doctorName: "", doctorId: "pediatrics" }],
    ["patients/patient-name-precedence", { fullName: "Assigned by Name", doctorName: "Dr. Shaik Reshma", doctorId: "pediatrics" }],
    ["patients/patient-archived", { fullName: "Archived Patient", doctorName: "Dr. Lt Col Shafi Ahamad", archived: true }],
    ["labOrders/lab-pediatrics", { patientId: "patient-pediatrics", status: "processing" }],
    ["labOrders/lab-rollback", { patientId: "patient-pediatrics", status: "ordered" }],
    ["labOrders/lab-camera-upload", { patientId: "patient-pediatrics", status: "collected" }],
    ["labOrders/lab-archived", { patientId: "patient-archived", status: "processing" }],
    ["labOrders/lab-completed-open", { patientId: "patient-pediatrics", status: "completed" }],
    ["labOrders/lab-completed-attached", { patientId: "patient-pediatrics", status: "completed", reportStoragePath: "reports/patient-pediatrics/existing.pdf" }],
    ["labOrders/lab-cancelled", { patientId: "patient-pediatrics", status: "cancelled" }],
    ["labOrders/lab-active-partial", { patientId: "patient-pediatrics", status: "processing", reportSize: 2048 }],
    ["labOrders/lab-other-patient", { patientId: "patient-obg", status: "processing" }],
  ]);
});

after(async () => {
  await testEnv?.cleanup();
});

test("no browser role can create a permanent lab-linked report object", async () => {
  for (const [key, suffix] of [["admin", "admin"], ["reception", "reception"], ["pediatrics", "doctor"]]) {
    await assertFails(
      uploadBytes(
        reportReference(staffStorage(key), "patient-pediatrics", `1750000000000-${suffix}.pdf`),
        reportBytes,
        reportMetadata(key, "patient-pediatrics", { labOrderId: "lab-pediatrics" }),
      ),
    );
  }
});

test("the dedicated finalized-lab namespace is invisible and immutable to every browser role", async () => {
  await seedLabReport("patient-pediatrics");
  for (const key of ["admin", "reception", "pediatrics", "obg", "inactive"]) {
    const storage = staffStorage(key);
    const existing = labReportReference(storage, "patient-pediatrics");
    await assertFails(getBytes(existing));
    await assertFails(getMetadata(existing));
    await assertFails(deleteObject(existing));
    await assertFails(uploadBytes(
      labReportReference(storage, "patient-pediatrics", `${key}-collision.pdf`),
      reportBytes,
      reportMetadata(key, "patient-pediatrics"),
    ));
    await assertFails(listAll(ref(storage, "lab-reports/patient-pediatrics")));
  }
  const anonymous = testEnv.unauthenticatedContext().storage();
  await assertFails(getBytes(labReportReference(anonymous, "patient-pediatrics")));
});

test("reception cannot create a generic permanent clinical report", async () => {
  const storage = staffStorage("reception");
  await assertFails(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "1750000000012-unlinked.pdf"),
      reportBytes,
      reportMetadata("reception", "patient-pediatrics"),
    ),
  );
});

test("admin and the currently assigned doctor retain generic clinical report intake", async () => {
  await assertSucceeds(
    uploadBytes(
      reportReference(staffStorage("admin"), "patient-pediatrics", "1750000000001-admin.pdf"),
      reportBytes,
      reportMetadata("admin", "patient-pediatrics"),
    ),
  );
  await assertSucceeds(
    uploadBytes(
      reportReference(staffStorage("pediatrics"), "patient-pediatrics", "1750000000002-doctor.pdf"),
      reportBytes,
      reportMetadata("pediatrics", "patient-pediatrics"),
    ),
  );
  await assertFails(
    uploadBytes(
      reportReference(staffStorage("pediatrics"), "patient-obg", "1750000000003-wrong-doctor.pdf"),
      reportBytes,
      reportMetadata("pediatrics", "patient-obg"),
    ),
  );
});

test("pending report intake is create-only for operational staff with a matching open order", async () => {
  for (const [key, fileName] of [
    ["admin", "admin0001-report.pdf"],
    ["reception", "recept01-report.pdf"],
    ["pediatrics", "doctor001-report.pdf"],
  ]) {
    const storage = staffStorage(key);
    const reference = pendingReportReference(storage, "patient-pediatrics", fileName);
    await assertSucceeds(uploadBytes(
      reference,
      reportBytes,
      reportMetadata(key, "patient-pediatrics", { labOrderId: "lab-pediatrics" }),
    ));
    await assertFails(getBytes(reference));
    await assertFails(getMetadata(reference));
    await assertFails(updateMetadata(reference, { customMetadata: { changed: "true" } }));
    await assertFails(deleteObject(reference));
  }

  await assertFails(uploadBytes(
    pendingReportReference(staffStorage("obg"), "patient-pediatrics", "wrongdoc-report.pdf"),
    reportBytes,
    reportMetadata("obg", "patient-pediatrics", { labOrderId: "lab-pediatrics" }),
  ));
});

test("pending intake rejects missing, mismatched, closed, partial, archived, and identifying paths", async () => {
  const storage = staffStorage("reception");
  for (const [fileName, patientId, labOrderId] of [
    ["missing01-report.pdf", "patient-pediatrics", "missing-order"],
    ["otherpat-report.pdf", "patient-pediatrics", "lab-other-patient"],
    ["cancelled-report.pdf", "patient-pediatrics", "lab-cancelled"],
    ["attached1-report.pdf", "patient-pediatrics", "lab-completed-attached"],
    ["partial01-report.pdf", "patient-pediatrics", "lab-active-partial"],
    ["archived1-report.pdf", "patient-archived", "lab-archived"],
    ["Jane-Doe-blood-test.pdf", "patient-pediatrics", "lab-pediatrics"],
  ]) {
    await assertFails(uploadBytes(
      pendingReportReference(storage, patientId, fileName),
      reportBytes,
      reportMetadata("reception", patientId, { labOrderId }),
    ));
  }
});

test("no browser role can delete a permanent lab report created by the finalizer", async () => {
  const fileName = "lab-pediatrics.pdf";
  await seedReport("patient-pediatrics", fileName);
  for (const key of ["admin", "reception", "receptionBackup", "pediatrics"]) {
    await assertFails(deleteObject(
      reportReference(staffStorage(key), "patient-pediatrics", fileName),
    ));
  }
});

test("an assigned doctor cannot delete their own newly uploaded general report", async () => {
  const storage = staffStorage("pediatrics");
  const reference = reportReference(storage, "patient-pediatrics", "1750000000013-doctor-rollback.pdf");
  await assertSucceeds(
    uploadBytes(
      reference,
      reportBytes,
      reportMetadata("pediatrics", "patient-pediatrics"),
    ),
  );
  await assertFails(deleteObject(reference));
});

test("generic clinical report names require the client-normalized lowercase extension", async () => {
  const storage = staffStorage("admin");
  const metadata = {
    contentType: "image/jpeg",
    customMetadata: {
      patientId: "patient-pediatrics",
      uploadedBy: staff.admin.uid,
    },
  };

  await assertFails(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "1750000000009-camera.JPG"),
      reportBytes,
      metadata,
    ),
  );
  await assertSucceeds(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "1750000000010-camera.jpg"),
      reportBytes,
      metadata,
    ),
  );
});

test("generic clinical report creation rejects a missing patient, forged uploader, and unsafe file", async () => {
  const storage = staffStorage("admin");
  await assertFails(
    uploadBytes(
      reportReference(storage, "missing-patient"),
      reportBytes,
      reportMetadata("admin", "missing-patient"),
    ),
  );
  await assertFails(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "1750000000003-forged.pdf"),
      reportBytes,
      reportMetadata("reception", "patient-pediatrics"),
    ),
  );
  await assertFails(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "report.exe"),
      reportBytes,
      {
        contentType: "application/octet-stream",
        customMetadata: {
          patientId: "patient-pediatrics",
          uploadedBy: staff.admin.uid,
        },
      },
    ),
  );
});

test("no staff role can upload a new report to an archived chart", async () => {
  for (const key of ["admin", "pediatrics", "reception"]) {
    await assertFails(
      uploadBytes(
        reportReference(staffStorage(key), "patient-archived", `1750000000011-${key}.pdf`),
        reportBytes,
        reportMetadata(key, "patient-archived", key === "reception" ? { labOrderId: "lab-archived" } : {}),
      ),
    );
  }
});

test("browser clients cannot read reports while assigned doctors retain scoped upload access", async () => {
  await seedReport("patient-pediatrics");
  await seedReport("patient-obg");
  const storage = staffStorage("pediatrics");

  await assertFails(getBytes(reportReference(storage, "patient-pediatrics")));
  await assertFails(getBytes(reportReference(storage, "patient-obg")));
  await assertSucceeds(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "1750000000004-doctor.pdf"),
      reportBytes,
      reportMetadata("pediatrics", "patient-pediatrics"),
    ),
  );
  await assertFails(
    uploadBytes(
      reportReference(storage, "patient-obg", "1750000000005-other-doctor.pdf"),
      reportBytes,
      reportMetadata("pediatrics", "patient-obg"),
    ),
  );
});

test("legacy doctorId assignment is used only for scoped uploads, never browser reads", async () => {
  await seedReport("patient-legacy-doctor-id");
  await seedReport("patient-empty-name-doctor-id");
  await seedReport("patient-name-precedence");
  const pediatricsStorage = staffStorage("pediatrics");
  const obgStorage = staffStorage("obg");

  await assertFails(getBytes(reportReference(pediatricsStorage, "patient-legacy-doctor-id")));
  await assertFails(getBytes(reportReference(obgStorage, "patient-legacy-doctor-id")));
  await assertFails(getBytes(reportReference(pediatricsStorage, "patient-empty-name-doctor-id")));
  await assertFails(getBytes(reportReference(obgStorage, "patient-empty-name-doctor-id")));
  await assertFails(getBytes(reportReference(pediatricsStorage, "patient-name-precedence")));
  await assertFails(getBytes(reportReference(obgStorage, "patient-name-precedence")));
  await assertSucceeds(uploadBytes(
    reportReference(pediatricsStorage, "patient-legacy-doctor-id", "1750000000014-legacy-doctor.pdf"),
    reportBytes,
    reportMetadata("pediatrics", "patient-legacy-doctor-id"),
  ));
  await assertFails(uploadBytes(
    reportReference(obgStorage, "patient-legacy-doctor-id", "1750000000015-wrong-doctor.pdf"),
    reportBytes,
    reportMetadata("obg", "patient-legacy-doctor-id"),
  ));
});

test("administrators and doctors cannot bypass the audited report proxy", async () => {
  await seedReport("patient-unassigned");
  const adminReference = reportReference(staffStorage("admin"), "patient-unassigned");
  const doctorReference = reportReference(staffStorage("pediatrics"), "patient-unassigned");

  await assertFails(getBytes(adminReference));
  await assertFails(getBytes(doctorReference));
  await assertFails(listAll(ref(staffStorage("admin"), "reports/patient-unassigned")));
  await assertFails(listAll(ref(staffStorage("reception"), "reports/patient-unassigned")));
  await assertFails(deleteObject(doctorReference));
  await assertFails(deleteObject(adminReference));
});

test("no staff role can overwrite an existing report", async () => {
  await seedReport("patient-pediatrics");
  for (const key of ["admin", "pediatrics", "reception"]) {
    const reference = reportReference(staffStorage(key), "patient-pediatrics");
    await assertFails(
      uploadBytes(reference, reportBytes, reportMetadata(key, "patient-pediatrics")),
    );
    await assertFails(updateMetadata(reference, { customMetadata: { replaced: "true" } }));
  }
});

test("unauthenticated and inactive users cannot access reports", async () => {
  await seedReport("patient-pediatrics");
  const unauthenticated = testEnv.unauthenticatedContext().storage();
  const inactive = staffStorage("inactive");

  await assertFails(getBytes(reportReference(unauthenticated, "patient-pediatrics")));
  await assertFails(
    uploadBytes(
      reportReference(unauthenticated, "patient-pediatrics", "1750000000006-public.pdf"),
      reportBytes,
      {
        contentType: "application/pdf",
        customMetadata: { patientId: "patient-pediatrics", uploadedBy: "anonymous" },
      },
    ),
  );
  await assertFails(getBytes(reportReference(inactive, "patient-pediatrics")));
  await assertFails(
    uploadBytes(
      reportReference(inactive, "patient-pediatrics", "1750000000007-inactive.pdf"),
      reportBytes,
      reportMetadata("inactive", "patient-pediatrics"),
    ),
  );
});
