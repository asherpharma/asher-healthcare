import assert from "node:assert/strict";
import test from "node:test";
import {
  PATIENT_PORTAL_IDLE_TIMEOUT_MS,
  patientPortalActivityTimestamp,
} from "../src/lib/patient-portal-session.ts";

test("portal activity hydration accepts only a current existing session", () => {
  const now = 1_800_000_000_000;
  assert.equal(patientPortalActivityTimestamp(String(now - 60_000), now), now - 60_000);
  assert.equal(patientPortalActivityTimestamp(null, now), null);
  assert.equal(patientPortalActivityTimestamp("", now), null);
  assert.equal(patientPortalActivityTimestamp("not-a-time", now), null);
  assert.equal(patientPortalActivityTimestamp(String(now + 1), now), null);
  assert.equal(patientPortalActivityTimestamp(String(now - PATIENT_PORTAL_IDLE_TIMEOUT_MS), now), null);
});
