import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLabDirectoryStaff,
  boundedLabOrderDirectory,
  LAB_ORDER_DIRECTORY_FIELDS,
  labOrderDirectoryForStaff,
  labOrderPatientIdBatches,
  labOrderDirectoryQuery,
  projectLabOrderDirectory,
} from "../server/labs/directory.js";

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

test("active admin, doctor, and reception roles may use the server directory", () => {
  assert.equal(assertLabDirectoryStaff({ role: "admin" }).role, "admin");
  assert.equal(assertLabDirectoryStaff({ role: "doctor" }).role, "doctor");
  assert.equal(assertLabDirectoryStaff({ role: "reception" }).role, "reception");
  assert.throws(() => assertLabDirectoryStaff(null), /active clinic staff/u);
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
