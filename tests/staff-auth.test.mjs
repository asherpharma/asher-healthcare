import assert from "node:assert/strict";
import test from "node:test";

import {
  isApprovedStaffProfile,
  isFreshAuthAccount,
  maskIndianStaffPhone,
  normalizeIndianStaffPhone,
} from "../src/lib/staff-auth.js";

test("normalizes valid Indian staff mobile numbers to E.164", () => {
  assert.equal(normalizeIndianStaffPhone("98765 43210"), "+919876543210");
  assert.equal(normalizeIndianStaffPhone("+91-98765-43210"), "+919876543210");
  assert.equal(normalizeIndianStaffPhone("919876543210"), "+919876543210");
  assert.equal(maskIndianStaffPhone("9876543210"), "+91 •••••• 3210");
});

test("rejects incomplete, landline, and non-Indian mobile input", () => {
  for (const value of ["", "12345", "5123456789", "+1 202 555 0183", "9198765432100"]) {
    assert.equal(normalizeIndianStaffPhone(value), "");
  }
});

test("approves only active clinic staff roles", () => {
  for (const role of ["admin", "doctor", "reception"]) {
    assert.equal(isApprovedStaffProfile({ active: true, role }), true);
  }
  assert.equal(isApprovedStaffProfile({ active: false, role: "admin" }), false);
  assert.equal(isApprovedStaffProfile({ active: true, role: "patient" }), false);
  assert.equal(isApprovedStaffProfile(null), false);
});

test("identifies only a newly-created authentication identity for safe cleanup", () => {
  const now = Date.parse("2026-08-24T10:05:00.000Z");
  assert.equal(isFreshAuthAccount({
    creationTime: "2026-08-24T10:04:30.000Z",
    lastSignInTime: "2026-08-24T10:04:31.000Z",
  }, now), true);
  assert.equal(isFreshAuthAccount({
    creationTime: "2026-08-20T10:00:00.000Z",
    lastSignInTime: "2026-08-24T10:04:31.000Z",
  }, now), false);
  assert.equal(isFreshAuthAccount({}, now), false);
});
