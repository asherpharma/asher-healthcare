import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAdminNavigationHandoff,
  consumeAdminNavigationHandoff,
  stageAdminNavigationHandoff,
} from "../src/lib/admin-navigation-handoff.ts";

test.afterEach(() => clearAdminNavigationHandoff());

test("linked identifiers are handed off once without serializing them", () => {
  const payload = {
    destination: "/admin/appointments",
    intent: "create-appointment",
    patientId: "patient-private-1",
  };
  stageAdminNavigationHandoff(payload, 1_000);

  assert.equal(consumeAdminNavigationHandoff("/admin/patients", 1_010), null);
  assert.deepEqual(consumeAdminNavigationHandoff("/admin/appointments", 1_020), payload);
  assert.equal(consumeAdminNavigationHandoff("/admin/appointments", 1_030), null);
});

test("an exact lab order is handed off in memory without entering the URL", () => {
  const payload = {
    destination: "/admin/lab",
    intent: "open-lab-order",
    orderId: "lab-order-private-1",
  };
  stageAdminNavigationHandoff(payload, 2_000);

  assert.deepEqual(consumeAdminNavigationHandoff("/admin/lab", 2_010), payload);
  assert.equal(consumeAdminNavigationHandoff("/admin/lab", 2_020), null);
});

test("expired and time-invalid handoffs are discarded", () => {
  stageAdminNavigationHandoff({
    destination: "/admin/consultations",
    intent: "open-appointment-consultation",
    appointmentId: "appointment-private-1",
  }, 1_000);

  assert.equal(consumeAdminNavigationHandoff("/admin/consultations", 121_001), null);
  assert.equal(consumeAdminNavigationHandoff("/admin/consultations", 121_002), null);
});

test("malformed identifiers cannot be staged", () => {
  assert.throws(() => stageAdminNavigationHandoff({
    destination: "/admin/patients",
    intent: "open-patient",
    patientId: " patient-1",
  }));
  assert.throws(() => stageAdminNavigationHandoff({
    destination: "/admin/consultations",
    intent: "open-appointment-consultation",
    appointmentId: "appointment\n1",
  }));
  assert.throws(() => stageAdminNavigationHandoff({
    destination: "/admin/lab",
    intent: "open-lab-order",
    orderId: " lab-order-1",
  }));
});
