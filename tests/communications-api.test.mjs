import assert from "node:assert/strict";
import test from "node:test";

import { createCommunicationDeskHandlers } from "../functions/api/communications/desk.js";
import { HttpError, json } from "../server/razorpay/http.js";

function handlers(overrides = {}) {
  return createCommunicationDeskHandlers({
    assertSameOrigin: () => {},
    communicationDeskForStaff: async () => ({ candidates: [] }),
    errorResponse: (error) => json({ error: error.message }, error.status || 500),
    handleCommunicationAction: async (_env, _staff, body) => ({ action: body.action }),
    json,
    readJson: async (request) => request.body,
    requireActiveStaff: async () => ({ uid: "admin-1", role: "admin" }),
    ...overrides,
  });
}

test("communication directory authenticates before loading", async () => {
  const calls = [];
  const api = handlers({
    requireActiveStaff: async () => { calls.push("auth"); return { uid: "reception-1", role: "reception" }; },
    communicationDeskForStaff: async (_env, staff) => { calls.push(`desk:${staff.uid}`); return { candidates: [], providerMode: "manual_fallback" }; },
  });
  const response = await api.get({ request: new Request("https://clinic.example/api/communications/desk"), env: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["auth", "desk:reception-1"]);
});

test("communication actions authenticate before reading or handling JSON", async () => {
  const calls = [];
  const api = handlers({
    requireActiveStaff: async () => { calls.push("auth"); return { uid: "admin-1", role: "admin" }; },
    readJson: async () => { calls.push("json"); return { action: "prepare" }; },
    handleCommunicationAction: async (_env, staff, body) => { calls.push(`action:${staff.uid}:${body.action}`); return { status: "ready" }; },
  });
  const response = await api.post({ request: new Request("https://clinic.example/api/communications/desk", { method: "POST" }), env: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["auth", "json", "action:admin-1:prepare"]);
});

test("authentication failures do not parse communication request bodies", async () => {
  let parsed = false;
  const api = handlers({
    requireActiveStaff: async () => { throw new HttpError(401, "Sign in first."); },
    readJson: async () => { parsed = true; return {}; },
  });
  const response = await api.post({ request: new Request("https://clinic.example/api/communications/desk", { method: "POST" }), env: {} });
  assert.equal(response.status, 401);
  assert.equal(parsed, false);
});

test("same-origin failures short-circuit before authentication", async () => {
  let authenticated = false;
  const api = handlers({
    assertSameOrigin: () => { throw new HttpError(403, "Untrusted origin."); },
    requireActiveStaff: async () => { authenticated = true; return { uid: "admin-1", role: "admin" }; },
  });
  const response = await api.get({ request: new Request("https://clinic.example/api/communications/desk"), env: {} });
  assert.equal(response.status, 403);
  assert.equal(authenticated, false);
});
