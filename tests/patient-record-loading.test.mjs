import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createPatientRecordLoadState,
  markPatientRecordSectionError,
  markPatientRecordSectionReady,
  patientRecordSectionCount,
  patientRecordSectionsAreReady,
  patientRecordSectionsForTab,
  preparePatientRecordSections,
} from "../src/lib/patient-record-loading.ts";

const adminAccess = { canViewClinical: true, canViewInvoices: true };
const doctorAccess = { canViewClinical: true, canViewInvoices: false };
const receptionAccess = { canViewClinical: false, canViewInvoices: true };

test("record tabs request only the active clinical section", () => {
  assert.deepEqual(patientRecordSectionsForTab("overview", adminAccess), []);
  assert.deepEqual(patientRecordSectionsForTab("visits", adminAccess), ["visits"]);
  assert.deepEqual(patientRecordSectionsForTab("prescriptions", adminAccess), ["prescriptions"]);
  assert.deepEqual(patientRecordSectionsForTab("growth", adminAccess), ["growthRecords"]);
  assert.deepEqual(patientRecordSectionsForTab("vaccinations", adminAccess), ["vaccinations"]);
  assert.deepEqual(patientRecordSectionsForTab("pregnancy", adminAccess), ["pregnancyRecords"]);
  assert.deepEqual(patientRecordSectionsForTab("reports", adminAccess), ["reports"]);
  assert.deepEqual(patientRecordSectionsForTab("visits", receptionAccess), []);
});

test("timeline requests a complete role-safe record set", () => {
  assert.deepEqual(patientRecordSectionsForTab("timeline", adminAccess), [
    "visits",
    "prescriptions",
    "growthRecords",
    "vaccinations",
    "pregnancyRecords",
    "reports",
    "labOrders",
    "invoices",
  ]);
  assert.deepEqual(patientRecordSectionsForTab("timeline", doctorAccess), [
    "visits",
    "prescriptions",
    "growthRecords",
    "vaccinations",
    "pregnancyRecords",
    "reports",
    "labOrders",
  ]);
  assert.deepEqual(patientRecordSectionsForTab("timeline", receptionAccess), [
    "labOrders",
    "invoices",
  ]);
});

test("record lifecycle distinguishes loading, verified empty, and failure", () => {
  const initial = createPatientRecordLoadState();
  const loading = preparePatientRecordSections(["visits", "reports"]);
  assert.equal(initial.visits.phase, "idle");
  assert.equal(loading.visits.phase, "loading");
  assert.equal(loading.reports.phase, "loading");
  assert.equal(loading.invoices.phase, "idle");
  assert.equal(patientRecordSectionCount(loading, "visits", 0), undefined);

  const visitsReady = markPatientRecordSectionReady(loading, "visits");
  assert.equal(patientRecordSectionCount(visitsReady, "visits", 0), 0);
  assert.equal(patientRecordSectionsAreReady(visitsReady, ["visits", "reports"]), false);
  assert.equal(loading.visits.phase, "loading", "state transitions must not mutate prior state");

  const reportsFailed = markPatientRecordSectionError(visitsReady, "reports", "Could not load reports.");
  assert.equal(reportsFailed.reports.phase, "error");
  assert.equal(reportsFailed.reports.error, "Could not load reports.");
  assert.equal(patientRecordSectionCount(reportsFailed, "reports", 0), undefined);
  assert.equal(patientRecordSectionsAreReady(reportsFailed, ["visits", "reports"]), false);

  const allReady = markPatientRecordSectionReady(reportsFailed, "reports");
  assert.equal(patientRecordSectionsAreReady(allReady, ["visits", "reports"]), true);
});

test("patient page guards subscriptions against stale selection and exposes retry UI", async () => {
  const source = await readFile(new URL("../src/app/admin/patients/page.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(selectedPatientIdRef\.current === patientId\) return;/);
  assert.match(source, /if \(!selectedId \|\| !selectedProfileIsHydrated\) return;/);
  assert.match(source, /if \(!active \|\| selectedPatientIdRef\.current !== patientId\) return;/);
  assert.match(source, /active && selectedPatientIdRef\.current === patientId/);
  assert.match(source, /const clinicalItems: TimelineItem\[\] = recordAccess\.canViewClinical/);
  assert.match(source, /recordAccess\.canViewInvoices \? invoices\.map/);
  assert.match(source, /PatientRecordSectionBoundary/);
  assert.match(source, /if \(tab === activeTab\) return;/);
  assert.match(source, /activeTab !== "overview" && \(activeTab === "timeline" \|\| canEditClinical\)/);
  assert.match(source, /vaccinations=\{canEditClinical \? vaccinations : \[\]\}/);
  assert.match(source, /pregnancyRecords=\{canEditClinical \? pregnancyRecords : \[\]\}/);
  assert.match(source, /Retry loading records/);
  assert.match(source, /No empty result is being shown because these records have not been verified\./);
  assert.doesNotMatch(source, /\(loadError\) => set(?:Visits|Prescriptions|Vaccinations|PregnancyRecords|GrowthRecords|Reports|Invoices|LabOrders)\(\[\]\)/);
});
