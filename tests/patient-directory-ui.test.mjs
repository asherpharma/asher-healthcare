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
