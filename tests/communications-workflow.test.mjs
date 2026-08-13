import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCommunicationStaff,
  communicationStaffPrecondition,
  normalizeCommunicationPhone,
  projectCommunicationDesk,
  validateConsentGrant,
} from "../server/communications/workflow.js";

test("only administrators and reception may operate the reminder desk", () => {
  assert.equal(assertCommunicationStaff({ role: "admin" }).role, "admin");
  assert.equal(assertCommunicationStaff({ role: "reception" }).role, "reception");
  assert.throws(() => assertCommunicationStaff({ role: "doctor" }), /administrators and reception/u);
  assert.throws(() => assertCommunicationStaff(null), /administrators and reception/u);
});

test("every communication mutation can bind the current staff document version", () => {
  const write = communicationStaffPrecondition(
    { FIREBASE_PROJECT_ID: "clinic-test" },
    { uid: "reception-1", staffUpdateTime: "2026-08-13T10:00:00.000Z" },
  );
  assert.equal(write.verify.endsWith("/documents/staff/reception-1"), true);
  assert.equal(write.currentDocument.updateTime, "2026-08-13T10:00:00.000Z");
  assert.throws(
    () => communicationStaffPrecondition({ FIREBASE_PROJECT_ID: "clinic-test" }, { uid: "reception-1" }),
    /session must be refreshed/u,
  );
});

test("care consent is separate, channel limited, and bound to the patient mobile", () => {
  const patient = { id: "patient-1", phone: "90192 63709", dateOfBirth: "1990-05-10" };
  assert.deepEqual(validateConsentGrant({
    patientId: "patient-1", purpose: "care", channel: "whatsapp",
    recipient: "+91 90192 63709", method: "patient-verbal",
  }, patient), {
    patientId: "patient-1", purpose: "care", channel: "whatsapp",
    recipient: "+919019263709", method: "patient-verbal",
    proxyName: "", proxyRelationship: "", consentReference: "",
  });
  assert.throws(() => validateConsentGrant({
    patientId: "patient-1", purpose: "marketing", channel: "whatsapp",
    recipient: "+919019263709", method: "patient-verbal",
  }, patient), /Marketing permission/u);
  assert.throws(() => validateConsentGrant({
    patientId: "patient-1", purpose: "care", channel: "email",
    recipient: "patient@example.com", method: "patient-verbal",
  }, patient), /only verified care-reminder channel/u);
  assert.throws(() => validateConsentGrant({
    patientId: "patient-1", purpose: "care", channel: "whatsapp",
    recipient: "+919999999999", method: "patient-verbal",
  }, patient), /must match/u);
});

test("guardian permission records a named proxy and relationship", () => {
  const patient = { id: "child-1", phone: "9019263709", dateOfBirth: "2022-01-15" };
  assert.throws(() => validateConsentGrant({
    patientId: "child-1", purpose: "care", channel: "whatsapp",
    recipient: "9019263709", method: "guardian-verbal",
  }, patient), /guardian name and relationship/u);
  const result = validateConsentGrant({
    patientId: "child-1", purpose: "care", channel: "whatsapp",
    recipient: "9019263709", method: "guardian-verbal",
    proxyName: "Parent Name", proxyRelationship: "Mother",
  }, patient);
  assert.equal(result.proxyName, "Parent Name");
  assert.equal(result.proxyRelationship, "Mother");
});

test("minor or unverified patients cannot use patient-verbal permission", () => {
  const now = new Date("2026-08-13T12:00:00.000Z");
  const request = {
    patientId: "child-1", purpose: "care", channel: "whatsapp",
    recipient: "9019263709", method: "patient-verbal",
  };
  assert.throws(
    () => validateConsentGrant(request, {
      id: "child-1", phone: "9019263709", dateOfBirth: "2015-08-13",
    }, now),
    /minor cannot provide patient verbal/u,
  );
  for (const dateOfBirth of ["", "2015-02-30", "2030-01-01"]) {
    assert.throws(
      () => validateConsentGrant(request, {
        id: "child-1", phone: "9019263709", dateOfBirth,
      }, now),
      /valid patient date of birth/u,
    );
  }
  const guardian = validateConsentGrant({
    ...request,
    method: "guardian-verbal",
    proxyName: "Parent Name",
    proxyRelationship: "Father",
  }, { id: "child-1", phone: "9019263709", dateOfBirth: "2015-08-13" }, now);
  assert.equal(guardian.proxyName, "Parent Name");
  assert.equal(guardian.proxyRelationship, "Father");
});

test("written permission requires a bounded clinic-held form reference", () => {
  const patient = { id: "child-1", phone: "9019263709", dateOfBirth: "2022-01-15" };
  const request = {
    patientId: "child-1", purpose: "care", channel: "whatsapp",
    recipient: "9019263709", method: "written-form",
  };
  assert.throws(
    () => validateConsentGrant(request, patient),
    /written consent form reference/u,
  );
  const consent = validateConsentGrant({
    ...request,
    consentReference: "CONSENT-2026-0001",
  }, patient);
  assert.equal(consent.consentReference, "CONSENT-2026-0001");
  assert.equal(consent.proxyName, "");
});

test("Indian mobile normalization rejects invalid destinations", () => {
  assert.equal(normalizeCommunicationPhone("+91 90192 63709"), "+919019263709");
  assert.equal(normalizeCommunicationPhone("09019263709"), "+919019263709");
  assert.equal(normalizeCommunicationPhone("12345"), "");
});

test("desk excludes unlinked and archived records and projects masked consent", () => {
  const desk = projectCommunicationDesk({
    appointments: [
      { id: "appointment-active", patientId: "patient-active", status: "confirmed", preferredDate: "2026-08-14", preferredTime: "17:00" },
      { id: "appointment-unlinked", patientId: "", status: "confirmed", preferredDate: "2026-08-14", preferredTime: "17:15" },
      { id: "appointment-archived", patientId: "patient-archived", status: "confirmed", preferredDate: "2026-08-14", preferredTime: "17:30" },
      { id: "appointment-cancelled", patientId: "patient-active", status: "cancelled", preferredDate: "2026-08-14", preferredTime: "17:45" },
    ],
    tasks: [{ id: "task-active", patientId: "patient-active", patientName: "Active Patient", type: "follow_up", status: "open", dueDate: "2026-08-13", dueTime: "10:00" }],
    patientDocuments: new Map([
      ["patient-active", { data: { patientNumber: "ASH-001", fullName: "Active Patient", phone: "9019263709", archived: false } }],
      ["patient-archived", { data: { archived: true, fullName: "Archived Patient" } }],
    ]),
    preferences: new Map([["patient-active", { data: { careWhatsapp: {
      status: "granted", recipient: "+919019263709", method: "patient-verbal",
      consentVersion: "care-reminders-v1", eventId: "event-1", capturedAt: "2026-08-13T10:00:00.000Z",
    } } }]]),
    outbox: [],
  });
  assert.deepEqual(desk.candidates.map((entry) => entry.sourceId), ["appointment-active", "task-active"]);
  assert.equal(desk.candidates[0].channels.whatsapp.status, "granted");
  assert.equal(desk.candidates[0].channels.whatsapp.maskedRecipient.endsWith("3709"), true);
  assert.equal(desk.excluded.unlinked, 1);
  assert.equal(desk.excluded.archived, 1);
  assert.equal(desk.summary.consentReady, 2);
});

test("outbox projection hides raw recipients and inactive patient entries", () => {
  const desk = projectCommunicationDesk({
    patientDocuments: new Map([
      ["patient-active", { data: { fullName: "Patient", archived: false } }],
      ["patient-archived", { data: { fullName: "Archived", archived: true } }],
    ]),
    outbox: [
      { id: "outbox-1", patientId: "patient-active", channel: "whatsapp", recipient: "+919019263709", status: "ready" },
      { id: "outbox-2", patientId: "patient-archived", channel: "whatsapp", recipient: "+919999999999", status: "ready" },
    ],
  });
  assert.equal(desk.outbox.length, 1);
  assert.equal(desk.outbox[0].maskedRecipient.endsWith("3709"), true);
  assert.equal("recipient" in desk.outbox[0], false);
  assert.equal(JSON.stringify(desk).includes("+919019263709"), false);
});
