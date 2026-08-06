import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../server/razorpay/http.js";
import {
  clinicClock,
  exactReceptionPatientIdentity,
  normalizeReceptionName,
  normalizeReceptionPhone,
  receptionIdentityMaterial,
  receptionPayloadMaterial,
  receptionRequestMaterial,
  validateReceptionRegistration,
} from "../server/reception/workflow.js";

const now = new Date("2026-08-07T04:35:00.000Z");

function valid(overrides = {}) {
  return {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    fullName: "  Ananya Rao ",
    phone: "09876543210",
    dateOfBirth: "1991-06-15",
    gender: "female",
    caseType: "specialist",
    specialty: "obg",
    doctorId: "obg",
    fee: 500,
    ...overrides,
  };
}

test("normalizes reception identity deterministically", () => {
  assert.equal(normalizeReceptionName("  Dr.  Śhafi Ahamad  "), "shafi ahamad");
  assert.equal(normalizeReceptionPhone("+91 98765 43210"), "+919876543210");
  assert.equal(normalizeReceptionPhone("12345"), null);
});

test("uses the clinic timezone for same-day arrivals", () => {
  assert.deepEqual(clinicClock(now), { date: "2026-08-07", time: "10:05" });
  assert.deepEqual(
    clinicClock(new Date("2026-08-06T20:00:00.000Z")),
    { date: "2026-08-07", time: "01:30" },
  );
});

test("derives authoritative specialist fees and doctor details", () => {
  const registration = validateReceptionRegistration(valid(), now);
  assert.equal(registration.fee, 500);
  assert.equal(registration.doctorName, "Dr. Shaik Reshma");
  assert.equal(registration.consultationLabel, "Obstetrics & Gynaecology consultation");
  assert.equal(registration.clinicDate, "2026-08-07");
});

test("rejects client-side fee tampering", () => {
  assert.throws(
    () => validateReceptionRegistration(valid({ fee: 250 }), now),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("requires a fresh UUID request id", () => {
  assert.throws(
    () => validateReceptionRegistration(valid({ requestId: "retry-1" }), now),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("requires specialist and doctor to agree", () => {
  assert.throws(
    () => validateReceptionRegistration(valid({ specialty: "pediatrics" }), now),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("builds an exact identity reservation from normalized fields", () => {
  const first = validateReceptionRegistration(valid(), now);
  const second = validateReceptionRegistration(valid({
    fullName: "ananya   rao",
    phone: "+91 9876543210",
  }), now);
  assert.equal(receptionIdentityMaterial(first), receptionIdentityMaterial(second));
  const otherGender = validateReceptionRegistration(valid({ gender: "other" }), now);
  assert.notEqual(receptionIdentityMaterial(first), receptionIdentityMaterial(otherGender));
});

test("scopes idempotency material to the authenticated actor", () => {
  const requestId = valid().requestId;
  assert.equal(
    receptionRequestMaterial("staff-a", requestId),
    receptionRequestMaterial("staff-a", requestId),
  );
  assert.notEqual(
    receptionRequestMaterial("staff-a", requestId),
    receptionRequestMaterial("staff-b", requestId),
  );
});

test("fingerprints normalized workflow details instead of presentation formatting", () => {
  const first = validateReceptionRegistration(valid(), now);
  const second = validateReceptionRegistration(valid({
    fullName: "ananya   rao",
    phone: "+91 9876543210",
  }), now);
  assert.equal(receptionPayloadMaterial(first), receptionPayloadMaterial(second));
});

test("recognizes exact legacy charts even when they are archived", () => {
  const registration = validateReceptionRegistration(valid(), now);
  assert.equal(exactReceptionPatientIdentity({
    fullName: "Ms. Ananya Rao",
    phone: "+91-98765-43210",
    dateOfBirth: "1991-06-15",
    gender: "FEMALE",
    archived: true,
  }, registration), true);
  assert.equal(exactReceptionPatientIdentity({
    fullName: "Ms. Ananya Rao",
    phone: "+91-98765-43210",
    dateOfBirth: "1991-06-15",
    gender: "other",
    archived: true,
  }, registration), false);
});
