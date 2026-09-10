import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const patientsPage = await readFile(
  new URL("../src/app/admin/patients/page.tsx", import.meta.url),
  "utf8",
);

test("patient registry never imports the legacy bulk-directory helper", () => {
  const directoryImport = patientsPage.match(
    /import\s*\{[\s\S]*?\}\s*from\s*"@\/lib\/patient-directory";/u,
  )?.[0] || "";
  assert.match(directoryImport, /fetchPatientDirectoryPage/u);
  assert.match(directoryImport, /fetchPatientProfile/u);
  assert.match(directoryImport, /searchPatientDirectory/u);
  assert.match(directoryImport, /resolvePatientDirectoryEntries/u);
  assert.doesNotMatch(directoryImport, /\bfetchPatientDirectory\b/u);
});

test("reception hydrates one selected demographic profile before editing", () => {
  assert.match(
    patientsPage,
    /profile\.role !== "reception"[\s\S]*?fetchPatientProfile\(user, selectedId\)/u,
  );
  assert.match(
    patientsPage,
    /hydratedPatientId === selectedPatient\.id/u,
  );
  assert.match(patientsPage, /canEditSelectedProfile[\s\S]*?selectedProfileIsHydrated/u);
  assert.match(patientsPage, /Reception patient profile could not be loaded/u);
});

test("patient registry loads bounded recent pages and paginates both lists and searches", () => {
  assert.match(patientsPage, /fetchPatientDirectoryPage\(user, \{ pageSize: 25 \}\)/u);
  assert.match(patientsPage, /cursor: archivedOnly \? archivedCursor : activeCursor/u);
  assert.match(patientsPage, /setActiveCursor\(page\.nextCursor\)/u);
  assert.match(patientsPage, /setArchivedCursor\(page\.nextCursor\)/u);
  assert.match(patientsPage, /searchPatientDirectory\(user, term, \{/u);
  assert.match(patientsPage, /cursor: searchCursor/u);
  assert.match(patientsPage, /setSearchCursor\(result\.nextCursor\)/u);
  assert.match(patientsPage, /Load 25 more patients/u);
  assert.match(patientsPage, /Load more search results/u);
  assert.doesNotMatch(patientsPage, /visibleCount|setVisibleCount/u);
});

test("archived registry and search use the explicit admin-only archived scope", () => {
  assert.match(
    patientsPage,
    /profile\.role === "admin"[\s\S]*?fetchPatientDirectoryPage\(user, \{ pageSize: 25, archivedOnly: true \}\)/u,
  );
  assert.match(
    patientsPage,
    /archivedOnly: profile\.role === "admin" && patientView === "archived"/u,
  );
  assert.match(
    patientsPage,
    /const archivedOnly = profile\.role === "admin" && patientView === "archived"/u,
  );
  assert.doesNotMatch(
    patientsPage,
    /fetchPatientDirectoryPage\(user,\s*\{[^}]*includeArchived/u,
  );
});

test("navigation handoffs resolve the exact patient instead of proving it from a page", () => {
  assert.match(
    patientsPage,
    /resolvePatientDirectoryEntries\(user, requestedPatientId, \{[\s\S]*?includeArchived: profile\.role === "admin"/u,
  );
  assert.match(patientsPage, /result\.patients\[0\]/u);
  assert.match(patientsPage, /archived or is no longer available to your account/u);
  assert.doesNotMatch(
    patientsPage,
    /patients\.find\(\(candidate\) => candidate\.id === handoffPatientId\)/u,
  );
});

test("patient shortcuts preserve identity in memory and re-verify it at each target", async () => {
  const [quickActions, appointments, tasks, communications] = await Promise.all([
    readFile(new URL("../src/components/admin/PatientQuickActions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/admin/appointments/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/admin/tasks/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/admin/communications/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(quickActions, /intent: "create-patient-follow-up"[\s\S]*?patientId: patient\.id/u);
  assert.match(quickActions, /intent: "open-patient-reminder"[\s\S]*?patientId: patient\.id/u);
  assert.match(appointments, /getDoc\(doc\(database, "appointments", appointmentId\)\)/u);
  assert.match(appointments, /resolvePatientDirectoryEntries\(user, patientId/u);
  assert.match(tasks, /consumeAdminNavigationHandoff\("\/admin\/tasks"\)/u);
  assert.match(tasks, /resolvePatientDirectoryEntries\(user, linkedPatient\.id/u);
  assert.match(tasks, /patientId: patientIdForWrite,[\s\S]*?patientName: patientNameForWrite/u);
  assert.match(communications, /consumeAdminNavigationHandoff\("\/admin\/communications"\)/u);
  assert.match(communications, /candidate\.patientId !== linkedPatient\.id/u);
  assert.doesNotMatch(quickActions, /patientId=.*(?:URLSearchParams|sessionStorage|localStorage)/u);
});

test("rapid patient handoffs ignore stale lookups and reminders fail closed while unresolved", async () => {
  const [appointments, tasks, communications] = await Promise.all([
    readFile(new URL("../src/app/admin/appointments/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/admin/tasks/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/admin/communications/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(appointments, /handoffRequestRef\.current = requestId;[\s\S]*?handoffRequestRef\.current === requestId/u);
  assert.match(tasks, /handoffRequestRef\.current = requestId;[\s\S]*?handoffRequestRef\.current === requestId/u);
  assert.match(communications, /patientHandoffRequestRef\.current = requestId;[\s\S]*?patientHandoffRequestRef\.current === requestId/u);
  assert.match(appointments, /handoffRequestRef\.current \+= 1;[\s\S]*?removeEventListener/u);
  assert.match(tasks, /handoffRequestRef\.current \+= 1;[\s\S]*?removeEventListener/u);
  assert.match(communications, /patientHandoffRequestRef\.current \+= 1;[\s\S]*?removeEventListener/u);
  assert.match(communications, /const handoffBlocked = handoffLoading \|\| Boolean\(handoffError\)/u);
  assert.match(communications, /view === "due" && desk && !handoffBlocked/u);
  assert.match(communications, /view === "outbox" && desk && !handoffBlocked/u);
  assert.match(communications, /onClick=\{clearPatientHandoff\}[\s\S]*?Show all reminders/u);
});
