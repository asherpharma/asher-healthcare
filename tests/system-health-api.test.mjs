import assert from "node:assert/strict";
import test from "node:test";

import { createAdminHealthHandler } from "../functions/api/admin/health.js";
import { HttpError, errorResponse, json } from "../server/razorpay/http.js";

function context() {
  return {
    request: new Request("https://clinic.example/api/admin/health", {
      headers: { Origin: "https://clinic.example" },
    }),
    env: { marker: "environment" },
  };
}

test("health endpoint checks origin and administrator before returning a no-store snapshot", async () => {
  const calls = [];
  const get = createAdminHealthHandler({
    assertSameOrigin() { calls.push("origin"); },
    async requireAdminStaff() {
      calls.push("auth");
      return { uid: "admin-1", role: "admin" };
    },
    async clinicSystemHealth(env, actor) {
      calls.push(["health", env, actor]);
      return { checkedAt: "now", services: {} };
    },
    errorResponse,
    json,
  });

  const response = await get(context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { checkedAt: "now", services: {} });
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
    "origin",
    "auth",
    "health",
  ]);
});

test("health endpoint fails closed before probing when origin or admin access is rejected", async () => {
  for (const overrides of [
    { assertSameOrigin() { throw new HttpError(403, "Untrusted origin"); } },
    { async requireAdminStaff() { throw new HttpError(403, "Administrator required"); } },
  ]) {
    let probed = false;
    const get = createAdminHealthHandler({
      assertSameOrigin() {},
      async requireAdminStaff() { return { uid: "admin-1", role: "admin" }; },
      async clinicSystemHealth() { probed = true; return {}; },
      errorResponse,
      json,
      ...overrides,
    });
    const response = await get(context());
    assert.equal(response.status, 403);
    assert.equal(probed, false);
  }
});
