import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLabDirectoryStaff,
  boundedLabOrderDirectory,
  LAB_ORDER_DIRECTORY_FIELDS,
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
    notes: "Fasting sample",
    resultSummary: "Normal",
    reportStoragePath: "reports/patient-active/report.pdf",
  }], activePatients, { role: "doctor" });

  assert.equal(order.notes, "Fasting sample");
  assert.equal(order.resultSummary, "Normal");
  assert.equal(order.reportAttached, true);
  assert.equal("reportFileName" in order, false);
  assert.equal("reportStoragePath" in order, false);
  assert.equal("reportContentType" in order, false);
  assert.equal("reportSize" in order, false);
});
