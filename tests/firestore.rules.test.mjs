import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
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

test("legacy completion allows admin and the assigned doctor", async () => {
  await seedDocuments([
    ["appointments/legacy-admin", appointment({ doctorId: "obg" })],
    ["appointments/legacy-assigned", appointment()],
  ]);
  await assertSucceeds(
    updateDoc(doc(staffDb("admin"), "appointments/legacy-admin"), {
      status: "completed",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    updateDoc(doc(staffDb("pediatrics"), "appointments/legacy-assigned"), {
      status: "completed",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("legacy completion denies reception and other doctors", async () => {
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
