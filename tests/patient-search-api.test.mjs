import assert from "node:assert/strict";
import test from "node:test";

import { createPatientSearchHandlers } from "../functions/api/staff/patients/search.js";
import { createPatientDirectoryHandlers } from "../functions/api/staff/patients/directory.js";
import { errorResponse, json } from "../server/razorpay/http.js";
import {
  fetchPatientProfile,
  resolvePatientDirectoryEntries,
  searchPatientDirectory,
} from "../src/lib/patient-directory.ts";

function context(request = new Request("https://clinic.example/api/staff/patients/search", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://clinic.example",
  },
  body: JSON.stringify({ search: "Aar", cursor: "cursor-1", pageSize: 10 }),
})) {
  return { request, env: { marker: "test" } };
}

test("patient search accepts identifiers only in an authenticated POST body", async () => {
  const calls = [];
  const handlers = createPatientSearchHandlers({
    assertSameOrigin() { calls.push("origin"); },
    async requireActiveStaff() {
      calls.push("auth");
      return { uid: "reception-1", role: "reception" };
    },
    async readJson(request, maximumBytes) {
      calls.push(["body", maximumBytes]);
      return request.json();
    },
    async searchPatientsForStaff(env, staff, options) {
      calls.push(["search", env, staff, options]);
      return { patients: [], nextCursor: "" };
    },
    errorResponse,
    json,
  });

  const response = await handlers.post(context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { patients: [], nextCursor: "" });
  assert.equal(calls[0], "origin");
  assert.equal(calls[1], "auth");
  assert.deepEqual(calls[2], ["body", 4_000]);
  assert.deepEqual(calls[3][3], {
    search: "Aar",
    cursor: "cursor-1",
    pageSize: 10,
    archivedOnly: false,
  });
});

test("patient search rejects GET so identifiers cannot enter URLs", async () => {
  const handlers = createPatientSearchHandlers({ json });
  const response = await handlers.get(context(new Request(
    "https://clinic.example/api/staff/patients/search?q=private-name",
  )));
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Patient search accepts secure requests only." });
});

test("directory GET exposes bounded pagination controls", async () => {
  const calls = [];
  const handlers = createPatientDirectoryHandlers({
    assertSameOrigin() { calls.push("origin"); },
    async requireActiveStaff() {
      calls.push("auth");
      return { uid: "reception-1", role: "reception" };
    },
    async patientDirectoryPageForStaff(env, staff, options) {
      calls.push([env, staff, options]);
      return { patients: [], nextCursor: "next-page", hasMore: true };
    },
    errorResponse,
    json,
  });
  const response = await handlers.get(context(new Request(
    "https://clinic.example/api/staff/patients/directory?pageSize=20&cursor=page-1&archivedOnly=1",
    { headers: { Origin: "https://clinic.example" } },
  )));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    patients: [],
    nextCursor: "next-page",
    hasMore: true,
  });
  assert.equal(calls[0], "origin");
  assert.equal(calls[1], "auth");
  assert.deepEqual(calls[2][2], {
    includeArchived: false,
    archivedOnly: true,
    cursor: "page-1",
    pageSize: "20",
  });
});

test("directory POST resolves only explicit patient handoffs", async () => {
  const calls = [];
  const handlers = createPatientDirectoryHandlers({
    assertSameOrigin() { calls.push("origin"); },
    async requireActiveStaff() {
      calls.push("auth");
      return { uid: "doctor-1", role: "doctor" };
    },
    async readJson(request, maximumBytes) {
      calls.push(["body", maximumBytes]);
      return request.json();
    },
    async resolvePatientDirectoryEntriesForStaff(env, staff, options) {
      calls.push(["resolve", env, staff, options]);
      return { patients: [], unavailableIds: ["patient-1"] };
    },
    errorResponse,
    json,
  });
  const request = new Request("https://clinic.example/api/staff/patients/directory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://clinic.example",
    },
    body: JSON.stringify({ patientIds: ["patient-1"], includeArchived: true }),
  });
  const response = await handlers.post(context(request));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { patients: [], unavailableIds: ["patient-1"] });
  assert.equal(calls[0], "origin");
  assert.equal(calls[1], "auth");
  assert.deepEqual(calls[2], ["body", 10_000]);
  assert.deepEqual(calls[3][3], {
    patientIds: ["patient-1"],
    includeArchived: true,
  });
});

test("client exact-patient helper keeps identifiers in an authenticated POST body", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    return new Response(JSON.stringify({
      patients: [{ id: "patient-1", fullName: "Aarav", phone: "" }],
      unavailableIds: ["patient-2"],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await resolvePatientDirectoryEntries(
      { async getIdToken() { return "staff-token"; } },
      ["patient-1", "patient-2"],
    );
    assert.deepEqual(result.unavailableIds, ["patient-2"]);
    assert.equal(calls[0][0], "/api/staff/patients/directory");
    assert.equal(calls[0][1].method, "POST");
    assert.equal(calls[0][1].headers.Authorization, "Bearer staff-token");
    assert.deepEqual(JSON.parse(calls[0][1].body), {
      patientIds: ["patient-1", "patient-2"],
      includeArchived: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client search helper requests an archived-only admin search in the POST body", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    return new Response(JSON.stringify({
      patients: [{
        id: "patient-archived",
        fullName: "Archived Patient",
        phone: "",
        archived: true,
        archiveReason: "Duplicate",
      }],
      nextCursor: "",
      hasMore: false,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await searchPatientDirectory(
      { async getIdToken() { return "admin-token"; } },
      "Archived",
      { archivedOnly: true, pageSize: 10 },
    );
    assert.equal(result.patients[0].archived, true);
    assert.equal(calls[0][0], "/api/staff/patients/search");
    assert.deepEqual(JSON.parse(calls[0][1].body), {
      search: "Archived",
      cursor: "",
      pageSize: 10,
      archivedOnly: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client single-patient detail read is authenticated and never cached", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    return new Response(JSON.stringify({
      patient: {
        id: "patient-1",
        fullName: "Aarav",
        phone: "9000000001",
        dateOfBirth: "2020-01-01",
        gender: "male",
        address: "RK Hegde Nagar",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const patient = await fetchPatientProfile(
      { async getIdToken() { return "reception-token"; } },
      "patient-1",
    );
    assert.equal(patient.address, "RK Hegde Nagar");
    assert.equal(calls[0][0], "/api/staff/patients/profile?patientId=patient-1");
    assert.equal(calls[0][1].method, "GET");
    assert.equal(calls[0][1].cache, "no-store");
    assert.equal(calls[0][1].headers.Authorization, "Bearer reception-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
