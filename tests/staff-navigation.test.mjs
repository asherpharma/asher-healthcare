import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STAFF_TOOL_GROUPS,
  STAFF_TOOL_REGISTRY,
  groupedStaffToolsForRole,
  patientLauncherActionsForRole,
  primaryStaffToolsForRole,
  quickStaffToolsForRole,
  recentStaffToolsForRole,
  searchStaffToolsForRole,
  staffToolForPath,
  staffToolsForRole,
  updateRecentStaffToolIds,
} from "../src/lib/staff-navigation.ts";

test("staff authentication is limited to the current browser session", async () => {
  const source = await readFile(new URL("../src/firebase/config.ts", import.meta.url), "utf8");
  const staffPersistence = source.match(
    /setPersistence\(firebaseAuth,\s*([A-Za-z]+Persistence)\)/u,
  );

  assert.equal(staffPersistence?.[1], "browserSessionPersistence");
  assert.equal(source.includes("browserLocalPersistence"), false);
});

test("the registry has one unique entry for every staff workspace route", () => {
  const expectedRoutes = [
    "/admin",
    "/admin/reception",
    "/admin/appointments",
    "/admin/consultations",
    "/admin/patients",
    "/admin/tasks",
    "/admin/communications",
    "/admin/billing",
    "/admin/lab",
    "/admin/staff",
    "/admin/patient-access",
    "/admin/app",
    "/admin/settings",
  ];

  assert.deepEqual(STAFF_TOOL_REGISTRY.map(({ href }) => href), expectedRoutes);
  assert.equal(new Set(STAFF_TOOL_REGISTRY.map(({ href }) => href)).size, expectedRoutes.length);
  assert.equal(new Set(STAFF_TOOL_REGISTRY.map(({ id }) => id)).size, expectedRoutes.length);
  assert.ok(STAFF_TOOL_REGISTRY.every((tool) => typeof tool.icon === "string" && tool.icon.length > 0));
});

test("role filters prevent staff from discovering restricted workspaces", () => {
  const doctorIds = staffToolsForRole("doctor").map(({ id }) => id);
  const receptionIds = staffToolsForRole("reception").map(({ id }) => id);

  assert.deepEqual(primaryStaffToolsForRole("admin").map(({ id }) => id), ["dashboard", "appointments", "patients"]);
  assert.deepEqual(primaryStaffToolsForRole("doctor").map(({ id }) => id), ["dashboard", "consultations", "patients"]);
  assert.deepEqual(primaryStaffToolsForRole("reception").map(({ id }) => id), ["dashboard", "reception", "appointments"]);

  assert.equal(doctorIds.includes("billing"), false);
  assert.equal(doctorIds.includes("staff"), false);
  assert.equal(doctorIds.includes("settings"), false);
  assert.equal(receptionIds.includes("consultations"), false);
  assert.equal(doctorIds.includes("dashboard"), true);
  assert.equal(receptionIds.includes("dashboard"), true);
  assert.equal(receptionIds.includes("patient-access"), false);

  const receptionQuick = quickStaffToolsForRole("reception");
  assert.equal(receptionQuick.length, 4);
  assert.equal(receptionQuick.find(({ id }) => id === "appointments")?.href, "/admin/appointments?new=1");
});

test("reception registration always opens the express reception route", () => {
  const registration = searchStaffToolsForRole("reception", "register patient")[0];
  assert.equal(registration?.id, "reception");
  assert.equal(registration?.href, "/admin/reception");
  assert.equal(staffToolForPath("/admin/reception?new=1#form")?.id, "reception");
});

test("action and keyword searches rank the intended role-safe tool first", () => {
  assert.equal(searchStaffToolsForRole("admin", "invite staff")[0]?.id, "staff");
  assert.equal(searchStaffToolsForRole("doctor", "write prescription")[0]?.id, "consultations");
  assert.equal(searchStaffToolsForRole("reception", "print receipt")[0]?.id, "billing");
  assert.equal(searchStaffToolsForRole("doctor", "bill patient").some(({ id }) => id === "billing"), false);
  assert.deepEqual(searchStaffToolsForRole("admin", ""), []);
});

test("grouping is complete and preserves registry order", () => {
  const grouped = groupedStaffToolsForRole("admin");
  assert.deepEqual(Object.keys(grouped), STAFF_TOOL_GROUPS);
  assert.deepEqual(grouped.management.map(({ id }) => id), ["staff", "settings"]);
  assert.deepEqual(
    STAFF_TOOL_GROUPS.flatMap((group) => grouped[group]).map(({ id }) => id).sort(),
    staffToolsForRole("admin").map(({ id }) => id).sort(),
  );
});

test("recent tools move to the front, deduplicate, discard invalid IDs, and stay role-safe", () => {
  const recentIds = updateRecentStaffToolIds(
    ["patients", "appointments", "patients", "unknown", "billing"],
    "appointments",
    4,
  );
  assert.deepEqual(recentIds, ["appointments", "patients", "billing"]);

  assert.deepEqual(
    recentStaffToolsForRole("doctor", recentIds).map(({ id }) => id),
    ["appointments", "patients"],
  );
  assert.deepEqual(
    recentStaffToolsForRole("reception", ["staff", "billing", "reception", "billing"]).map(({ id }) => id),
    ["billing", "reception"],
  );
});

test("patient launcher permissions expose only safe actions for each role", () => {
  assert.deepEqual(patientLauncherActionsForRole("admin").map(({ id }) => id), ["open", "book", "consult", "bill", "lab"]);
  assert.deepEqual(patientLauncherActionsForRole("doctor").map(({ id }) => id), ["open", "book", "consult", "lab"]);
  assert.deepEqual(patientLauncherActionsForRole("reception").map(({ id }) => id), ["open", "book", "bill", "lab"]);

  assert.equal(patientLauncherActionsForRole("doctor").some(({ href }) => href === "/admin/billing"), false);
  assert.equal(patientLauncherActionsForRole("reception").some(({ href }) => href === "/admin/consultations"), false);
});
