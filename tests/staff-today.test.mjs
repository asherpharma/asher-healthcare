import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STAFF_TODAY_APPOINTMENT_LIMIT,
  STAFF_TODAY_TASK_LIMIT,
  appointmentTodayCounts,
  dueStaffTasks,
  operationalAppointments,
  staffDoctorId,
  urgentDoctorLabs,
} from "../src/lib/staff-today.ts";

const appointments = [
  { id: "completed", patientName: "Done", doctorId: "pediatrics", preferredDate: "2026-08-28", preferredTime: "17:00", status: "completed" },
  { id: "waiting-2", patientName: "Second", doctorId: "pediatrics", preferredDate: "2026-08-28", preferredTime: "17:30", status: "waiting", queueToken: 2 },
  { id: "request", patientName: "Request", doctorId: "obg", preferredDate: "2026-08-28", preferredTime: "18:00", status: "requested" },
  { id: "consulting", patientName: "Current", doctorId: "pediatrics", preferredDate: "2026-08-28", preferredTime: "17:15", status: "in_consultation", queueToken: 1 },
  { id: "waiting-1", patientName: "First", doctorId: "pediatrics", preferredDate: "2026-08-28", preferredTime: "17:20", status: "checked_in", queueToken: 1 },
  { id: "cancelled", patientName: "Cancelled", doctorId: "obg", preferredDate: "2026-08-28", preferredTime: "19:00", status: "cancelled" },
];

test("today appointment windows remain explicitly bounded", () => {
  assert.equal(STAFF_TODAY_APPOINTMENT_LIMIT, 80);
  assert.equal(STAFF_TODAY_TASK_LIMIT, 60);
});

test("staff doctor mapping rejects unassigned or unexpected profiles", () => {
  assert.equal(staffDoctorId("Dr. Lt Col Shafi Ahamad"), "pediatrics");
  assert.equal(staffDoctorId("Dr. Shaik Reshma"), "obg");
  assert.equal(staffDoctorId(""), null);
  assert.equal(staffDoctorId("Another doctor"), null);
});

test("role-aware queues exclude closed visits and put each role's next work first", () => {
  assert.deepEqual(
    operationalAppointments(appointments, "reception").map(({ id }) => id),
    ["request", "waiting-1", "waiting-2", "consulting"],
  );
  assert.deepEqual(
    operationalAppointments(appointments, "doctor").map(({ id }) => id),
    ["consulting", "waiting-2", "waiting-1", "request"],
  );
});

test("today counts preserve operational status meanings", () => {
  assert.deepEqual(appointmentTodayCounts(appointments), {
    requested: 1,
    expected: 0,
    inClinic: 3,
    waiting: 2,
    consulting: 1,
    completed: 1,
  });
});

test("only assigned open tasks due now are prioritized by date, urgency and time", () => {
  const due = dueStaffTasks([
    { id: "future", title: "Future", type: "general", priority: "urgent", status: "open", dueDate: "2026-08-29", dueTime: "09:00" },
    { id: "closed", title: "Closed", type: "general", priority: "urgent", status: "completed", dueDate: "2026-08-26", dueTime: "09:00" },
    { id: "medium", title: "Medium", type: "follow_up", priority: "medium", status: "open", dueDate: "2026-08-28", dueTime: "09:00" },
    { id: "urgent", title: "Urgent", type: "lab", priority: "urgent", status: "open", dueDate: "2026-08-28", dueTime: "11:00" },
    { id: "overdue", title: "Overdue", type: "callback", priority: "low", status: "open", dueDate: "2026-08-27", dueTime: "18:00" },
  ], "2026-08-28");
  assert.deepEqual(due.map(({ id }) => id), ["overdue", "urgent", "medium"]);
});

test("urgent labs remain active and scoped to the signed-in doctor", () => {
  const urgent = urgentDoctorLabs([
    { id: "mine", orderNumber: "LAB-1", patientName: "One", clinician: "Dr. Shaik Reshma", priority: "urgent", status: "processing" },
    { id: "done", orderNumber: "LAB-2", patientName: "Two", clinician: "Dr. Shaik Reshma", priority: "urgent", status: "completed" },
    { id: "other", orderNumber: "LAB-3", patientName: "Three", clinician: "Dr. Lt Col Shafi Ahamad", priority: "urgent", status: "ordered" },
    { id: "routine", orderNumber: "LAB-4", patientName: "Four", clinician: "Dr. Shaik Reshma", priority: "routine", status: "ordered" },
  ], "Dr. Shaik Reshma");
  assert.deepEqual(urgent.map(({ id }) => id), ["mine"]);
});

test("the staff Today screen uses bounded live reads and delegates all writes", async () => {
  const source = await readFile(
    new URL("../src/components/admin/StaffTodayWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const adminSource = await readFile(
    new URL("../src/app/admin/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /where\("preferredDate", "==", today\)/u);
  assert.match(source, /where\("doctorId", "==", doctorId\)/u);
  assert.match(source, /where\("assignedTo", "==", profile\.uid\)/u);
  assert.match(source, /where\("status", "==", "open"\)/u);
  assert.match(source, /where\("dueDate", "<=", today\)/u);
  assert.match(source, /limit\(STAFF_TODAY_APPOINTMENT_LIMIT\)/u);
  assert.match(source, /limit\(STAFF_TODAY_TASK_LIMIT\)/u);
  assert.match(source, /return onSnapshot\(appointmentsQuery/u);
  assert.match(source, /return onSnapshot\(tasksQuery/u);
  assert.match(source, /\/api\/staff\/labs\/directory/u);
  assert.doesNotMatch(source, /setInterval/u);
  assert.match(source, /stageAdminNavigationHandoff/u);
  assert.doesNotMatch(source, /\b(?:addDoc|updateDoc|deleteDoc|runTransaction|writeBatch)\b/u);
  assert.match(adminSource, /profile\.role === "admin"[\s\S]*?<AdminDashboard \/>[\s\S]*?<StaffTodayWorkspace \/>/u);
});

test("the staff Today screen never presents failed or partial reads as all clear", async () => {
  const source = await readFile(
    new URL("../src/components/admin/StaffTodayWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const displayedValue = loading \|\| unavailable/u);
  assert.match(source, /unavailable=\{Boolean\(labSummary \? labsError : appointmentsError\)\}/u);
  assert.match(source, /appointmentsError \? \([\s\S]*?<UnavailablePanel/u);
  assert.match(source, /tasksError \? <UnavailablePanel/u);
  assert.match(source, /labsError \? <div[\s\S]*?<UnavailablePanel/u);
  assert.match(source, /truncated\?: boolean/u);
  assert.match(source, /setLabsTruncated\(result\.truncated === true\)/u);
  assert.match(source, /incomplete=\{labSummary && labsTruncated\}/u);
  assert.match(source, /This is a partial lab snapshot/u);
  assert.match(source, /labsTruncated \? null : <p[^>]*>No active urgent lab order/u);
});
