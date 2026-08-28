import assert from "node:assert/strict";
import test from "node:test";

import { nextActionableConsultationEntry } from "../src/lib/consultation-completion.ts";

test("next consultation preserves the already-sorted queue order", () => {
  const first = { id: "first", appointmentId: "appointment-2", patientId: "patient-2", status: "waiting" };
  const second = { id: "second", appointmentId: "appointment-3", patientId: "patient-3", status: "in_consultation" };

  assert.equal(
    nextActionableConsultationEntry([first, second], {
      appointmentId: "appointment-1",
      patientId: "patient-1",
    }),
    first,
  );
});

test("completed appointment and current walk-in entries are excluded", () => {
  const afterAppointment = { id: "after-appointment", appointmentId: "appointment-2", patientId: "patient-2", status: "checked_in" };
  assert.equal(
    nextActionableConsultationEntry([
      { id: "current", appointmentId: "appointment-1", patientId: "patient-1", status: "in_consultation" },
      afterAppointment,
    ], { appointmentId: "appointment-1", patientId: "patient-1" }),
    afterAppointment,
  );

  const afterWalkIn = { id: "after-walk-in", patientId: "patient-3", status: "registered" };
  assert.equal(
    nextActionableConsultationEntry([
      { id: "current-walk-in", patientId: "patient-1", status: "registered" },
      afterWalkIn,
    ], { patientId: "patient-1" }),
    afterWalkIn,
  );
});

test("completed, confirmed and requested entries are not actionable", () => {
  const waiting = { id: "waiting", appointmentId: "appointment-5", patientId: "patient-5", status: "waiting" };
  assert.equal(
    nextActionableConsultationEntry([
      { id: "completed", appointmentId: "appointment-2", patientId: "patient-2", status: "completed" },
      { id: "confirmed", appointmentId: "appointment-3", patientId: "patient-3", status: "confirmed" },
      { id: "requested", appointmentId: "appointment-4", patientId: "patient-4", status: "requested" },
      waiting,
    ], { appointmentId: "appointment-1", patientId: "patient-1" }),
    waiting,
  );
});

test("an actionable unlinked entry keeps its queue position for safe chart linking", () => {
  const unlinked = { id: "unlinked", appointmentId: "appointment-2", status: "waiting" };
  const linked = { id: "linked", appointmentId: "appointment-3", patientId: "patient-3", status: "waiting" };

  assert.equal(
    nextActionableConsultationEntry([unlinked, linked], {
      appointmentId: "appointment-1",
      patientId: "patient-1",
    }),
    unlinked,
  );
});

test("selection is side-effect free and returns null when nothing is actionable", () => {
  const entries = Object.freeze([
    Object.freeze({ id: "completed", appointmentId: "appointment-1", patientId: "patient-1", status: "completed" }),
    Object.freeze({ id: "confirmed", appointmentId: "appointment-2", patientId: "patient-2", status: "confirmed" }),
  ]);
  const before = structuredClone(entries);

  assert.equal(
    nextActionableConsultationEntry(entries, {
      appointmentId: "appointment-1",
      patientId: "patient-1",
    }),
    null,
  );
  assert.deepEqual(entries, before);
});
