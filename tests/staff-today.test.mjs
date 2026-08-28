import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STAFF_TODAY_APPOINTMENT_LIMIT,
  STAFF_TODAY_LAB_REFRESH_TTL_MS,
  STAFF_TODAY_TASK_LIMIT,
  appointmentTodayCounts,
  createStaffTodayLabRefreshCoordinator,
  dueStaffTasks,
  operationalAppointments,
  staffDoctorId,
  urgentDoctorLabs,
} from "../src/lib/staff-today.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
  assert.equal(STAFF_TODAY_LAB_REFRESH_TTL_MS, 30_000);
});

test("urgent lab refreshes deduplicate focus bursts and stay fresh for 30 seconds", async () => {
  let time = 1_000;
  const requests = [];
  const successes = [];
  const errors = [];
  const loading = [];
  const coordinator = createStaffTodayLabRefreshCoordinator({
    now: () => time,
    load(signal) {
      const request = deferred();
      requests.push({ ...request, signal });
      return request.promise;
    },
    onSuccess(value) {
      successes.push(value);
    },
    onError(error) {
      errors.push(error);
    },
    onLoadingChange(value) {
      loading.push(value);
    },
  });

  const first = coordinator.refresh();
  const duplicate = coordinator.refresh();
  assert.equal(duplicate, first);
  await Promise.resolve();
  assert.equal(requests.length, 1);
  requests[0].resolve("first");
  await first;
  assert.deepEqual(successes, ["first"]);
  assert.deepEqual(loading, [true, false]);

  time += STAFF_TODAY_LAB_REFRESH_TTL_MS - 1;
  await coordinator.refresh();
  assert.equal(requests.length, 1);

  time += 1;
  const second = coordinator.refresh();
  await Promise.resolve();
  assert.equal(requests.length, 2);
  requests[1].resolve("second");
  await second;
  assert.deepEqual(successes, ["first", "second"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(loading, [true, false, true, false]);
});

test("forced urgent lab retry aborts the previous request and ignores its stale response", async () => {
  const requests = [];
  const successes = [];
  const errors = [];
  const loading = [];
  const coordinator = createStaffTodayLabRefreshCoordinator({
    load(signal) {
      const request = deferred();
      requests.push({ ...request, signal });
      return request.promise;
    },
    onSuccess(value) {
      successes.push(value);
    },
    onError(error) {
      errors.push(error);
    },
    onLoadingChange(value) {
      loading.push(value);
    },
  });

  const stale = coordinator.refresh();
  await Promise.resolve();
  const current = coordinator.refresh({ force: true });
  await Promise.resolve();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);

  requests[1].resolve("current");
  await current;
  requests[0].resolve("stale");
  await stale;

  assert.deepEqual(successes, ["current"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(loading, [true, false]);
});

test("disposed urgent lab refreshes abort and ignore late completion", async () => {
  const requests = [];
  const successes = [];
  const errors = [];
  const coordinator = createStaffTodayLabRefreshCoordinator({
    load(signal) {
      const request = deferred();
      requests.push({ ...request, signal });
      return request.promise;
    },
    onSuccess(value) {
      successes.push(value);
    },
    onError(error) {
      errors.push(error);
    },
    onLoadingChange() {},
  });

  const pending = coordinator.refresh();
  await Promise.resolve();
  coordinator.dispose();
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve("late");
  await pending;
  await coordinator.refresh();
  assert.deepEqual(successes, []);
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 1);
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
  const routeSource = await readFile(
    new URL("../functions/api/staff/labs/directory.js", import.meta.url),
    "utf8",
  );
  const indexes = JSON.parse(await readFile(
    new URL("../firestore.indexes.json", import.meta.url),
    "utf8",
  ));

  assert.match(source, /where\("preferredDate", "==", today\)/u);
  assert.match(source, /where\("doctorId", "==", doctorId\)/u);
  assert.match(source, /where\("assignedTo", "==", profile\.uid\)/u);
  assert.match(source, /where\("status", "==", "open"\)/u);
  assert.match(source, /where\("dueDate", "<=", today\)/u);
  assert.match(source, /limit\(STAFF_TODAY_APPOINTMENT_LIMIT\)/u);
  assert.match(source, /limit\(STAFF_TODAY_TASK_LIMIT\)/u);
  assert.match(source, /return onSnapshot\(appointmentsQuery/u);
  assert.match(source, /return onSnapshot\(tasksQuery/u);
  assert.match(source, /\/api\/staff\/labs\/directory\?view=today-urgent/u);
  assert.match(source, /signal,/u);
  assert.match(source, /createStaffTodayLabRefreshCoordinator/u);
  assert.match(source, /onRetry=\{retryLabs\}/u);
  assert.doesNotMatch(source, /setInterval/u);
  assert.match(source, /stageAdminNavigationHandoff/u);
  assert.match(
    source,
    /intent: "open-lab-order",[\s\S]*?orderId: order\.id,[\s\S]*?router\.push\("\/admin\/lab\?priority=urgent"\)/u,
  );
  assert.match(source, /href="\/admin\/lab\?priority=urgent"/u);
  assert.doesNotMatch(source, /\b(?:addDoc|updateDoc|deleteDoc|runTransaction|writeBatch)\b/u);
  assert.match(adminSource, /profile\.role === "admin"[\s\S]*?<AdminDashboard \/>[\s\S]*?<StaffTodayWorkspace \/>/u);
  assert.match(routeSource, /view === "today-urgent"[\s\S]*urgentDoctorLabDirectoryForStaff/u);
  assert.equal(indexes.indexes.some((index) => (
    index.collectionGroup === "labOrders"
    && JSON.stringify(index.fields) === JSON.stringify([
      { fieldPath: "clinician", order: "ASCENDING" },
      { fieldPath: "priority", order: "ASCENDING" },
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "orderedAt", order: "DESCENDING" },
    ])
  )), true);
});

test("the staff Today screen never presents failed or partial reads as all clear", async () => {
  const source = await readFile(
    new URL("../src/components/admin/StaffTodayWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const displayedValue = loading \|\| unavailable/u);
  assert.match(source, /unavailable=\{labSummary \? labsUnavailable : Boolean\(appointmentsError\)\}/u);
  assert.match(source, /appointmentsError \? \([\s\S]*?<UnavailablePanel/u);
  assert.match(source, /tasksError \? <UnavailablePanel/u);
  assert.match(source, /labsError && !labsHasSucceeded \? <div[\s\S]*?<UnavailablePanel/u);
  assert.match(source, /truncated\?: boolean/u);
  assert.match(source, /setLabsTruncated\(result\.truncated === true\)/u);
  assert.match(source, /incomplete=\{labSummary && labsTruncated\}/u);
  assert.match(source, /This is a partial lab snapshot/u);
  assert.match(source, /labsTruncated \|\| labsError \? null : <p/u);
});

test("urgent lab refresh preserves the last good snapshot and exposes accessible recovery", async () => {
  const source = await readFile(
    new URL("../src/components/admin/StaffTodayWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const initialLabsLoading = labsLoading && !labsHasSucceeded && !labsError/u);
  assert.match(source, /labsHaveSuccessfulSnapshotRef\.current = true/u);
  assert.match(source, /setLabsHasSucceeded\(true\)/u);

  const onErrorStart = source.indexOf("onError(loadError)");
  const onLoadingStart = source.indexOf("onLoadingChange(loading)", onErrorStart);
  const onErrorSource = source.slice(onErrorStart, onLoadingStart);
  assert.doesNotMatch(onErrorSource, /setLabOrders\(\[\]\)/u);
  assert.doesNotMatch(onErrorSource, /setLabsTruncated\(false\)/u);

  assert.match(source, /aria-busy=\{labsLoading\}/u);
  assert.match(source, /role="status" aria-live="polite"/u);
  assert.match(source, /retrying=\{labsLoading\}/u);
  assert.match(source, /disabled=\{retrying\}/u);
  assert.match(source, /grid-cols-1 sm:grid-cols-2/u);
  assert.match(source, /Refreshing urgent lab work/u);
});
