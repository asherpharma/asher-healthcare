import assert from "node:assert/strict";
import test from "node:test";

import { clinicQueueHealth } from "../src/lib/clinic-queue.js";

const now = new Date("2026-08-23T18:00:00+05:30");
const at = (time) => new Date(`2026-08-23T${time}:00+05:30`);

test("queue health reports waiting, delay and consultation metrics without patient data", () => {
  const health = clinicQueueHealth([
    { patientName: "Hidden One", status: "checked_in", checkedInAt: at("17:50") },
    { patientName: "Hidden Two", status: "waiting", waitingAt: at("17:20") },
    { patientName: "Hidden Three", status: "in_consultation", consultationStartedAt: at("17:55") },
    { status: "completed", consultationStartedAt: at("17:05"), completedAt: at("17:25") },
    { status: "completed", consultationStartedAt: at("17:30"), completedAt: at("17:40") },
  ], { now, delayThresholdMinutes: 30 });

  assert.deepEqual(health, {
    waiting: 2,
    waitingWithTimestamp: 2,
    consulting: 1,
    delayed: 1,
    averageWaitMinutes: 25,
    longestWaitMinutes: 40,
    averageConsultationMinutes: 15,
    completedWithDuration: 2,
    delayThresholdMinutes: 30,
  });
  assert.equal("patientName" in health, false);
});

test("queue health falls back through timestamp fields and ignores invalid durations", () => {
  const health = clinicQueueHealth([
    { status: "waiting", checkedInAt: at("17:45") },
    { status: "checked_in", createdAt: at("17:30") },
    { status: "waiting" },
    { status: "completed", consultationStartedAt: at("17:50"), completedAt: at("17:40") },
    { status: "completed", consultationStartedAt: at("08:00"), completedAt: at("17:00") },
  ], { now });

  assert.equal(health.waiting, 3);
  assert.equal(health.waitingWithTimestamp, 2);
  assert.equal(health.averageWaitMinutes, 23);
  assert.equal(health.longestWaitMinutes, 30);
  assert.equal(health.delayed, 1);
  assert.equal(health.averageConsultationMinutes, 0);
  assert.equal(health.completedWithDuration, 0);
});

test("queue health returns stable zero values for empty input", () => {
  assert.deepEqual(clinicQueueHealth([], { now }), {
    waiting: 0,
    waitingWithTimestamp: 0,
    consulting: 0,
    delayed: 0,
    averageWaitMinutes: 0,
    longestWaitMinutes: 0,
    averageConsultationMinutes: 0,
    completedWithDuration: 0,
    delayThresholdMinutes: 30,
  });
});
