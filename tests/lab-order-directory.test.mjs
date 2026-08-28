import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLabDirectoryStaff,
  assertUrgentDoctorLabStaff,
  boundedLabOrderDirectory,
  boundedDoctorUrgentLabPage,
  boundedUrgentDoctorLabDirectory,
  decodeDoctorUrgentLabCursor,
  DOCTOR_URGENT_LAB_DEFAULT_PAGE_SIZE,
  DOCTOR_URGENT_LAB_DESK_FIELDS,
  DOCTOR_URGENT_LAB_MAX_PAGE_SIZE,
  doctorUrgentLabDirectoryPageForStaff,
  doctorUrgentLabDirectoryQuery,
  encodeDoctorUrgentLabCursor,
  LAB_ORDER_DIRECTORY_FIELDS,
  labOrderDirectoryForStaff,
  labOrderPatientIdBatches,
  labOrderDirectoryQuery,
  normalizeDoctorUrgentLabPageSize,
  projectDoctorUrgentLabDeskDirectory,
  projectLabOrderDirectory,
  projectUrgentDoctorLabDirectory,
  URGENT_DOCTOR_LAB_FIELDS,
  URGENT_DOCTOR_LAB_LIMIT,
  urgentDoctorLabDirectoryForStaff,
  urgentDoctorLabOrderQuery,
} from "../server/labs/directory.js";
import { labDirectoryForStaffView } from "../functions/api/staff/labs/directory.js";

const activePatients = [
  {
    id: "patient-active",
    patientNumber: "ASH-0001",
    fullName: "Current Patient",
    phone: "9000000001",
  },
];

test("lab directory projects only reception-safe operational fields", () => {
  const [order] = projectLabOrderDirectory([
    {
      id: "order-1",
      orderNumber: "LAB-20260810-0001",
      patientId: "patient-active",
      patientNumber: "STALE-NUMBER",
      patientName: "Stale Name",
      patientPhone: "9999999999",
      tests: ["CBC", "  Thyroid  ", null, ""],
      priority: "routine",
      clinician: "Dr. Lt Col Shafi Ahamad",
      status: "completed",
      orderedAt: "2026-08-10T10:00:00.000Z",
      completedAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T12:00:00.000Z",
      resultSummary: "Never expose this interpretation",
      reportStoragePath: "reports/patient-active/private.pdf",
      reportFileName: "private.pdf",
      reportContentType: "application/pdf",
      reportSize: 42_000,
      notes: "Clinical notes must remain private",
    },
  ], activePatients);

  assert.deepEqual(Object.keys(order).sort(), [
    "clinician",
    "completedAt",
    "id",
    "orderNumber",
    "orderedAt",
    "patientId",
    "patientName",
    "patientNumber",
    "patientPhone",
    "priority",
    "reportAttached",
    "status",
    "tests",
    "updatedAt",
  ]);
  assert.equal(order.patientName, "Current Patient");
  assert.equal(order.patientNumber, "ASH-0001");
  assert.equal(order.patientPhone, "9000000001");
  assert.deepEqual(order.tests, ["CBC", "Thyroid"]);
  assert.equal(order.reportAttached, true);
  assert.equal("resultSummary" in order, false);
  assert.equal("reportStoragePath" in order, false);
  assert.equal("reportFileName" in order, false);
  assert.equal("reportContentType" in order, false);
  assert.equal("reportSize" in order, false);
  assert.equal("notes" in order, false);
});

test("lab directory excludes orders without an active patient association", () => {
  const orders = projectLabOrderDirectory([
    { id: "active", patientId: "patient-active" },
    { id: "archived", patientId: "patient-archived" },
    { id: "missing", patientId: "" },
  ], activePatients);

  assert.deepEqual(orders.map((order) => order.id), ["active"]);
  assert.equal(orders[0].reportAttached, false);
});

test("Firestore query is bounded and newest-first; clinical fields remain server projected", () => {
  const query = labOrderDirectoryQuery();
  const selected = query.select.fields.map(({ fieldPath }) => fieldPath);

  assert.equal(query.limit, 301);
  assert.deepEqual(query.orderBy, [{
    field: { fieldPath: "orderedAt" },
    direction: "DESCENDING",
  }]);
  LAB_ORDER_DIRECTORY_FIELDS.forEach((field) => assert.equal(selected.includes(field), true));
  assert.equal(selected.includes("reportStoragePath"), true);
  [
    "notes",
    "resultSummary",
    "reportStoragePath",
  ].forEach((field) => assert.equal(selected.includes(field), true));
  [
    "reportFileName",
    "reportContentType",
    "reportSize",
  ].forEach((field) => assert.equal(selected.includes(field), false));
});

test("directory window exposes truncation without returning the extra order", () => {
  const input = Array.from({ length: 301 }, (_, index) => ({ id: `order-${index}` }));
  const window = boundedLabOrderDirectory(input);
  assert.equal(window.documents.length, 300);
  assert.equal(window.documents.at(-1).id, "order-299");
  assert.equal(window.truncated, true);
  assert.equal(window.limit, 300);

  const complete = boundedLabOrderDirectory(input.slice(0, 300));
  assert.equal(complete.documents.length, 300);
  assert.equal(complete.truncated, false);
});

test("Staff Today urgent query applies exact doctor, urgency, and active status before its 20-order limit", () => {
  const query = urgentDoctorLabOrderQuery("Dr. Shaik Reshma");
  const filters = query.where.compositeFilter.filters.map(({ fieldFilter }) => ({
    field: fieldFilter.field.fieldPath,
    op: fieldFilter.op,
    value: fieldFilter.value,
  }));

  assert.equal(query.limit, URGENT_DOCTOR_LAB_LIMIT);
  assert.equal(query.limit, 20);
  assert.deepEqual(query.orderBy, [{
    field: { fieldPath: "orderedAt" },
    direction: "DESCENDING",
  }]);
  assert.deepEqual(filters, [
    {
      field: "clinician",
      op: "EQUAL",
      value: { stringValue: "Dr. Shaik Reshma" },
    },
    {
      field: "priority",
      op: "EQUAL",
      value: { stringValue: "urgent" },
    },
    {
      field: "status",
      op: "IN",
      value: {
        arrayValue: {
          values: ["ordered", "collected", "processing"]
            .map((status) => ({ stringValue: status })),
        },
      },
    },
  ]);
  assert.deepEqual(
    query.select.fields.map(({ fieldPath }) => fieldPath),
    URGENT_DOCTOR_LAB_FIELDS,
  );
  [
    "patientName",
    "patientPhone",
    "patientNumber",
    "notes",
    "resultSummary",
    "reportStoragePath",
  ].forEach((field) => {
    assert.equal(URGENT_DOCTOR_LAB_FIELDS.includes(field), false);
  });
});

test("doctor urgent Lab Desk cursors are opaque, validated, and bound to the exact doctor query", () => {
  const pediatricsKey = "doctor-urgent-active:v1:Dr. Lt Col Shafi Ahamad";
  const obgKey = "doctor-urgent-active:v1:Dr. Shaik Reshma";
  const cursor = encodeDoctorUrgentLabCursor({
    queryKey: pediatricsKey,
    orderedAt: "2026-08-28T12:00:00.000Z",
    id: "order-25",
  });

  assert.match(cursor, /^[A-Za-z0-9_-]+$/u);
  assert.equal(cursor.includes("order-25"), false);
  assert.deepEqual(decodeDoctorUrgentLabCursor(cursor, pediatricsKey), {
    orderedAt: "2026-08-28T12:00:00.000Z",
    id: "order-25",
  });
  assert.throws(
    () => decodeDoctorUrgentLabCursor(cursor, obgKey),
    /page expired/u,
  );
  assert.throws(
    () => decodeDoctorUrgentLabCursor("not-a-valid-cursor!", pediatricsKey),
    /page expired/u,
  );
});

test("doctor urgent Lab Desk query scopes before its cursor page limit", () => {
  const query = doctorUrgentLabDirectoryQuery(
    { FIREBASE_PROJECT_ID: "asher-test" },
    "Dr. Shaik Reshma",
    {
      pageSize: 25,
      cursor: {
        orderedAt: "2026-08-28T12:00:00.000Z",
        id: "order-25",
      },
    },
  );
  const filters = query.where.compositeFilter.filters;

  assert.equal(query.limit, 26);
  assert.deepEqual(query.orderBy, [
    {
      field: { fieldPath: "orderedAt" },
      direction: "DESCENDING",
    },
    {
      field: { fieldPath: "__name__" },
      direction: "DESCENDING",
    },
  ]);
  assert.equal(filters.some(({ fieldFilter }) => (
    fieldFilter.field.fieldPath === "clinician"
    && fieldFilter.op === "EQUAL"
    && fieldFilter.value.stringValue === "Dr. Shaik Reshma"
  )), true);
  assert.equal(filters.some(({ fieldFilter }) => (
    fieldFilter.field.fieldPath === "priority"
    && fieldFilter.op === "EQUAL"
    && fieldFilter.value.stringValue === "urgent"
  )), true);
  assert.equal(filters.some(({ fieldFilter }) => (
    fieldFilter.field.fieldPath === "status"
    && fieldFilter.op === "IN"
    && fieldFilter.value.arrayValue.values
      .map(({ stringValue }) => stringValue)
      .join(",") === "ordered,collected,processing"
  )), true);
  assert.deepEqual(
    query.select.fields.map(({ fieldPath }) => fieldPath),
    DOCTOR_URGENT_LAB_DESK_FIELDS,
  );
  assert.equal(query.startAt.before, false);
  assert.deepEqual(query.startAt.values[0], {
    timestampValue: "2026-08-28T12:00:00.000Z",
  });
  assert.match(query.startAt.values[1].referenceValue, /labOrders\/order-25$/u);
});

test("doctor urgent Lab Desk page sizes are bounded without a global result cap", () => {
  assert.equal(normalizeDoctorUrgentLabPageSize(undefined), DOCTOR_URGENT_LAB_DEFAULT_PAGE_SIZE);
  assert.equal(normalizeDoctorUrgentLabPageSize(0), 1);
  assert.equal(normalizeDoctorUrgentLabPageSize(500), DOCTOR_URGENT_LAB_MAX_PAGE_SIZE);

  const queryKey = "doctor-urgent-active:v1:Dr. Shaik Reshma";
  const input = Array.from({ length: 26 }, (_, index) => ({
    id: `order-${index}`,
    orderedAt: new Date(Date.UTC(2026, 7, 28, 12) - index * 60_000).toISOString(),
  }));
  const page = boundedDoctorUrgentLabPage(input, { pageSize: 25, queryKey });
  assert.equal(page.documents.length, 25);
  assert.equal(page.hasMore, true);
  assert.equal(page.pageSize, 25);
  assert.deepEqual(decodeDoctorUrgentLabCursor(page.nextCursor, queryKey), {
    orderedAt: input[24].orderedAt,
    id: "order-24",
  });

  const finalPage = boundedDoctorUrgentLabPage(input.slice(0, 25), {
    pageSize: 25,
    queryKey,
  });
  assert.equal(finalPage.documents.length, 25);
  assert.equal(finalPage.hasMore, false);
  assert.equal(finalPage.nextCursor, "");
  assert.throws(
    () => boundedDoctorUrgentLabPage([
      ...input.slice(0, 24),
      { id: "order-invalid", orderedAt: "not-a-date" },
      input[25],
    ], { pageSize: 25, queryKey }),
    /could not continue/u,
  );
});

test("doctor urgent Lab Desk projection contains only fields required by the doctor workflow", () => {
  const doctor = {
    role: "doctor",
    doctorName: "Dr. Shaik Reshma",
  };
  const projected = projectDoctorUrgentLabDeskDirectory([
    {
      id: "visible",
      orderNumber: "LAB-1",
      patientId: "patient-active",
      patientNumber: "STALE",
      patientName: "Stale",
      patientPhone: "9999999999",
      tests: ["CBC"],
      priority: "urgent",
      clinician: doctor.doctorName,
      status: "processing",
      orderedAt: "2026-08-28T12:00:00.000Z",
      completedAt: "",
      updatedAt: "2026-08-28T12:01:00.000Z",
      notes: "Doctor note",
      resultSummary: "Pending confirmation",
      reportStoragePath: "reports/private.pdf",
    },
    {
      id: "wrong-clinician",
      patientId: "patient-active",
      priority: "urgent",
      clinician: "Dr. Lt Col Shafi Ahamad",
      status: "ordered",
    },
  ], [{
    id: "patient-active",
    fullName: "Current Patient",
    patientNumber: "ASH-1",
    phone: "9000000000",
  }], doctor);

  assert.equal(projected.length, 1);
  assert.deepEqual(Object.keys(projected[0]).sort(), [
    "clinician",
    "completedAt",
    "id",
    "notes",
    "orderNumber",
    "orderedAt",
    "patientId",
    "patientName",
    "patientNumber",
    "patientPhone",
    "priority",
    "reportAttached",
    "resultSummary",
    "status",
    "tests",
  ]);
  assert.equal(projected[0].patientName, "Current Patient");
  assert.equal(projected[0].patientPhone, "9000000000");
  assert.equal(projected[0].reportAttached, true);
  assert.equal("reportStoragePath" in projected[0], false);
  assert.equal("updatedAt" in projected[0], false);
});

test("doctor urgent Lab Desk pagination reaches every order beyond the former 300-order window", async () => {
  const doctor = {
    uid: "doctor-1",
    role: "doctor",
    doctorName: "Dr. Lt Col Shafi Ahamad",
  };
  const allOrders = Array.from({ length: 325 }, (_, index) => ({
    id: `order-${String(index).padStart(3, "0")}`,
    orderNumber: `LAB-${index}`,
    patientId: "patient-active",
    tests: ["CBC"],
    priority: "urgent",
    clinician: doctor.doctorName,
    status: "ordered",
    orderedAt: new Date(Date.UTC(2026, 7, 28, 12) - index * 60_000).toISOString(),
    notes: "Urgent review",
  }));
  const reads = [];
  const collected = [];
  let cursor = "";
  let pageCount = 0;
  let hasMore = false;

  do {
    const page = await doctorUrgentLabDirectoryPageForStaff(
      {},
      doctor,
      { cursor, pageSize: 25 },
      {
        async listDoctorUrgentLabOrderDocuments(_env, staff, options) {
          assert.equal(staff, doctor);
          assert.equal(options.pageSize, 25);
          const startIndex = options.cursor
            ? allOrders.findIndex(({ id }) => id === options.cursor.id) + 1
            : 0;
          return allOrders.slice(startIndex, startIndex + options.pageSize + 1);
        },
        async getDocument(_env, path) {
          reads.push(path);
          assert.equal(path, "patients/patient-active");
          return {
            data: {
              fullName: "Assigned Patient",
              patientNumber: "ASH-1",
              phone: "9000000000",
              doctorName: doctor.doctorName,
            },
          };
        },
      },
    );
    pageCount += 1;
    collected.push(...page.labOrders.map(({ id }) => id));
    cursor = page.nextCursor;
    hasMore = page.hasMore;
    assert.equal(page.pageSize, 25);
  } while (hasMore);

  assert.equal(pageCount, 13);
  assert.equal(reads.length, 13);
  assert.equal(collected.length, 325);
  assert.equal(new Set(collected).size, 325);
  assert.equal(collected.at(-1), "order-324");
  assert.equal(cursor, "");
});

test("urgent Staff Today windows stay within 20 reads and conservatively disclose a full page", () => {
  const input = Array.from({ length: 25 }, (_, index) => ({ id: `order-${index}` }));
  const full = boundedUrgentDoctorLabDirectory(input);
  assert.equal(full.documents.length, 20);
  assert.equal(full.documents.at(-1).id, "order-19");
  assert.equal(full.truncated, true);
  assert.equal(full.limit, 20);

  const complete = boundedUrgentDoctorLabDirectory(input.slice(0, 19));
  assert.equal(complete.documents.length, 19);
  assert.equal(complete.truncated, false);
});

test("urgent Staff Today projection is doctor-exact, active-only, and minimal", () => {
  const doctor = {
    uid: "doctor-1",
    role: "doctor",
    doctorName: "Dr. Lt Col Shafi Ahamad",
  };
  const projected = projectUrgentDoctorLabDirectory([
    {
      id: "mine",
      orderNumber: "LAB-1",
      patientId: "patient-active",
      patientPhone: "9000000000",
      patientNumber: "ASH-1",
      patientName: "Stale name",
      tests: [" CBC ", ""],
      priority: "urgent",
      clinician: doctor.doctorName,
      status: "processing",
      orderedAt: "2026-08-28T12:00:00.000Z",
      notes: "Private",
      resultSummary: "Private",
      reportStoragePath: "private/report.pdf",
    },
    {
      id: "wrong-doctor",
      patientId: "patient-active",
      priority: "urgent",
      clinician: "Dr. Shaik Reshma",
      status: "ordered",
    },
    {
      id: "completed",
      patientId: "patient-active",
      priority: "urgent",
      clinician: doctor.doctorName,
      status: "completed",
    },
    {
      id: "routine",
      patientId: "patient-active",
      priority: "routine",
      clinician: doctor.doctorName,
      status: "ordered",
    },
  ], activePatients, doctor);
  assert.equal(projected.length, 1);
  const [order] = projected;

  assert.deepEqual(Object.keys(order).sort(), [
    "clinician",
    "id",
    "orderNumber",
    "patientName",
    "priority",
    "status",
    "tests",
  ]);
  assert.equal(order.patientName, "Current Patient");
  assert.deepEqual(order.tests, ["CBC"]);
  assert.equal(JSON.stringify(order).includes("Private"), false);
  assert.equal(projectUrgentDoctorLabDirectory([], [], doctor).length, 0);
});

test("urgent Staff Today resolves no more than 20 exact patient charts and never re-reads staff", async () => {
  const doctor = {
    uid: "doctor-1",
    role: "doctor",
    doctorName: "Dr. Lt Col Shafi Ahamad",
  };
  // Even a malformed dependency result cannot expand the exact-chart read
  // budget beyond the server contract.
  const documents = Array.from({ length: 300 }, (_, index) => ({
    id: `order-${index}`,
    orderNumber: `LAB-${index}`,
    patientId: `patient-${index}`,
    tests: ["CBC"],
    priority: "urgent",
    clinician: doctor.doctorName,
    status: "ordered",
    orderedAt: `2026-08-28T12:${String(index).padStart(2, "0")}:00.000Z`,
  }));
  const reads = [];
  let listCalls = 0;

  const result = await urgentDoctorLabDirectoryForStaff({}, doctor, {
    async listUrgentDoctorLabOrderDocuments(_env, staff) {
      listCalls += 1;
      assert.equal(staff, doctor);
      return { documents, truncated: true, limit: 20 };
    },
    async getDocument(_env, path) {
      reads.push(path);
      assert.match(path, /^patients\/patient-\d+$/u);
      return {
        data: {
          fullName: `Name ${path.split("-").at(-1)}`,
          doctorName: doctor.doctorName,
        },
      };
    },
  });

  assert.equal(listCalls, 1);
  assert.equal(reads.length, 20);
  assert.equal(reads.some((path) => path.startsWith("staff/")), false);
  assert.equal(new Set(reads).size, 20);
  assert.equal(result.labOrders.length, 20);
  assert.equal(result.truncated, true);
  assert.equal(result.limit, 20);
});

test("urgent Staff Today drops archived and out-of-assignment charts without a staff read", async () => {
  const doctor = {
    uid: "doctor-1",
    role: "doctor",
    doctorName: "Dr. Shaik Reshma",
  };
  const baseOrder = {
    priority: "urgent",
    clinician: doctor.doctorName,
    status: "collected",
  };
  const documents = [
    { ...baseOrder, id: "visible", patientId: "visible-patient" },
    { ...baseOrder, id: "archived", patientId: "archived-patient" },
    { ...baseOrder, id: "other", patientId: "other-patient" },
    { ...baseOrder, id: "invalid", patientId: "../staff/admin" },
  ];
  const records = new Map([
    ["patients/visible-patient", { data: { fullName: "Visible", doctorId: "obg" } }],
    ["patients/archived-patient", { data: { fullName: "Archived", doctorName: doctor.doctorName, archived: true } }],
    ["patients/other-patient", { data: { fullName: "Other", doctorName: "Dr. Lt Col Shafi Ahamad" } }],
  ]);
  const reads = [];

  const result = await urgentDoctorLabDirectoryForStaff({}, doctor, {
    async listUrgentDoctorLabOrderDocuments() {
      return { documents, truncated: false, limit: 20 };
    },
    async getDocument(_env, path) {
      reads.push(path);
      return records.get(path) || null;
    },
  });

  assert.deepEqual(result.labOrders.map(({ id }) => id), ["visible"]);
  assert.deepEqual(reads.sort(), [
    "patients/archived-patient",
    "patients/other-patient",
    "patients/visible-patient",
  ]);
  assert.equal(reads.some((path) => path.startsWith("staff/")), false);
});

test("active admin, doctor, and reception roles may use the server directory", () => {
  assert.equal(assertLabDirectoryStaff({ role: "admin" }).role, "admin");
  assert.equal(assertLabDirectoryStaff({ role: "doctor" }).role, "doctor");
  assert.equal(assertLabDirectoryStaff({ role: "reception" }).role, "reception");
  assert.throws(() => assertLabDirectoryStaff(null), /active clinic staff/u);
});

test("urgent Staff Today access requires an exact canonical doctor assignment", () => {
  assert.equal(
    assertUrgentDoctorLabStaff({
      role: "doctor",
      doctorName: "Dr. Shaik Reshma",
    }).role,
    "doctor",
  );
  assert.throws(
    () => assertUrgentDoctorLabStaff({ role: "reception" }),
    /not linked to a clinic doctor/u,
  );
  assert.throws(
    () => assertUrgentDoctorLabStaff({ role: "doctor", doctorName: "Unknown" }),
    /not linked to a clinic doctor/u,
  );
});

test("lab directory API keeps existing views and exposes a separate doctor urgent page contract", async () => {
  const doctor = {
    uid: "doctor-1",
    role: "doctor",
    doctorName: "Dr. Shaik Reshma",
  };
  const calls = [];
  const dependencies = {
    async labOrderDirectoryForStaff(_env, staff) {
      calls.push({ view: "full", staff });
      return { labOrders: ["full"] };
    },
    async urgentDoctorLabDirectoryForStaff(_env, staff) {
      calls.push({ view: "today", staff });
      return { labOrders: ["today"], limit: 20 };
    },
    async doctorUrgentLabDirectoryPageForStaff(_env, staff, options) {
      calls.push({ view: "doctor-urgent", staff, options });
      return {
        labOrders: ["page"],
        nextCursor: "next-opaque",
        hasMore: true,
        pageSize: 17,
      };
    },
  };

  assert.deepEqual(
    await labDirectoryForStaffView(
      {},
      doctor,
      "https://clinic.example/api/staff/labs/directory",
      dependencies,
    ),
    { labOrders: ["full"] },
  );
  assert.deepEqual(
    await labDirectoryForStaffView(
      {},
      doctor,
      "https://clinic.example/api/staff/labs/directory?view=today-urgent",
      dependencies,
    ),
    { labOrders: ["today"], limit: 20 },
  );
  assert.deepEqual(
    await labDirectoryForStaffView(
      {},
      doctor,
      "https://clinic.example/api/staff/labs/directory?view=doctor-urgent&pageSize=17&cursor=opaque-page",
      dependencies,
    ),
    {
      labOrders: ["page"],
      nextCursor: "next-opaque",
      hasMore: true,
      pageSize: 17,
    },
  );
  assert.deepEqual(calls.map(({ view }) => view), [
    "full",
    "today",
    "doctor-urgent",
  ]);
  assert.deepEqual(calls[2].options, {
    cursor: "opaque-page",
    pageSize: "17",
  });
  await assert.rejects(
    () => labDirectoryForStaffView(
      {},
      doctor,
      "https://clinic.example/api/staff/labs/directory?view=unknown",
      dependencies,
    ),
    /not supported/u,
  );
  await assert.rejects(
    () => doctorUrgentLabDirectoryPageForStaff(
      {},
      { uid: "admin-1", role: "admin" },
      {},
      {
        async listDoctorUrgentLabOrderDocuments() {
          throw new Error("must not query");
        },
      },
    ),
    /not linked to a clinic doctor/u,
  );
});

test("doctor projection includes clinical fields only after patient-scope filtering", () => {
  const [order] = projectLabOrderDirectory([{
    id: "order-1",
    patientId: "patient-active",
    clinician: "Dr. Lt Col Shafi Ahamad",
    notes: "Fasting sample",
    resultSummary: "Normal",
    reportStoragePath: "reports/patient-active/report.pdf",
  }], activePatients, {
    role: "doctor",
    doctorName: "Dr. Lt Col Shafi Ahamad",
  });

  assert.equal(order.notes, "Fasting sample");
  assert.equal(order.resultSummary, "Normal");
  assert.equal(order.reportAttached, true);
  assert.equal("reportFileName" in order, false);
  assert.equal("reportStoragePath" in order, false);
  assert.equal("reportContentType" in order, false);
  assert.equal("reportSize" in order, false);
});

test("doctor response excludes another clinician's order for the same assigned patient", async () => {
  const documents = [
    {
      id: "own-order",
      patientId: "shared-patient",
      clinician: "Dr. Lt Col Shafi Ahamad",
      notes: "Own clinical note",
      resultSummary: "Own result",
    },
    {
      id: "other-clinician-order",
      patientId: "shared-patient",
      clinician: "Dr. Shaik Reshma",
      notes: "Other clinician private note",
      resultSummary: "Other clinician private result",
    },
  ];
  const patient = {
    id: "shared-patient",
    fullName: "Shared Patient",
    doctorName: "Dr. Lt Col Shafi Ahamad",
  };
  const doctor = {
    uid: "doctor-1",
    role: "doctor",
    doctorName: "Dr. Lt Col Shafi Ahamad",
  };

  const result = await labOrderDirectoryForStaff({}, doctor, {
    async listMaskedLabOrderDocuments() {
      // Truncation belongs to the bounded source window and must remain true
      // even when server-side staff projection removes one of its orders.
      return { documents, truncated: true, limit: 300 };
    },
    async resolvePatientDirectoryEntriesForStaff() {
      return { patients: [patient], unavailableIds: [] };
    },
  });

  assert.deepEqual(result.labOrders.map((order) => order.id), ["own-order"]);
  assert.equal(result.labOrders[0].notes, "Own clinical note");
  assert.equal(result.labOrders[0].resultSummary, "Own result");
  assert.equal(JSON.stringify(result).includes("Other clinician private"), false);
  assert.equal(result.truncated, true);
  assert.equal(result.limit, 300);

  const receptionOrders = projectLabOrderDirectory(
    documents,
    [patient],
    { role: "reception" },
  );
  assert.deepEqual(receptionOrders.map((order) => order.id), [
    "own-order",
    "other-clinician-order",
  ]);
  receptionOrders.forEach((order) => {
    assert.equal("notes" in order, false);
    assert.equal("resultSummary" in order, false);
  });

  const adminOrders = projectLabOrderDirectory(
    documents,
    [patient],
    { role: "admin" },
  );
  assert.deepEqual(adminOrders.map((order) => order.id), [
    "own-order",
    "other-clinician-order",
  ]);
  assert.equal(adminOrders[1].notes, "Other clinician private note");
});

test("lab order patient IDs are deduplicated and chunked at the resolver maximum", () => {
  const documents = Array.from({ length: 121 }, (_, index) => ({
    id: `order-${index}`,
    patientId: `patient-${index}`,
  }));
  documents.push(
    { id: "duplicate", patientId: "patient-0" },
    { id: "empty", patientId: "" },
  );

  const batches = labOrderPatientIdBatches(documents);
  assert.deepEqual(batches.map((batch) => batch.length), [50, 50, 21]);
  assert.equal(batches.flat().length, 121);
  assert.equal(new Set(batches.flat()).size, 121);
});

test("lab directory unwraps every exact resolver batch without first-page truncation", async () => {
  const documents = Array.from({ length: 75 }, (_, index) => ({
    id: `order-${index}`,
    patientId: `patient-${index}`,
    orderNumber: `LAB-${index}`,
  }));
  const resolverCalls = [];

  const result = await labOrderDirectoryForStaff(
    {},
    { uid: "reception-1", role: "reception" },
    {
      async listMaskedLabOrderDocuments() {
        return { documents, truncated: false, limit: 300 };
      },
      async resolvePatientDirectoryEntriesForStaff(_env, _staff, { patientIds }) {
        resolverCalls.push(patientIds);
        return {
          patients: patientIds.map((id) => ({
            id,
            patientNumber: `ASH-${id}`,
            fullName: `Name ${id}`,
            phone: "9000000000",
          })),
          unavailableIds: [],
        };
      },
    },
  );

  assert.deepEqual(resolverCalls.map((batch) => batch.length), [50, 25]);
  assert.equal(result.labOrders.length, 75);
  assert.equal(result.labOrders.at(-1).patientId, "patient-74");
  assert.equal(result.truncated, false);
  assert.equal(result.limit, 300);
});

test("lab directory excludes archived and doctor-out-of-scope exact charts", async () => {
  const documents = [
    {
      id: "visible-order",
      patientId: "visible-patient",
      clinician: "Dr. Lt Col Shafi Ahamad",
    },
    {
      id: "archived-order",
      patientId: "archived-patient",
      clinician: "Dr. Lt Col Shafi Ahamad",
    },
    {
      id: "other-doctor-order",
      patientId: "other-doctor-patient",
      clinician: "Dr. Shaik Reshma",
    },
  ];
  const records = new Map([
    ["patients/visible-patient", {
      data: {
        fullName: "Visible Patient",
        doctorName: "Dr. Lt Col Shafi Ahamad",
      },
    }],
    ["patients/archived-patient", {
      data: {
        fullName: "Archived Patient",
        doctorName: "Dr. Lt Col Shafi Ahamad",
        archived: true,
      },
    }],
    ["patients/other-doctor-patient", {
      data: {
        fullName: "Other Doctor Patient",
        doctorName: "Dr. Shaik Reshma",
      },
    }],
  ]);

  const result = await labOrderDirectoryForStaff(
    {},
    {
      uid: "doctor-1",
      role: "doctor",
      doctorName: "Dr. Lt Col Shafi Ahamad",
    },
    {
      async listMaskedLabOrderDocuments() {
        return { documents, truncated: false, limit: 300 };
      },
      async getDocument(_env, path) {
        if (path === "staff/doctor-1") {
          return {
            data: {
              active: true,
              role: "doctor",
              doctorName: "Dr. Lt Col Shafi Ahamad",
            },
          };
        }
        return records.get(path) || null;
      },
    },
  );

  assert.deepEqual(result.labOrders.map((order) => order.id), ["visible-order"]);
  assert.equal(result.labOrders[0].patientName, "Visible Patient");
});

test("projection fails closed instead of treating a page object as a patient array", () => {
  assert.deepEqual(
    projectLabOrderDirectory(
      [{ id: "order-1", patientId: "patient-active" }],
      { patients: activePatients, nextCursor: "next-page", hasMore: true },
    ),
    [],
  );
});
