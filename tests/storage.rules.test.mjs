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
    ["labOrders/lab-other-patient", { patientId: "patient-obg", status: "processing" }],
  ]);
});

after(async () => {
  await testEnv?.cleanup();
});

test("reception can intake a bound report but cannot read, inspect, or list it", async () => {
  const storage = staffStorage("reception");
  const reference = reportReference(storage, "patient-pediatrics");
  await assertSucceeds(
    uploadBytes(
      reference,
      reportBytes,
      reportMetadata("reception", "patient-pediatrics", { labOrderId: "lab-pediatrics" }),
    ),
  );

  await assertFails(getBytes(reference));
  await assertFails(getMetadata(reference));
  await assertFails(listAll(ref(storage, "reports/patient-pediatrics")));
});

test("reception cannot create an unlinked report object", async () => {
  const storage = staffStorage("reception");
  await assertFails(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "1750000000012-unlinked.pdf"),
      reportBytes,
      reportMetadata("reception", "patient-pediatrics"),
    ),
  );
});

test("reception lab uploads accept only a safe lab-order identifier", async () => {
  const storage = staffStorage("reception");
  await assertSucceeds(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "1750000000001-lab.pdf"),
      reportBytes,
      reportMetadata("reception", "patient-pediatrics", { labOrderId: "lab-pediatrics" }),
    ),
  );
  await assertFails(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "1750000000002-unsafe-lab.pdf"),
      reportBytes,
      reportMetadata("reception", "patient-pediatrics", { labOrderId: "../other-patient" }),
    ),
  );
});

test("reception report objects require a real matching order that can accept a file", async () => {
  const storage = staffStorage("reception");
  await assertFails(uploadBytes(
    reportReference(storage, "patient-pediatrics", "1750000000016-missing-order.pdf"),
    reportBytes,
    reportMetadata("reception", "patient-pediatrics", { labOrderId: "not-a-real-order" }),
  ));
  await assertFails(uploadBytes(
    reportReference(storage, "patient-pediatrics", "1750000000017-wrong-patient.pdf"),
    reportBytes,
    reportMetadata("reception", "patient-pediatrics", { labOrderId: "lab-other-patient" }),
  ));
  await assertFails(uploadBytes(
    reportReference(storage, "patient-pediatrics", "1750000000018-already-attached.pdf"),
    reportBytes,
    reportMetadata("reception", "patient-pediatrics", { labOrderId: "lab-completed-attached" }),
  ));
  await assertSucceeds(uploadBytes(
    reportReference(storage, "patient-pediatrics", "1750000000019-completed-open.pdf"),
    reportBytes,
    reportMetadata("reception", "patient-pediatrics", { labOrderId: "lab-completed-open" }),
  ));
});

test("non-admin staff cannot delete a newly uploaded lab report", async () => {
  const ownerStorage = staffStorage("reception");
  const otherStorage = staffStorage("receptionBackup");
  const fileName = "1750000000008-rollback.pdf";
  const ownerReference = reportReference(ownerStorage, "patient-pediatrics", fileName);

  await assertSucceeds(
    uploadBytes(
      ownerReference,
      reportBytes,
      reportMetadata("reception", "patient-pediatrics", { labOrderId: "lab-rollback" }),
    ),
  );
  await assertFails(
    deleteObject(reportReference(otherStorage, "patient-pediatrics", fileName)),
  );
  await assertFails(deleteObject(ownerReference));
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

test("report object names require the client-normalized lowercase extension", async () => {
  const storage = staffStorage("reception");
  const metadata = {
    contentType: "image/jpeg",
    customMetadata: {
      patientId: "patient-pediatrics",
      uploadedBy: staff.reception.uid,
      labOrderId: "lab-camera-upload",
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

test("report creation rejects a missing patient, forged uploader, and unsafe file", async () => {
  const storage = staffStorage("reception");
  await assertFails(
    uploadBytes(
      reportReference(storage, "missing-patient"),
      reportBytes,
      reportMetadata("reception", "missing-patient"),
    ),
  );
  await assertFails(
    uploadBytes(
      reportReference(storage, "patient-pediatrics", "1750000000003-forged.pdf"),
      reportBytes,
      reportMetadata("admin", "patient-pediatrics"),
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
          uploadedBy: staff.reception.uid,
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

test("the assigned doctor can read and create reports only for assigned patients", async () => {
  await seedReport("patient-pediatrics");
  await seedReport("patient-obg");
  const storage = staffStorage("pediatrics");

  await assertSucceeds(getBytes(reportReference(storage, "patient-pediatrics")));
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

test("legacy doctorId assignment is used only when doctorName is missing or empty", async () => {
  await seedReport("patient-legacy-doctor-id");
  await seedReport("patient-empty-name-doctor-id");
  await seedReport("patient-name-precedence");
  const pediatricsStorage = staffStorage("pediatrics");
  const obgStorage = staffStorage("obg");

  await assertSucceeds(getBytes(reportReference(pediatricsStorage, "patient-legacy-doctor-id")));
  await assertFails(getBytes(reportReference(obgStorage, "patient-legacy-doctor-id")));
  await assertSucceeds(getBytes(reportReference(pediatricsStorage, "patient-empty-name-doctor-id")));
  await assertFails(getBytes(reportReference(obgStorage, "patient-empty-name-doctor-id")));
  await assertFails(getBytes(reportReference(pediatricsStorage, "patient-name-precedence")));
  await assertSucceeds(getBytes(reportReference(obgStorage, "patient-name-precedence")));
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

test("admin can access unassigned reports and delete retained clinical files", async () => {
  await seedReport("patient-unassigned");
  const adminReference = reportReference(staffStorage("admin"), "patient-unassigned");
  const doctorReference = reportReference(staffStorage("pediatrics"), "patient-unassigned");

  await assertSucceeds(getBytes(adminReference));
  await assertFails(getBytes(doctorReference));
  await assertFails(deleteObject(doctorReference));
  await assertSucceeds(deleteObject(adminReference));
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
