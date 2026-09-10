import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";

import {
  DEFAULT_SCHEDULE,
  normalizeSchedule,
  timeSlots,
} from "../server/appointments/schedule.js";

const root = process.cwd();

const pediatricSlots = [
  "17:00", "17:15", "17:30", "17:45",
  "18:00", "18:15", "18:30", "18:45",
  "19:00", "19:15", "19:30", "19:45",
];

const reshmaSlots = [
  "19:00", "19:15", "19:30", "19:45",
  "20:00", "20:15", "20:30", "20:45",
];

test("default specialist schedules keep each doctor's intended hours", () => {
  assert.deepEqual(DEFAULT_SCHEDULE.enabledDays, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(DEFAULT_SCHEDULE.doctors.pediatrics, {
    enabled: true,
    startTime: "17:00",
    endTime: "20:00",
    slotMinutes: 15,
  });
  assert.deepEqual(DEFAULT_SCHEDULE.doctors.obg, {
    enabled: true,
    startTime: "19:00",
    endTime: "21:00",
    slotMinutes: 15,
  });
});

test("Dr. Reshma receives eight 15-minute starts from 7:00 PM through 8:45 PM", () => {
  assert.deepEqual(timeSlots(DEFAULT_SCHEDULE.doctors.obg), reshmaSlots);
  assert.equal(timeSlots(DEFAULT_SCHEDULE.doctors.obg).includes("21:00"), false);
});

test("Dr. Shafi's existing 5:00 PM to 8:00 PM slots remain unchanged", () => {
  assert.deepEqual(timeSlots(DEFAULT_SCHEDULE.doctors.pediatrics), pediatricSlots);
});

test("the client fallback mirrors the trusted server schedule", async () => {
  const source = await readFile(path.join(root, "src/lib/appointments.ts"), "utf8");
  assert.match(
    source,
    /pediatrics:\s*\{\s*enabled: true,\s*startTime: "17:00",\s*endTime: "20:00",\s*slotMinutes: 15,/u,
  );
  assert.match(
    source,
    /obg:\s*\{\s*enabled: true,\s*startTime: "19:00",\s*endTime: "21:00",\s*slotMinutes: 15,/u,
  );
});

test("a live schedule preserves the clinic weekdays and both doctor schedules", () => {
  const liveSchedule = normalizeSchedule({
    enabledDays: [1, 2, 3, 4, 5, 6],
    doctors: {
      pediatrics: DEFAULT_SCHEDULE.doctors.pediatrics,
      obg: DEFAULT_SCHEDULE.doctors.obg,
    },
  });

  assert.deepEqual(liveSchedule.enabledDays, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(timeSlots(liveSchedule.doctors.pediatrics), pediatricSlots);
  assert.deepEqual(timeSlots(liveSchedule.doctors.obg), reshmaSlots);
});
