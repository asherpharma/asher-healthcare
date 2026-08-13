import assert from "node:assert/strict";
import test from "node:test";

import { createPatientSearchHandlers } from "../functions/api/staff/patients/search.js";
import { errorResponse, json } from "../server/razorpay/http.js";

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
  assert.deepEqual(calls[3][3], { search: "Aar", cursor: "cursor-1", pageSize: 10 });
});

test("patient search rejects GET so identifiers cannot enter URLs", async () => {
  const handlers = createPatientSearchHandlers({ json });
  const response = await handlers.get(context(new Request(
    "https://clinic.example/api/staff/patients/search?q=private-name",
  )));
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Patient search accepts secure requests only." });
});
