import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import ts from "typescript";

import {
  DEFAULT_SCHEDULE,
  dateDay,
  normalizeSchedule,
  timeSlots,
} from "../server/appointments/schedule.js";

const root = process.cwd();
const clientSource = await readFile(path.join(root, "src/lib/appointments.ts"), "utf8");
const compiledClient = ts.transpileModule(clientSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "appointments.ts",
  reportDiagnostics: true,
});
assert.deepEqual(compiledClient.diagnostics ?? [], []);
const client = await import(
  `data:text/javascript;base64,${Buffer.from(compiledClient.outputText).toString("base64")}`
);

const pediatricSlots = [
  "17:30", "17:45",
  "18:00", "18:15", "18:30", "18:45",
  "19:00", "19:15", "19:30", "19:45",
];

const reshmaSlots = [
  "20:00", "20:15", "20:30", "20:45",
  "21:00", "21:15",
];

test("default specialist schedules keep each doctor's intended hours", () => {
  assert.deepEqual(DEFAULT_SCHEDULE.enabledDays, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(DEFAULT_SCHEDULE.doctors.pediatrics, {
    enabled: true,
    startTime: "17:30",
    endTime: "20:00",
    slotMinutes: 15,
  });
  assert.deepEqual(DEFAULT_SCHEDULE.doctors.obg, {
    enabled: true,
    startTime: "20:00",
    endTime: "21:30",
    slotMinutes: 15,
  });
});

test("Dr. Reshma receives six 15-minute starts from 8:00 PM through 9:15 PM", () => {
  assert.deepEqual(timeSlots(DEFAULT_SCHEDULE.doctors.obg), reshmaSlots);
  assert.equal(reshmaSlots.length, 6);
  assert.equal(timeSlots(DEFAULT_SCHEDULE.doctors.obg).includes("19:45"), false);
  assert.equal(timeSlots(DEFAULT_SCHEDULE.doctors.obg).includes("21:30"), false);
});

test("Dr. Shafi receives ten 15-minute starts from 5:30 PM through 7:45 PM", () => {
  assert.deepEqual(timeSlots(DEFAULT_SCHEDULE.doctors.pediatrics), pediatricSlots);
  assert.equal(pediatricSlots.length, 10);
  for (const excluded of ["17:00", "17:15", "20:00"]) {
    assert.equal(timeSlots(DEFAULT_SCHEDULE.doctors.pediatrics).includes(excluded), false);
  }
});

test("the client fallback and slot generation mirror the trusted server schedule", () => {
  assert.deepEqual(client.DEFAULT_APPOINTMENT_SCHEDULE, DEFAULT_SCHEDULE);
  assert.deepEqual(client.normalizeAppointmentSchedule(undefined), normalizeSchedule(undefined));
  for (const [id, expected] of [["pediatrics", pediatricSlots], ["obg", reshmaSlots]]) {
    const schedule = client.DEFAULT_APPOINTMENT_SCHEDULE.doctors[id];
    assert.deepEqual(client.generateTimeSlots(schedule), expected);
    assert.equal(expected[0], schedule.startTime, "opening time is an available slot");
    assert.equal(expected.includes(schedule.endTime), false, "closing time is not a slot start");
    assert.deepEqual(client.generateTimeSlots({ ...schedule, enabled: false }), []);
    assert.deepEqual(timeSlots({ ...schedule, enabled: false }), []);
  }
  assert.equal(client.scheduleSummary(DEFAULT_SCHEDULE, "pediatrics"), "5:30 PM–8:00 PM, 15-minute slots");
  assert.equal(client.scheduleSummary(DEFAULT_SCHEDULE, "obg"), "8:00 PM–9:30 PM, 15-minute slots");
});

test("both specialist schedules remain Monday–Saturday with Sunday unavailable", () => {
  for (const [date, weekday] of [
    ["2026-10-18", 0], ["2026-10-19", 1], ["2026-10-20", 2], ["2026-10-21", 3],
    ["2026-10-22", 4], ["2026-10-23", 5], ["2026-10-24", 6],
  ]) {
    assert.equal(dateDay(date), weekday);
    assert.equal(client.dateIsEnabled(DEFAULT_SCHEDULE, date), weekday !== 0);
    assert.equal(DEFAULT_SCHEDULE.enabledDays.includes(dateDay(date)), weekday !== 0);
  }
  assert.equal(client.nextEnabledDate(DEFAULT_SCHEDULE, "2026-10-18"), "2026-10-19");
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
