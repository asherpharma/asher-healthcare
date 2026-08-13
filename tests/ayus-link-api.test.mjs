import assert from "node:assert/strict";
import test from "node:test";

import { createAyusLinkHandlers } from "../functions/api/labs/ayus/link.js";
import { errorResponse, json } from "../server/razorpay/http.js";

function request(body = { action: "read", labOrderId: "lab-order-1" }) {
  return new Request("https://clinic.example/api/labs/ayus/link", {
    method: "POST",
    headers: {
      Authorization: "Bearer staff-token",
      "Content-Type": "application/json",
      Origin: "https://clinic.example",
    },
    body: JSON.stringify(body),
  });
}

function context(body) {
  return { request: request(body), env: { marker: "test-env" } };
}

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      assertSameOrigin() { calls.push(["origin"]); },
      async requireActiveStaff() {
        calls.push(["auth"]);
        return { uid: "doctor-1", role: "doctor" };
      },
      async readJson(incoming, maximumBytes) {
        calls.push(["body", maximumBytes]);
        return incoming.json();
      },
      async readAyusLabLink(env, labOrderId, staff) {
        calls.push(["read", env, labOrderId, staff]);
        return { link: { ayusLabNumber: "AYUS-42" } };
      },
      async linkAyusLabNumber(env, body, staff) {
        calls.push(["link", env, body, staff]);
        return { alreadyLinked: false, link: { ayusLabNumber: body.ayusLabNumber } };
      },
      errorResponse,
      json,
      ...overrides,
    },
  };
}

test("AyusLab lookup authenticates and keeps the lab order identifier in a POST body", async () => {
  const setup = dependencies();
  const response = await createAyusLinkHandlers(setup.value).post(context());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { link: { ayusLabNumber: "AYUS-42" } });
  assert.deepEqual(setup.calls.map(([name]) => name), ["origin", "auth", "body", "read"]);
  assert.equal(setup.calls[2][1], 4_000);
  assert.equal(setup.calls[3][2], "lab-order-1");
});

test("AyusLab linking continues to use the authenticated POST body", async () => {
  const setup = dependencies();
  const body = { labOrderId: "lab-order-1", ayusLabNumber: "AYUS-84" };
  const response = await createAyusLinkHandlers(setup.value).post(context(body));

  assert.equal(response.status, 201);
  assert.deepEqual(setup.calls.map(([name]) => name), ["origin", "auth", "body", "link"]);
  assert.deepEqual(setup.calls[3][2], body);
});

test("AyusLab GET is rejected so linked identifiers cannot enter URLs", async () => {
  const handlers = createAyusLinkHandlers({ json });
  const response = await handlers.get({
    request: new Request("https://clinic.example/api/labs/ayus/link?labOrderId=private-order"),
  });

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "AyusLab links accept secure requests only." });
});
