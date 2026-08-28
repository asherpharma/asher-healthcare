import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "asher-healthcare-rules-test";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const [host, portText] = FIRESTORE_HOST.split(":");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

const staff = {
  admin: {
    uid: "admin-1",
    record: { active: true, role: "admin", displayName: "Clinic Admin" },
  },
  reception: {
    uid: "reception-1",
    record: { active: true, role: "reception", displayName: "Reception Desk" },
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
};

let testEnv;

function staffDb(key) {
  const member = staff[key];
  return testEnv.authenticatedContext(member.uid).firestore();
}

async function seedDocuments(entries) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all(entries.map(([path, data]) => setDoc(doc(database, path), data)));
  });
}

function appointment({ doctorId = "pediatrics", status = "confirmed" } = {}) {
  return {
    doctorId,
    preferredDate: "2026-08-03",
    preferredTime: "17:00",
    patientName: "Rules Test Patient",
    patientPhone: "9000000000",
    status,
    updatedAt: Timestamp.fromMillis(1_750_000_000_000),
  };
}

function invoice({ patientId = "patient-1", invoiceNumber = "ASH-20260807-TEST01" } = {}) {
  return {
    invoiceNumber,
    patientId,
    patientName: "Rules Test Patient",
    patientPhone: "9000000000",
    items: [{ description: "Consultation", quantity: 1, unitPrice: 500, amount: 500 }],
    subtotal: 500,
    discount: 0,
    total: 500,
    amountPaid: 0,
    balance: 500,
    paymentStatus: "unpaid",
    paymentMethod: "not_recorded",
    paymentReference: "",
    notes: "",
    createdBy: staff.reception.uid,
    createdAt: Timestamp.fromMillis(1_750_000_000_000),
    updatedAt: Timestamp.fromMillis(1_750_000_000_000),
    paidAt: null,
  };
}

function serviceCatalog() {
  return {
    schemaVersion: 1,
    services: {
      general: { label: "General consultation", fee: 250, active: true },
      pediatrics: { label: "Pediatric consultation", fee: 500, active: true },
      obg: { label: "Obstetrics & Gynaecology consultation", fee: 500, active: true },
    },
    updatedBy: staff.admin.uid,
    updatedAt: serverTimestamp(),
  };
}

function consultationDraft({
  patientId = "draft-patient",
  appointmentKey = "walkin",
  ownerUid = staff.pediatrics.uid,
  ownerName = staff.pediatrics.record.displayName,
  doctorName = staff.pediatrics.record.doctorName,
  expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
} = {}) {
  return {
    schemaVersion: 1,
    patientId,
    appointmentKey,
    doctorName,
    ownerUid,
    ownerName,
    fields: {
      temperature: "98.6",
      pulse: "82",
      bloodPressure: "120/80",
      spo2: "99",
      weight: "24",
      chiefComplaint: "Fever for two days",
      examinationFindings: "Alert and hydrated",
      diagnosis: "Viral fever",
      treatment: "Supportive care",
      clinicalNotes: "Review warning signs",
      advice: "Fluids and rest",
      labPriority: "routine",
      labNotes: "",
      followUpDate: "2026-08-18",
      followUpTime: "18:00",
      followUpPriority: "medium",
    },
    medicines: [{
      name: "Paracetamol",
      dose: "5 ml",
      frequency: "Three times daily",
      duration: "3 days",
      instructions: "After food",
    }],
    labTests: ["Complete Blood Count (CBC)"],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt,
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port: Number(portText),
      rules,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedDocuments(
    Object.values(staff).map((member) => [`staff/${member.uid}`, member.record]),
  );
});

after(async () => {
  await testEnv?.cleanup();
});

test("browser staff management cannot create accounts or change privileged assignments", async () => {
  await seedDocuments([
    ["staff/lab-operator-off", {
      active: true,
      role: "reception",
      displayName: "Lab Operator Off",
      labReportOperator: false,
    }],
    ["staff/lab-operator-on", {
      active: true,
      role: "doctor",
      displayName: "Lab Operator On",
      doctorName: "Dr. Shaik Reshma",
      labReportOperator: true,
    }],
  ]);

  const database = staffDb("admin");
  await assertFails(updateDoc(doc(database, "staff/lab-operator-off"), {
    labReportOperator: true,
  }));
  await assertFails(updateDoc(doc(database, "staff/lab-operator-on"), {
    labReportOperator: false,
  }));
  await assertFails(updateDoc(doc(database, "staff/lab-operator-off"), {
    role: "admin",
  }));
  await assertFails(updateDoc(doc(database, "staff/lab-operator-on"), {
    doctorName: "Dr. Lt Col Shafi Ahamad",
  }));
  await assertFails(setDoc(doc(database, "staff/browser-granted-operator"), {
    active: true,
    role: "reception",
    displayName: "Browser Granted Operator",
    labReportOperator: true,
  }));
  await assertFails(setDoc(doc(database, "staff/browser-created-with-role"), {
    active: true,
    role: "reception",
    displayName: "Browser Created Staff",
  }));
});

test("no browser role can inspect or mutate trusted report finalization intents", async () => {
  const intentPath = "labReportFinalizationIntents/lab-order-rules-1";
  await seedDocuments([[intentPath, {
    schemaVersion: 1,
    status: "prepared",
    labOrderId: "lab-order-rules-1",
    patientId: "patient-1",
    requestFingerprint: "a".repeat(64),
  }]]);

  for (const key of ["admin", "reception", "pediatrics", "obg"]) {
    const database = staffDb(key);
    const reference = doc(database, intentPath);
    await assertFails(getDoc(reference));
    await assertFails(setDoc(reference, { status: "discarded" }, { merge: true }));
    await assertFails(updateDoc(reference, { status: "completed" }));
    await assertFails(deleteDoc(reference));
  }
});

test("admin browser management still permits non-privileged staff profile changes", async () => {
  await seedDocuments([["staff/profile-maintenance", {
    active: true,
    role: "reception",
    displayName: "Original Name",
    labReportOperator: false,
  }]]);

  const database = staffDb("admin");
  await assertSucceeds(updateDoc(doc(database, "staff/profile-maintenance"), {
    displayName: "Updated Name",
  }));
  await assertFails(updateDoc(doc(database, "staff/profile-maintenance"), {
    active: false,
  }));
});

test("service catalogue is staff-readable but all browser mutations are denied", async () => {
  await seedDocuments([["clinicSettings/serviceCatalog", serviceCatalog()]]);
  const admin = staffDb("admin");
  const reference = doc(admin, "clinicSettings/serviceCatalog");

  for (const key of ["admin", "reception", "pediatrics", "obg"]) {
    await assertSucceeds(getDoc(doc(staffDb(key), "clinicSettings/serviceCatalog")));
  }
  await assertFails(getDoc(doc(
    testEnv.unauthenticatedContext().firestore(),
    "clinicSettings/serviceCatalog",
  )));
  await assertFails(updateDoc(
    doc(staffDb("reception"), "clinicSettings/serviceCatalog"),
    { "services.general.fee": 300, updatedAt: serverTimestamp() },
  ));
  await assertFails(updateDoc(reference, {
    "services.general.fee": 300,
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(reference, {
    "services.general.fee": 250.5,
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(reference, {
    unexpected: true,
    updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(reference, {
    ...serviceCatalog(),
    services: {
      general: { label: "General consultation", fee: 250, active: false },
      pediatrics: { label: "Pediatric consultation", fee: 500, active: false },
      obg: { label: "Obstetrics & Gynaecology consultation", fee: 500, active: false },
    },
  }));
  await assertFails(deleteDoc(reference));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), "clinicSettings/serviceCatalog"));
  });
  await assertFails(setDoc(reference, serviceCatalog()));
  await assertFails(setDoc(doc(staffDb("reception"), "clinicSettings/serviceCatalog"), serviceCatalog()));
});

test("reception check-in requires the atomic nested queue counter", async () => {
  await seedDocuments([["appointments/check-in-1", appointment()]]);
  const database = staffDb("reception");
  const batch = writeBatch(database);
  batch.update(doc(database, "appointments/check-in-1"), {
    status: "checked_in",
    queueToken: 1,
    checkedInAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(database, "queueCounters/pediatrics/days/2026-08-03"), {
    doctorId: "pediatrics",
    date: "2026-08-03",
    lastToken: 1,
    appointmentId: "check-in-1",
    updatedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());

  await seedDocuments([["appointments/check-in-without-counter", appointment()]]);
  await assertFails(
    updateDoc(doc(database, "appointments/check-in-without-counter"), {
      status: "checked_in",
      queueToken: 2,
      checkedInAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("reception cannot start a consultation", async () => {
  await seedDocuments([
    [
      "appointments/reception-start",
      {
        ...appointment({ status: "checked_in" }),
        queueToken: 1,
        checkedInAt: Timestamp.fromMillis(1_750_000_100_000),
      },
    ],
  ]);
  await assertFails(
    updateDoc(doc(staffDb("reception"), "appointments/reception-start"), {
      status: "in_consultation",
      consultationStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("the assigned doctor can start and complete their own appointment", async () => {
  await seedDocuments([
    [
      "appointments/assigned-doctor",
      {
        ...appointment({ status: "checked_in" }),
        queueToken: 4,
        checkedInAt: Timestamp.fromMillis(1_750_000_100_000),
      },
    ],
  ]);
  const reference = doc(staffDb("pediatrics"), "appointments/assigned-doctor");
  await assertSucceeds(
    updateDoc(reference, {
      status: "in_consultation",
      consultationStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    updateDoc(reference, {
      status: "completed",
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("another doctor cannot start an appointment they do not own", async () => {
  await seedDocuments([
    [
      "appointments/other-doctor",
      {
        ...appointment({ status: "checked_in" }),
        queueToken: 2,
        checkedInAt: Timestamp.fromMillis(1_750_000_100_000),
      },
    ],
  ]);
  await assertFails(
    updateDoc(doc(staffDb("obg"), "appointments/other-doctor"), {
      status: "in_consultation",
      consultationStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("doctors can read only a doctorId-constrained appointment query for their own desk", async () => {
  await seedDocuments([
    ["appointments/pediatrics-read", appointment({ doctorId: "pediatrics" })],
    ["appointments/obg-read", appointment({ doctorId: "obg" })],
  ]);
  const database = staffDb("pediatrics");
  await assertSucceeds(getDoc(doc(database, "appointments/pediatrics-read")));
  await assertFails(getDoc(doc(database, "appointments/obg-read")));
  await assertSucceeds(
    getDocs(query(
      collection(database, "appointments"),
      where("doctorId", "==", "pediatrics"),
    )),
  );
  await assertFails(getDocs(collection(database, "appointments")));
  await assertSucceeds(getDocs(collection(staffDb("reception"), "appointments")));
  await assertSucceeds(getDocs(collection(staffDb("admin"), "appointments")));
});

test("admin can manage appointments across doctors", async () => {
  await seedDocuments([
    [
      "appointments/admin-across-doctors",
      {
        ...appointment({ doctorId: "obg", status: "waiting" }),
        queueToken: 7,
        checkedInAt: Timestamp.fromMillis(1_750_000_100_000),
        waitingAt: Timestamp.fromMillis(1_750_000_200_000),
      },
    ],
  ]);
  const reference = doc(staffDb("admin"), "appointments/admin-across-doctors");
  await assertSucceeds(
    updateDoc(reference, {
      status: "in_consultation",
      consultationStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    updateDoc(reference, {
      status: "completed",
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("reception cannot read a patient's clinical report", async () => {
  await seedDocuments([
    ["patients/patient-1", { fullName: "Rules Test Patient" }],
    [
      "patients/patient-1/reports/report-1",
      { title: "Private report", createdAt: Timestamp.fromMillis(1_750_000_000_000) },
    ],
  ]);
  await assertFails(
    getDoc(doc(staffDb("reception"), "patients/patient-1/reports/report-1")),
  );
});

test("reception receives no direct patient document access and doctors see only assigned charts", async () => {
  await seedDocuments([
    ["patients/pediatrics-chart", { fullName: "Pediatric Patient", doctorName: "Dr. Lt Col Shafi Ahamad", archived: false }],
    ["patients/obg-chart", { fullName: "OBG Patient", doctorName: "Dr. Shaik Reshma", archived: false }],
  ]);
  await assertFails(getDoc(doc(staffDb("reception"), "patients/pediatrics-chart")));
  await assertSucceeds(getDoc(doc(staffDb("pediatrics"), "patients/pediatrics-chart")));
  await assertFails(getDoc(doc(staffDb("pediatrics"), "patients/obg-chart")));
  await assertSucceeds(getDoc(doc(staffDb("admin"), "patients/obg-chart")));

  const assignedVisit = {
    visitDate: "2026-08-12",
    doctorName: "Dr. Lt Col Shafi Ahamad",
    chiefComplaint: "Routine follow-up",
    vitals: "",
    diagnosis: "Stable",
    treatment: "Continue care",
    followUpDate: "",
    notes: "",
    createdBy: staff.pediatrics.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertSucceeds(
    setDoc(doc(staffDb("pediatrics"), "patients/pediatrics-chart/visits/visit-1"), assignedVisit),
  );
  await assertFails(
    setDoc(doc(staffDb("pediatrics"), "patients/obg-chart/visits/visit-2"), assignedVisit),
  );
});

test("clinical history is append-only for doctors and administrators", async () => {
  const createdAt = Timestamp.fromMillis(1_750_000_000_000);
  await seedDocuments([
    ["patients/immutable-chart", {
      fullName: "Immutable Patient",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      archived: false,
    }],
    ["patients/immutable-chart/visits/visit-1", {
      doctorName: "Dr. Lt Col Shafi Ahamad",
      diagnosis: "Original diagnosis",
      createdBy: staff.pediatrics.uid,
      createdAt,
      updatedAt: createdAt,
    }],
    ["patients/immutable-chart/prescriptions/prescription-1", {
      doctorName: "Dr. Lt Col Shafi Ahamad",
      advice: "Original advice",
      createdBy: staff.pediatrics.uid,
      createdAt,
      updatedAt: createdAt,
    }],
  ]);

  await assertFails(updateDoc(
    doc(staffDb("pediatrics"), "patients/immutable-chart/visits/visit-1"),
    { diagnosis: "Rewritten diagnosis", updatedAt: serverTimestamp() },
  ));
  await assertFails(updateDoc(
    doc(staffDb("admin"), "patients/immutable-chart/prescriptions/prescription-1"),
    { advice: "Rewritten advice", updatedAt: serverTimestamp() },
  ));
});

test("consultation draft PHI is unavailable to every browser role", async () => {
  await seedDocuments([["patients/draft-patient", {
    fullName: "Draft Patient",
    doctorName: "Dr. Lt Col Shafi Ahamad",
    archived: false,
  }]]);

  const draftPath = `patients/draft-patient/consultationDrafts/${staff.pediatrics.uid}--walkin`;
  await seedDocuments([[draftPath, consultationDraft()]]);
  for (const role of ["admin", "reception", "pediatrics", "obg"]) {
    const reference = doc(staffDb(role), draftPath);
    await assertFails(getDoc(reference));
    await assertFails(setDoc(reference, consultationDraft(), { merge: true }));
    await assertFails(deleteDoc(reference));
  }
});

test("retention rules prevent browser deletion and clinical-history rewrites", async () => {
  const createdAt = Timestamp.fromMillis(1_750_000_000_000);
  await seedDocuments([
    ["appointments/retained-appointment", appointment()],
    ["patients/retained-chart", {
      fullName: "Retained Patient",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      archived: false,
    }],
    ["patients/retained-chart/vaccinations/vaccine-1", { notes: "Original", createdAt }],
    ["patients/retained-chart/pregnancyRecords/pregnancy-1", { notes: "Original", createdAt }],
    ["patients/retained-chart/growthRecords/growth-1", { milestone: "Original", createdAt }],
  ]);

  const admin = staffDb("admin");
  await assertFails(deleteDoc(doc(admin, "appointments/retained-appointment")));
  await assertFails(deleteDoc(doc(admin, `staff/${staff.reception.uid}`)));
  await assertFails(updateDoc(doc(admin, "patients/retained-chart/vaccinations/vaccine-1"), { notes: "Rewritten" }));
  await assertFails(updateDoc(doc(admin, "patients/retained-chart/pregnancyRecords/pregnancy-1"), { notes: "Rewritten" }));
  await assertFails(updateDoc(doc(admin, "patients/retained-chart/growthRecords/growth-1"), { milestone: "Rewritten" }));
});

test("collection-group visit access cannot outlive a doctor assignment", async () => {
  await seedDocuments([
    ["patients/reassigned-chart", {
      fullName: "Reassigned Patient",
      doctorName: "Dr. Shaik Reshma",
      archived: false,
    }],
    ["patients/reassigned-chart/visits/old-pediatrics-visit", {
      doctorName: "Dr. Lt Col Shafi Ahamad",
      diagnosis: "Historical entry",
      createdBy: staff.pediatrics.uid,
      createdAt: Timestamp.fromMillis(1_750_000_000_000),
      updatedAt: Timestamp.fromMillis(1_750_000_000_000),
    }],
  ]);

  const path = "patients/reassigned-chart/visits/old-pediatrics-visit";
  await assertFails(getDoc(doc(staffDb("pediatrics"), path)));
  await assertSucceeds(getDoc(doc(staffDb("admin"), path)));
  await assertFails(getDocs(query(
    collectionGroup(staffDb("pediatrics"), "visits"),
    where("doctorName", "==", "Dr. Lt Col Shafi Ahamad"),
  )));
});

test("clinical visit and prescription creates reject unknown or oversized shapes", async () => {
  await seedDocuments([
    ["patients/schema-chart", {
      fullName: "Schema Patient",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      archived: false,
    }],
  ]);
  const database = staffDb("pediatrics");
  const clinicalMetadata = {
    createdBy: staff.pediatrics.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(database, "patients/schema-chart/prescriptions/valid-prescription"), {
    ...clinicalMetadata,
    consultationId: "consultation-1",
    appointmentId: "appointment-1",
    prescribedDate: "2026-08-12",
    doctorName: "Dr. Lt Col Shafi Ahamad",
    medicines: [{
      name: "Paracetamol",
      dose: "5 ml",
      frequency: "Twice daily",
      duration: "3 days",
      instructions: "After food",
    }],
    advice: "Return if symptoms worsen.",
  }));
  await assertFails(setDoc(doc(database, "patients/schema-chart/visits/invalid-visit"), {
    ...clinicalMetadata,
    visitDate: "2026-08-12",
    doctorName: "Dr. Lt Col Shafi Ahamad",
    chiefComplaint: "Follow-up",
    vitals: "",
    diagnosis: "Stable",
    treatment: "",
    followUpDate: "",
    notes: "",
    unexpectedClinicalField: "must not be accepted",
  }));
  await assertFails(setDoc(doc(database, "patients/schema-chart/prescriptions/invalid-prescription"), {
    ...clinicalMetadata,
    prescribedDate: "2026-08-12",
    doctorName: "Unknown clinician",
    medicines: [],
    advice: "Continue care",
  }));
  await assertFails(setDoc(doc(database, "patients/schema-chart/prescriptions/malformed-medicine"), {
    ...clinicalMetadata,
    prescribedDate: "2026-08-12",
    doctorName: "Dr. Lt Col Shafi Ahamad",
    medicines: [null],
    advice: "Continue care",
  }));
  await assertFails(setDoc(doc(database, "patients/schema-chart/visits/wrong-doctor"), {
    ...clinicalMetadata,
    visitDate: "2026-08-12",
    doctorName: "Dr. Shaik Reshma",
    chiefComplaint: "Follow-up",
    vitals: "",
    diagnosis: "Stable",
    treatment: "",
    followUpDate: "",
    notes: "",
  }));
});

test("patient-related tasks are visible and mutable only to their assignee or an administrator", async () => {
  await seedDocuments([
    ["staffTasks/assigned-pediatrics", {
      title: "Call after results",
      details: "Discuss the protected patient follow-up.",
      type: "follow_up",
      priority: "medium",
      status: "open",
      dueDate: "2026-08-12",
      dueTime: "18:00",
      patientId: "patient-1",
      patientName: "Rules Test Patient",
      assignedTo: staff.pediatrics.uid,
      assignedToName: "Dr. Lt Col Shafi Ahamad",
      createdBy: staff.admin.uid,
      createdAt: Timestamp.fromMillis(1_750_000_000_000),
      updatedAt: Timestamp.fromMillis(1_750_000_000_000),
      completedAt: null,
      completedBy: "",
    }],
  ]);

  const taskPath = "staffTasks/assigned-pediatrics";
  await assertSucceeds(getDoc(doc(staffDb("admin"), taskPath)));
  await assertSucceeds(getDoc(doc(staffDb("pediatrics"), taskPath)));
  await assertFails(getDoc(doc(staffDb("obg"), taskPath)));
  await assertFails(getDoc(doc(staffDb("reception"), taskPath)));
  await assertSucceeds(getDocs(query(
    collection(staffDb("pediatrics"), "staffTasks"),
    where("assignedTo", "==", staff.pediatrics.uid),
    orderBy("dueDate", "asc"),
  )));
  await assertFails(getDocs(collection(staffDb("pediatrics"), "staffTasks")));
  await assertFails(updateDoc(doc(staffDb("obg"), taskPath), {
    status: "completed",
    completedAt: serverTimestamp(),
    completedBy: staff.obg.uid,
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(staffDb("pediatrics"), taskPath), {
    status: "completed",
    completedAt: serverTimestamp(),
    completedBy: staff.pediatrics.uid,
    updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(staffDb("admin"), taskPath)));

  const taskCreate = {
    title: "Review tomorrow",
    details: "",
    type: "general",
    priority: "medium",
    status: "open",
    dueDate: "2026-08-13",
    dueTime: "18:00",
    patientId: "",
    patientName: "",
    assignedToName: "Dr. Lt Col Shafi Ahamad",
    createdBy: staff.pediatrics.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
    completedBy: "",
  };
  await assertSucceeds(setDoc(doc(staffDb("pediatrics"), "staffTasks/own-task"), {
    ...taskCreate,
    assignedTo: staff.pediatrics.uid,
  }));
  await assertFails(setDoc(doc(staffDb("pediatrics"), "staffTasks/unassigned-task"), {
    ...taskCreate,
    assignedTo: "",
    assignedToName: "Administrator triage queue",
  }));
});

test("legacy doctorId assignment is used only when canonical doctorName is empty", async () => {
  await seedDocuments([
    ["patients/legacy-pediatrics", { fullName: "Legacy Pediatrics", doctorId: "pediatrics", archived: false }],
    ["patients/legacy-obg", { fullName: "Legacy OBG", doctorId: "obg", archived: false }],
    ["patients/conflicting-assignment", {
      fullName: "Conflicting Assignment",
      doctorId: "pediatrics",
      doctorName: "Dr. Shaik Reshma",
      archived: false,
    }],
    ["patients/invalid-name-assignment", {
      fullName: "Invalid Assignment",
      doctorId: "pediatrics",
      doctorName: 7,
      archived: false,
    }],
  ]);
  const database = staffDb("pediatrics");
  await assertSucceeds(getDoc(doc(database, "patients/legacy-pediatrics")));
  await assertFails(getDoc(doc(database, "patients/legacy-obg")));
  await assertFails(getDoc(doc(database, "patients/conflicting-assignment")));
  await assertFails(getDoc(doc(database, "patients/invalid-name-assignment")));
});

test("legacy clients cannot create patient roots directly", async () => {
  await assertFails(
    setDoc(doc(staffDb("reception"), "patients/legacy-client-create"), {
      fullName: "Legacy Direct Patient",
      createdBy: staff.reception.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("patient profile and identity reservations are writable only by protected services", async () => {
  await seedDocuments([
    ["patients/protected-profile", {
      fullName: "Protected Patient",
      phone: "+919000000000",
      dateOfBirth: "1990-01-01",
      gender: "female",
      doctorId: "pediatrics",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      address: "Bengaluru",
      allergies: "",
      medicalHistory: "",
      archived: false,
    }],
    ["patientIdentityKeys/identity-key", {
      patientId: "protected-profile",
      version: 2,
    }],
  ]);

  await assertFails(updateDoc(doc(staffDb("admin"), "patients/protected-profile"), {
    fullName: "Changed by client",
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(staffDb("reception"), "patients/protected-profile"), {
    phone: "+919111111111",
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(staffDb("pediatrics"), "patients/protected-profile"), {
    allergies: "Changed by client",
    updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(staffDb("admin"), "patientIdentityKeys/identity-key")));
  await assertFails(setDoc(doc(staffDb("admin"), "patientIdentityKeys/another-key"), {
    patientId: "protected-profile",
    version: 2,
  }));
});

test("browser reception cannot bind lab report metadata even in an atomic matching batch", async () => {
  await seedDocuments([
    ["patients/lab-patient", { fullName: "Lab Patient", archived: false }],
    ["patients/other-patient", { fullName: "Other Patient", archived: false }],
    ["labOrders/lab-order-1", { patientId: "lab-patient", status: "processing" }],
    ["labOrders/lab-order-mismatch", { patientId: "lab-patient", status: "processing" }],
  ]);
  const database = staffDb("reception");
  const report = {
    fileName: "blood-report.jpg",
    storagePath: "reports/lab-patient/1750000000000-blood-report.jpg",
    contentType: "image/jpeg",
    size: 2048,
    category: "Lab report",
    reportDate: "2026-08-06",
    notes: "Lab order ASH-LAB-0001",
    labOrderId: "lab-order-1",
    createdBy: staff.reception.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertFails(
    setDoc(doc(database, "patients/lab-patient/reports/lab-order-1"), report),
  );
  const mismatchedReport = {
    ...report,
    labOrderId: "lab-order-mismatch",
    storagePath: "reports/lab-patient/1750000000001-other-report.jpg",
  };
  const mismatchedBatch = writeBatch(database);
  mismatchedBatch.set(
    doc(database, "patients/lab-patient/reports/lab-order-mismatch"),
    mismatchedReport,
  );
  mismatchedBatch.update(doc(database, "labOrders/lab-order-mismatch"), {
    status: "completed",
    reportFileName: mismatchedReport.fileName,
    reportStoragePath: report.storagePath,
    reportContentType: mismatchedReport.contentType,
    reportSize: mismatchedReport.size,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await assertFails(mismatchedBatch.commit());
  const validBatch = writeBatch(database);
  validBatch.set(doc(database, "patients/lab-patient/reports/lab-order-1"), report);
  validBatch.update(doc(database, "labOrders/lab-order-1"), {
    status: "completed",
    reportFileName: report.fileName,
    reportStoragePath: report.storagePath,
    reportContentType: report.contentType,
    reportSize: report.size,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await assertFails(validBatch.commit());
  await assertFails(
    setDoc(doc(database, "patients/other-patient/reports/report-2"), {
      ...report,
      storagePath: "reports/other-patient/1750000000001-blood-report.jpg",
    }),
  );
});

test("reception cannot attach or replace a report on a completed order", async () => {
  await seedDocuments([
    ["patients/completed-lab-patient", { fullName: "Completed Lab Patient", archived: false }],
    ["labOrders/completed-without-file", { patientId: "completed-lab-patient", status: "completed" }],
    ["labOrders/completed-with-file", { patientId: "completed-lab-patient", status: "completed", reportStoragePath: "reports/completed-lab-patient/existing.pdf" }],
  ]);
  const report = (labOrderId, suffix) => ({
    fileName: `result-${suffix}.pdf`,
    storagePath: `reports/completed-lab-patient/17500000000${suffix}-result.pdf`,
    contentType: "application/pdf",
    size: 2048,
    category: "Lab report",
    reportDate: "2026-08-06",
    notes: `Lab order ${labOrderId}`,
    labOrderId,
    createdBy: staff.reception.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const database = staffDb("reception");
  const firstBatch = writeBatch(database);
  firstBatch.set(
    doc(database, "patients/completed-lab-patient/reports/completed-without-file"),
    report("completed-without-file", "02"),
  );
  firstBatch.update(doc(database, "labOrders/completed-without-file"), {
    reportFileName: "result-02.pdf",
    reportStoragePath: "reports/completed-lab-patient/1750000000002-result.pdf",
    reportContentType: "application/pdf",
    reportSize: 2048,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await assertFails(firstBatch.commit());
  await assertFails(updateDoc(doc(database, "labOrders/completed-without-file"), {
    reportStoragePath: "reports/completed-lab-patient/1750000000099-replacement.pdf",
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(database, "labOrders/completed-without-file"), {
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(
    setDoc(
      doc(database, "patients/completed-lab-patient/reports/replacement-report"),
      report("completed-with-file", "03"),
    ),
  );
});

test("clinical report metadata is patient-bound and immutable", async () => {
  await seedDocuments([
    ["patients/report-patient", {
      fullName: "Report Patient",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      archived: false,
    }],
  ]);
  const database = staffDb("pediatrics");
  const report = {
    fileName: "scan-result.pdf",
    storagePath: "reports/report-patient/1750000000023-a1b2c3d4-scan-result.pdf",
    contentType: "application/pdf",
    size: 4096,
    category: "Ultrasound / Imaging",
    reportDate: "2026-08-07",
    notes: "Reviewed scan",
    createdBy: staff.pediatrics.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const reportRef = doc(database, "patients/report-patient/reports/report-secure");
  await assertSucceeds(setDoc(reportRef, report));
  await assertFails(setDoc(
    doc(database, "patients/report-patient/reports/lab-reserved-identity"),
    report,
  ));
  await assertFails(setDoc(
    doc(database, "patients/report-patient/reports/report-cross-linked"),
    {
      ...report,
      storagePath: "reports/another-patient/1750000000024-a1b2c3d4-scan-result.pdf",
    },
  ));
  await assertFails(updateDoc(reportRef, {
    storagePath: "reports/report-patient/1750000000025-a1b2c3d4-replacement.pdf",
    updatedAt: serverTimestamp(),
  }));
});

test("lab order report metadata cannot be browser-bound even when complete and patient-matched", async () => {
  await seedDocuments([
    ["patients/lab-binding-patient", { fullName: "Lab Binding Patient", archived: false }],
    ["labOrders/lab-binding-order", {
      patientId: "lab-binding-patient",
      clinician: "Dr. Lt Col Shafi Ahamad",
      status: "processing",
    }],
  ]);
  const database = staffDb("reception");
  const orderRef = doc(database, "labOrders/lab-binding-order");
  await assertFails(updateDoc(orderRef, {
    status: "completed",
    reportStoragePath: "reports/another-patient/1750000000020-result.pdf",
    updatedAt: serverTimestamp(),
    completedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(orderRef, {
    status: "completed",
    reportStoragePath: "reports/lab-binding-patient/1750000000021-result.pdf",
    reportFileName: "result.pdf",
    updatedAt: serverTimestamp(),
    completedAt: serverTimestamp(),
  }));
  const report = {
    fileName: "result.pdf",
    storagePath: "reports/lab-binding-patient/1750000000022-a1b2c3d4-result.pdf",
    contentType: "application/pdf",
    size: 2048,
    category: "Lab report",
    reportDate: "2026-08-07",
    notes: "Lab order lab-binding-order",
    labOrderId: "lab-binding-order",
    createdBy: staff.reception.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const validBatch = writeBatch(database);
  validBatch.set(
    doc(database, "patients/lab-binding-patient/reports/lab-binding-order"),
    report,
  );
  validBatch.update(orderRef, {
    status: "completed",
    reportStoragePath: report.storagePath,
    reportFileName: report.fileName,
    reportContentType: report.contentType,
    reportSize: report.size,
    updatedAt: serverTimestamp(),
    completedAt: serverTimestamp(),
  });
  await assertFails(validBatch.commit());

  const genericReport = Object.fromEntries(
    Object.entries(report).filter(([field]) => field !== "labOrderId"),
  );
  await assertFails(setDoc(
    doc(staffDb("admin"), "patients/lab-binding-patient/reports/lab-binding-order"),
    {
      ...genericReport,
      createdBy: staff.admin.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  ));
});

test("reception cannot author clinical result summaries and lab orders cannot be hard-deleted", async () => {
  await seedDocuments([
    ["patients/lab-summary-patient", {
      fullName: "Lab Summary Patient",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      archived: false,
    }],
    ["labOrders/lab-summary-order", {
      patientId: "lab-summary-patient",
      clinician: "Dr. Lt Col Shafi Ahamad",
      status: "processing",
    }],
  ]);

  await assertFails(updateDoc(doc(staffDb("reception"), "labOrders/lab-summary-order"), {
    resultSummary: "Reception-authored interpretation",
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(staffDb("pediatrics"), "labOrders/lab-summary-order"), {
    status: "completed",
    resultSummary: "Doctor-verified interpretation",
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(staffDb("admin"), "labOrders/lab-summary-order")));
});

test("archived patients reject new clinical records for every staff role", async () => {
  await seedDocuments([
    ["patients/archived-clinical", { fullName: "Archived Patient", archived: true }],
  ]);
  const clinicalRecord = {
    createdBy: staff.pediatrics.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertFails(
    setDoc(doc(staffDb("pediatrics"), "patients/archived-clinical/visits/visit-1"), clinicalRecord),
  );
  await assertFails(
    setDoc(doc(staffDb("admin"), "patients/archived-clinical/visits/visit-2"), {
      ...clinicalRecord,
      createdBy: staff.admin.uid,
    }),
  );
});

test("an appointment linked to an archived chart cannot advance", async () => {
  await seedDocuments([
    ["patients/archived-appointment-patient", { fullName: "Archived Appointment", archived: true }],
    ["appointments/archived-appointment", {
      ...appointment({ status: "checked_in" }),
      patientId: "archived-appointment-patient",
      queueToken: 1,
      checkedInAt: Timestamp.fromMillis(1_750_000_100_000),
    }],
  ]);
  await assertFails(
    updateDoc(doc(staffDb("admin"), "appointments/archived-appointment"), {
      status: "in_consultation",
      consultationStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("new lab orders cannot be attached to an archived patient", async () => {
  await seedDocuments([
    ["patients/active-lab-order", { fullName: "Active Patient", archived: false }],
    ["patients/archived-lab-order", { fullName: "Archived Patient", archived: true }],
  ]);
  const order = (patientId) => ({
    orderNumber: `LAB-20260806-${patientId.slice(0, 4).toUpperCase()}`,
    patientId,
    patientName: "Rules Test Patient",
    patientPhone: "9000000000",
    tests: ["Complete Blood Count (CBC)"],
    priority: "routine",
    clinician: "Dr. Lt Col Shafi Ahamad",
    notes: "",
    status: "ordered",
    createdBy: staff.reception.uid,
    orderedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const database = staffDb("reception");
  await assertSucceeds(setDoc(doc(database, "labOrders/active-order"), order("active-lab-order")));
  await assertFails(setDoc(doc(database, "labOrders/archived-order"), order("archived-lab-order")));
  await assertFails(setDoc(doc(database, "labOrders/noncanonical-clinician"), {
    ...order("active-lab-order"),
    clinician: "Unlinked clinician",
  }));
});

test("lab order history is clinician-scoped for doctors and hidden from direct reception reads", async () => {
  await seedDocuments([
    ["patients/lab-pediatrics", {
      fullName: "Pediatrics Lab Patient",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      archived: false,
    }],
    ["patients/lab-pediatrics-legacy", {
      fullName: "Legacy Pediatrics Lab Patient",
      doctorId: "pediatrics",
      archived: false,
    }],
    ["patients/lab-obg", {
      fullName: "OBG Lab Patient",
      doctorName: "Dr. Shaik Reshma",
      archived: false,
    }],
    ["patients/lab-archived", {
      fullName: "Archived Lab Patient",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      archived: true,
    }],
    ["patients/lab-reassigned", {
      fullName: "Reassigned Lab Patient",
      doctorName: "Dr. Shaik Reshma",
      archived: false,
    }],
    ["labOrders/pediatrics-canonical", {
      patientId: "lab-pediatrics",
      clinician: "Dr. Lt Col Shafi Ahamad",
      status: "ordered",
    }],
    ["labOrders/pediatrics-wrong-clinician", {
      patientId: "lab-pediatrics",
      clinician: "Dr. Shaik Reshma",
      status: "ordered",
    }],
    ["labOrders/pediatrics-legacy", {
      patientId: "lab-pediatrics-legacy",
      clinician: "Dr. Lt Col Shafi Ahamad",
      status: "ordered",
    }],
    ["labOrders/obg-canonical", {
      patientId: "lab-obg",
      clinician: "Dr. Shaik Reshma",
      status: "ordered",
    }],
    ["labOrders/archived-order", {
      patientId: "lab-archived",
      clinician: "Dr. Lt Col Shafi Ahamad",
      status: "ordered",
    }],
    ["labOrders/reassigned-history", {
      patientId: "lab-reassigned",
      clinician: "Dr. Lt Col Shafi Ahamad",
      status: "ordered",
    }],
  ]);

  const pediatrics = staffDb("pediatrics");
  await assertSucceeds(getDoc(doc(pediatrics, "labOrders/pediatrics-canonical")));
  await assertSucceeds(getDoc(doc(pediatrics, "labOrders/pediatrics-legacy")));
  await assertFails(getDoc(doc(pediatrics, "labOrders/pediatrics-wrong-clinician")));
  await assertFails(getDoc(doc(pediatrics, "labOrders/obg-canonical")));
  await assertFails(getDoc(doc(pediatrics, "labOrders/archived-order")));
  await assertFails(getDoc(doc(pediatrics, "labOrders/reassigned-history")));
  // A historical clinician query can include archived or reassigned patients,
  // so Firestore correctly rejects the entire browser query. The doctor lab
  // desk uses the protected current-assignment directory instead.
  await assertFails(getDocs(query(
    collection(pediatrics, "labOrders"),
    where("clinician", "==", "Dr. Lt Col Shafi Ahamad"),
  )));
  await assertFails(getDocs(collection(pediatrics, "labOrders")));
  await assertFails(getDoc(doc(staffDb("reception"), "labOrders/pediatrics-canonical")));
  await assertFails(getDoc(doc(staffDb("reception"), "labOrders/archived-order")));
  await assertFails(getDocs(collection(staffDb("reception"), "labOrders")));
  await assertSucceeds(getDoc(doc(staffDb("admin"), "labOrders/obg-canonical")));
  await assertSucceeds(getDoc(doc(staffDb("admin"), "labOrders/archived-order")));
});

test("doctor lab writes require an active assigned patient and canonical clinician", async () => {
  await seedDocuments([
    ["patients/doctor-lab-pediatrics", {
      fullName: "Assigned Pediatrics",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      archived: false,
    }],
    ["patients/doctor-lab-obg", {
      fullName: "Assigned OBG",
      doctorName: "Dr. Shaik Reshma",
      archived: false,
    }],
    ["patients/doctor-lab-archived", {
      fullName: "Archived Pediatrics",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      archived: true,
    }],
  ]);
  const order = (patientId, clinician) => ({
    orderNumber: `LAB-20260807-${patientId.slice(-4).toUpperCase()}`,
    patientId,
    patientName: "Rules Test Patient",
    patientPhone: "9000000000",
    tests: ["Complete Blood Count (CBC)"],
    priority: "routine",
    clinician,
    notes: "",
    status: "ordered",
    createdBy: staff.pediatrics.uid,
    orderedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const database = staffDb("pediatrics");
  await assertSucceeds(setDoc(
    doc(database, "labOrders/doctor-assigned-order"),
    order("doctor-lab-pediatrics", "Dr. Lt Col Shafi Ahamad"),
  ));
  await assertFails(setDoc(
    doc(database, "labOrders/doctor-wrong-patient"),
    order("doctor-lab-obg", "Dr. Lt Col Shafi Ahamad"),
  ));
  await assertFails(setDoc(
    doc(database, "labOrders/doctor-wrong-clinician"),
    order("doctor-lab-pediatrics", "Dr. Shaik Reshma"),
  ));
  await assertFails(setDoc(
    doc(database, "labOrders/doctor-archived-patient"),
    order("doctor-lab-archived", "Dr. Lt Col Shafi Ahamad"),
  ));
});

test("invoice creation is restricted to the protected billing service", async () => {
  await seedDocuments([
    ["patients/active-invoice-patient", { fullName: "Active Patient", archived: false }],
    ["patients/archived-invoice-patient", { fullName: "Archived Patient", archived: true }],
  ]);
  const invoice = (patientId) => ({
    invoiceNumber: `ASH-20260806-${patientId.slice(0, 4).toUpperCase()}`,
    patientId,
    patientName: "Rules Test Patient",
    patientPhone: "9000000000",
    items: [{ description: "Consultation", quantity: 1, unitPrice: 500, amount: 500 }],
    subtotal: 500,
    discount: 0,
    total: 500,
    amountPaid: 0,
    balance: 500,
    paymentStatus: "unpaid",
    paymentMethod: "not_recorded",
    paymentReference: "",
    notes: "",
    createdBy: staff.reception.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    paidAt: null,
  });
  const database = staffDb("reception");
  await assertFails(setDoc(doc(database, "invoices/active-invoice"), invoice("active-invoice-patient")));
  await assertFails(setDoc(doc(database, "invoices/archived-invoice"), invoice("archived-invoice-patient")));
  await assertFails(setDoc(doc(database, "invoices/paid-at-creation"), {
    ...invoice("active-invoice-patient"),
    invoiceNumber: "ASH-20260807-PAID01",
    amountPaid: 250,
    balance: 250,
    paymentStatus: "partial",
    paymentMethod: "cash",
  }));
});

test("billing records are unavailable to doctors but remain available to admin and reception", async () => {
  await seedDocuments([
    ["patients/billing-patient", { fullName: "Billing Patient", archived: false }],
    ["invoices/billing-invoice", invoice({ patientId: "billing-patient" })],
    ["invoices/billing-invoice/payments/payment-1", {
      invoiceId: "billing-invoice",
      invoiceNumber: "ASH-20260807-TEST01",
      patientId: "billing-patient",
      patientName: "Billing Patient",
      amount: 500,
      method: "cash",
      source: "manual",
      status: "received",
      createdBy: staff.reception.uid,
      createdAt: Timestamp.fromMillis(1_750_000_000_000),
    }],
  ]);

  await assertFails(getDoc(doc(staffDb("pediatrics"), "invoices/billing-invoice")));
  await assertFails(getDoc(doc(staffDb("pediatrics"), "invoices/billing-invoice/payments/payment-1")));
  await assertSucceeds(getDoc(doc(staffDb("reception"), "invoices/billing-invoice")));
  await assertSucceeds(getDoc(doc(staffDb("admin"), "invoices/billing-invoice/payments/payment-1")));
});

test("ordered payment audit queries are available only to billing staff", async () => {
  await seedDocuments([
    ["invoices/audit-invoice/payments/payment-1", {
      amount: 500,
      createdAt: Timestamp.fromMillis(1_750_000_000_000),
    }],
  ]);

  const paymentAudit = (database) => query(
    collectionGroup(database, "payments"),
    orderBy("createdAt", "desc"),
  );
  await assertSucceeds(getDocs(paymentAudit(staffDb("admin"))));
  await assertSucceeds(getDocs(paymentAudit(staffDb("reception"))));
  await assertFails(getDocs(paymentAudit(staffDb("pediatrics"))));
});

test("client payment increases and direct ledger entries are always denied", async () => {
  await seedDocuments([
    ["patients/active-payment-patient", { fullName: "Active Payment", archived: false }],
    ["patients/archived-payment-patient", { fullName: "Archived Payment", archived: true }],
    ["invoices/active-payment-invoice", invoice({
      patientId: "active-payment-patient",
      invoiceNumber: "ASH-20260807-ACTIVE",
    })],
    ["invoices/archived-payment-invoice", invoice({
      patientId: "archived-payment-patient",
      invoiceNumber: "ASH-20260807-ARCHIV",
    })],
  ]);
  const database = staffDb("reception");
  const payment = (invoiceId, invoiceNumber, patientId) => ({
    invoiceId,
    invoiceNumber,
    patientId,
    patientName: "Rules Test Patient",
    amount: 250,
    method: "cash",
    reference: "",
    source: "manual",
    status: "received",
    createdBy: staff.reception.uid,
    createdAt: serverTimestamp(),
  });

  const activeBatch = writeBatch(database);
  activeBatch.update(doc(database, "invoices/active-payment-invoice"), {
    amountPaid: 250,
    balance: 250,
    paymentStatus: "partial",
    paymentMethod: "cash",
    paymentReference: "",
    updatedAt: serverTimestamp(),
    paidAt: null,
  });
  activeBatch.set(
    doc(database, "invoices/active-payment-invoice/payments/payment-1"),
    payment("active-payment-invoice", "ASH-20260807-ACTIVE", "active-payment-patient"),
  );
  await assertFails(activeBatch.commit());

  const archivedBatch = writeBatch(database);
  archivedBatch.update(doc(database, "invoices/archived-payment-invoice"), {
    amountPaid: 250,
    balance: 250,
    paymentStatus: "partial",
    paymentMethod: "cash",
    paymentReference: "",
    updatedAt: serverTimestamp(),
    paidAt: null,
  });
  archivedBatch.set(
    doc(database, "invoices/archived-payment-invoice/payments/payment-1"),
    payment("archived-payment-invoice", "ASH-20260807-ARCHIV", "archived-payment-patient"),
  );
  await assertFails(archivedBatch.commit());
});

test("invoice reductions, payment reversals, and billing audits require protected workflows", async () => {
  await seedDocuments([
    ["patients/reversal-patient", { fullName: "Reversal Patient", archived: false }],
    ["invoices/reversal-invoice", {
      ...invoice({ patientId: "reversal-patient", invoiceNumber: "ASH-20260807-REVERS" }),
      amountPaid: 250,
      balance: 250,
      paymentStatus: "partial",
      paymentMethod: "cash",
    }],
    ["invoices/reversal-invoice/payments/payment-1", {
      invoiceId: "reversal-invoice",
      invoiceNumber: "ASH-20260807-REVERS",
      patientId: "reversal-patient",
      patientName: "Reversal Patient",
      amount: 250,
      method: "cash",
      reference: "",
      source: "manual",
      status: "received",
      createdBy: staff.reception.uid,
      createdAt: Timestamp.fromMillis(1_750_000_000_000),
    }],
  ]);
  await assertFails(updateDoc(doc(staffDb("admin"), "invoices/reversal-invoice"), {
    amountPaid: 0,
    balance: 500,
    paymentStatus: "unpaid",
    paymentMethod: "not_recorded",
    paymentReference: "",
    updatedAt: serverTimestamp(),
    paidAt: null,
  }));
  await assertFails(updateDoc(doc(staffDb("reception"), "invoices/reversal-invoice"), {
    amountPaid: 0,
    balance: 500,
    paymentStatus: "unpaid",
    paymentMethod: "not_recorded",
    paymentReference: "",
    updatedAt: serverTimestamp(),
    paidAt: null,
  }));
  await assertFails(updateDoc(doc(staffDb("admin"), "invoices/reversal-invoice/payments/payment-1"), {
    status: "reversed",
    reversedAt: serverTimestamp(),
    reversedBy: staff.admin.uid,
    reversalReason: "Direct browser reversal",
    auditLogId: "direct-audit",
  }));
  await assertFails(setDoc(doc(staffDb("admin"), "billingAuditLogs/direct-audit"), {
    eventType: "payment.reversed",
    invoiceId: "reversal-invoice",
    invoiceNumber: "ASH-20260807-REVERS",
    paymentId: "payment-1",
    patientId: "reversal-patient",
    patientName: "Reversal Patient",
    amount: 250,
    method: "cash",
    source: "manual",
    reason: "Direct browser reversal",
    actorUid: staff.admin.uid,
    actorName: "Administrator",
    createdAt: serverTimestamp(),
  }));
});

test("payments cannot be deleted, including by admin", async () => {
  await seedDocuments([
    ["invoices/invoice-1", { patientId: "patient-1" }],
    [
      "invoices/invoice-1/payments/payment-1",
      { amount: 500, status: "captured" },
    ],
  ]);
  await assertFails(
    deleteDoc(doc(staffDb("admin"), "invoices/invoice-1/payments/payment-1")),
  );
});

test("invoices cannot be deleted, including by admin", async () => {
  await seedDocuments([
    ["patients/invoice-history-patient", { fullName: "Invoice History", archived: false }],
    ["invoices/invoice-history", invoice({ patientId: "invoice-history-patient" })],
  ]);
  await assertFails(deleteDoc(doc(staffDb("admin"), "invoices/invoice-history")));
});

test("patient records and clinical history cannot be hard-deleted by admin", async () => {
  await seedDocuments([
    ["patients/archive-only", { fullName: "Archive Only Patient" }],
    [
      "patients/archive-only/visits/visit-1",
      { diagnosis: "Private history", createdAt: Timestamp.fromMillis(1_750_000_000_000) },
    ],
  ]);
  const database = staffDb("admin");
  await assertFails(deleteDoc(doc(database, "patients/archive-only")));
  await assertFails(deleteDoc(doc(database, "patients/archive-only/visits/visit-1")));
});

test("a slot is released only with an atomic linked cancellation", async () => {
  await seedDocuments([
    ["appointments/slot-appointment", appointment()],
    [
      "appointmentSlots/slot-1",
      {
        appointmentId: "slot-appointment",
        doctorId: "pediatrics",
        preferredDate: "2026-08-03",
        preferredTime: "17:00",
      },
    ],
  ]);
  const database = staffDb("admin");
  await assertFails(deleteDoc(doc(database, "appointmentSlots/slot-1")));

  const batch = writeBatch(database);
  batch.update(doc(database, "appointments/slot-appointment"), {
    status: "cancelled",
    updatedAt: serverTimestamp(),
  });
  batch.delete(doc(database, "appointmentSlots/slot-1"));
  await assertSucceeds(batch.commit());
});

test("confirmed appointments cannot bypass the queue and consultation workflow", async () => {
  await seedDocuments([
    ["appointments/legacy-admin", appointment({ doctorId: "obg" })],
    ["appointments/legacy-assigned", appointment()],
  ]);
  await assertFails(
    updateDoc(doc(staffDb("admin"), "appointments/legacy-admin"), {
      status: "completed",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    updateDoc(doc(staffDb("pediatrics"), "appointments/legacy-assigned"), {
      status: "completed",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("reception and other doctors cannot complete an assigned appointment directly", async () => {
  await seedDocuments([
    ["appointments/legacy-reception", appointment()],
    ["appointments/legacy-other-doctor", appointment()],
  ]);
  await assertFails(
    updateDoc(doc(staffDb("reception"), "appointments/legacy-reception"), {
      status: "completed",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    updateDoc(doc(staffDb("obg"), "appointments/legacy-other-doctor"), {
      status: "completed",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("communication consent, outbox, and audit collections are server-only", async () => {
  const paths = [
    "communicationPreferences/patient-1",
    "communicationConsentEvents/consent-event-1",
    "communicationOutbox/outbox-1",
    "communicationDeliveryEvents/delivery-event-1",
  ];
  await seedDocuments(paths.map((path) => [path, {
    patientId: "patient-1",
    status: "ready",
    recipient: "+919019263709",
  }]));

  for (const role of ["admin", "reception", "pediatrics"]) {
    const database = staffDb(role);
    for (const path of paths) {
      await assertFails(getDoc(doc(database, path)));
      await assertFails(setDoc(doc(database, path), {
        patientId: "patient-1",
        status: "rewritten",
        recipient: "+919999999999",
      }));
      await assertFails(deleteDoc(doc(database, path)));
    }
  }
});

test("patient portal accounts, grants, consent, and audits are server-only for every browser role", async () => {
  const paths = [
    "patientAccounts/patient-account-1",
    "patientAccounts/patient-account-1/grants/grant-1",
    "patientAccessGrants/grant-1",
    "patientAccessConsents/consent-1",
    "patientAccessAudit/audit-1",
  ];
  await seedDocuments(paths.map((path) => [path, { status: "active", patientId: "patient-1" }]));
  const databases = [
    testEnv.unauthenticatedContext().firestore(),
    testEnv.authenticatedContext("patient-account-1").firestore(),
    ...["admin", "reception", "pediatrics", "obg"].map(staffDb),
  ];
  for (const database of databases) {
    for (const path of paths) {
      await assertFails(getDoc(doc(database, path)));
      await assertFails(setDoc(doc(database, path), { status: "rewritten" }));
      await assertFails(deleteDoc(doc(database, path)));
    }
  }
});

test("patient portal identities cannot directly read or rewrite clinical or billing data", async () => {
  const paths = [
    "patients/patient-1",
    "patients/patient-1/prescriptions/rx-1",
    "patients/patient-1/reports/report-1",
    "appointments/appointment-1",
    "invoices/invoice-1",
    "invoices/invoice-1/payments/payment-1",
  ];
  await seedDocuments(paths.map((path) => [path, { patientId: "patient-1", status: "active" }]));
  const database = testEnv.authenticatedContext("patient-account-1").firestore();
  for (const path of paths) {
    await assertFails(getDoc(doc(database, path)));
    await assertFails(setDoc(doc(database, path), { patientId: "patient-1", status: "rewritten" }));
    await assertFails(deleteDoc(doc(database, path)));
  }
});
