import assert from "node:assert/strict";
import test from "node:test";

import { createServiceCatalogHandlers } from "../functions/api/admin/service-catalog.js";
import { HttpError, errorResponse, json } from "../server/razorpay/http.js";

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      assertSameOrigin(request) { calls.push(["origin", request.url]); },
      async requireAdminStaff() {
        calls.push(["auth"]);
        return { uid: "admin-1", role: "admin" };
      },
      async readJson() {
        calls.push(["body"]);
        return { catalog: "request-catalog", expectedUpdateTime: null };
      },
      async getServiceCatalogForAdministrator(env, actor) {
        calls.push(["get", env, actor]);
        return { catalog: "current-catalog", revision: null };
      },
      async setServiceCatalogForAdministrator(env, body, actor) {
        calls.push(["set", env, body, actor]);
        return { catalog: "saved-catalog", revision: "next", changed: true };
      },
      errorResponse,
      json,
      ...overrides,
    },
  };
}

function context() {
  return {
    request: new Request("https://clinic.example/api/admin/service-catalog", {
      headers: { Origin: "https://clinic.example" },
    }),
    env: { marker: "test-env" },
  };
}

test("admin catalogue GET authenticates before reading current revision", async () => {
  const setup = dependencies();
  const response = await createServiceCatalogHandlers(setup.value).get(context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { catalog: "current-catalog", revision: null });
  assert.deepEqual(setup.calls.map(([name]) => name), ["origin", "auth", "get"]);
});

test("admin catalogue POST authenticates and passes parsed input with the server actor", async () => {
  const setup = dependencies();
  const response = await createServiceCatalogHandlers(setup.value).post(context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    catalog: "saved-catalog",
    revision: "next",
    changed: true,
  });
  assert.deepEqual(setup.calls.map(([name]) => name), ["origin", "auth", "body", "set"]);
  assert.deepEqual(setup.calls[3][2], {
    catalog: "request-catalog",
    expectedUpdateTime: null,
  });
  assert.deepEqual(setup.calls[3][3], { uid: "admin-1", role: "admin" });
});

test("origin and administrator failures stop before parsing or mutation", async () => {
  for (const failure of [
    { assertSameOrigin() { throw new HttpError(403, "Untrusted origin"); } },
    { async requireAdminStaff() { throw new HttpError(403, "Administrator required"); } },
  ]) {
    const setup = dependencies(failure);
    const response = await createServiceCatalogHandlers(setup.value).post(context());
    assert.equal(response.status, 403);
    assert.equal(setup.calls.some(([name]) => name === "body"), false);
    assert.equal(setup.calls.some(([name]) => name === "set"), false);
  }
});
