import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const labSource = await readFile(
  new URL("../src/app/admin/lab/page.tsx", import.meta.url),
  "utf8",
);

test("lab desk no longer imports the legacy bounded bulk patient directory", () => {
  assert.doesNotMatch(labSource, /\bfetchPatientDirectory\b/u);
  assert.match(labSource, /fetchPatientDirectoryPage/u);
  assert.match(labSource, /searchPatientDirectory/u);
  assert.match(labSource, /resolvePatientDirectoryEntries/u);
});

test("lab patient picker uses a recent page and debounced server search", () => {
  assert.match(
    labSource,
    /fetchPatientDirectoryPage\(user, \{ pageSize: 25 \}\)/u,
  );
  assert.match(labSource, /patientSearchReady\(term\)/u);
  assert.match(
    labSource,
    /window\.setTimeout\(\(\) => \{[\s\S]*?searchPatientDirectory\(user, term, \{ pageSize: 12 \}\)[\s\S]*?\}, 260\)/u,
  );
  assert.match(
    labSource,
    /const sequence = \+\+patientSearchSequence\.current;[\s\S]*?sequence !== patientSearchSequence\.current/u,
  );
});

test("doctor urgent lab pages use an opaque cursor and append unique results", () => {
  assert.match(labSource, /const DOCTOR_URGENT_PAGE_SIZE = 25;/u);
  assert.match(labSource, /view: "doctor-urgent",[\s\S]*?pageSize: String\(DOCTOR_URGENT_PAGE_SIZE\)/u);
  assert.match(labSource, /if \(cursor\) params\.set\("cursor", cursor\);/u);
  assert.match(
    labSource,
    /profile\.role === "doctor"[\s\S]*?fetch\(doctorUrgentDirectoryUrl\(\), \{[\s\S]*?signal: controller\.signal/u,
  );
  assert.match(labSource, /setDoctorUrgentNextCursor\(typeof result\.nextCursor === "string" \? result\.nextCursor : ""\)/u);
  assert.match(labSource, /setDoctorUrgentHasMore\(result\.hasMore === true\)/u);
  assert.match(labSource, /setOrders\(\(current\) => appendUniqueLabOrders\(current, nextOrders\)\)/u);
  assert.match(labSource, /new Map\(current\.map\(\(order\) => \[order\.id, order\]\)\)/u);
  assert.match(labSource, /if \(!added\) return current;/u);
  assert.doesNotMatch(labSource, /setDoctorUrgentHasMore\([^\n]*labOrders[^\n]*length/u);
});

test("doctor urgent pagination is scoped, retryable, and mobile accessible", () => {
  assert.match(labSource, /!doctorUrgentDirectoryMode[\s\S]*?!doctorUrgentHasMore[\s\S]*?doctorUrgentRequestRef\.current[\s\S]*?patientSafetyVerifyingMore/u);
  assert.match(
    labSource,
    /const doctorUrgentDirectoryMode = profile\.role === "doctor"[\s\S]*?priorityFilter === "urgent"[\s\S]*?statusFilter/u,
  );
  assert.match(labSource, /doctorUrgentRequestRef\.current = controller;/u);
  assert.match(labSource, /doctorUrgentLoadMoreError/u);
  assert.match(labSource, /role="alert"/u);
  assert.match(labSource, /aria-busy=\{doctorUrgentLoadingMore \|\| patientSafetyVerifyingMore\}/u);
  assert.match(labSource, /aria-controls="lab-order-list"/u);
  assert.match(labSource, /id="lab-order-list"/u);
  assert.match(labSource, /min-h-12 w-full[^"]*sm:w-auto/u);
  assert.match(labSource, /role="status"/u);
  assert.match(labSource, /Load more urgent orders/u);
  assert.match(labSource, /profile\.role === "reception"[\s\S]*?fetch\("\/api\/staff\/labs\/directory"/u);
  assert.match(
    labSource,
    /profile\.role === "reception" \|\| profile\.role === "doctor"[\s\S]*?fetch\("\/api\/staff\/labs\/directory"/u,
  );
});

test("urgent navigation hydrates URL filters before loading and aborts fallback requests", () => {
  assert.match(labSource, /const \[urlFiltersHydrated, setUrlFiltersHydrated\] = useState\(false\)/u);
  assert.match(labSource, /setPriorityFilter\(requestedPriority\);[\s\S]*?setUrlFiltersHydrated\(true\)/u);
  assert.match(labSource, /if \(!urlFiltersHydrated\) return;/u);
  assert.match(labSource, /const fullDirectoryRequestRef = useRef<AbortController \| null>\(null\)/u);
  assert.match(labSource, /fetch\("\/api\/staff\/labs\/directory", \{[\s\S]*?signal: controller\.signal/u);
  assert.match(labSource, /fullDirectoryRequestRef\.current\?\.abort\(\)/u);
});

test("loaded lab-order patients cache exact validation and resolve only new IDs in batches of 50", () => {
  assert.match(labSource, /const PATIENT_SAFETY_BATCH_SIZE = 50;/u);
  assert.match(
    labSource,
    /const patientIds = \[\.\.\.new Set\(orders\.map\(\(order\) => order\.patientId\)\.filter\(Boolean\)\)\];/u,
  );
  assert.match(
    labSource,
    /const unverifiedPatientIds = patientIds\.filter\([\s\S]*?!patientSafetyCheckedIdsRef\.current\.has\(patientId\)/u,
  );
  assert.match(
    labSource,
    /unverifiedPatientIds\.slice\([\s\S]*?PATIENT_SAFETY_BATCH_SIZE[\s\S]*?batches\.map\(\(batch\) => resolvePatientDirectoryEntries\(user, batch\)\)/u,
  );
  assert.match(
    labSource,
    /unverifiedPatientIds\.forEach\(\(patientId\) => patientSafetyCheckedIdsRef\.current\.add\(patientId\)\)/u,
  );
  assert.match(labSource, /resolved\.forEach\(\(patientId\) => patientSafetyActiveIdsRef\.current\.add\(patientId\)\)/u);
  assert.match(labSource, /if \(!scopeChanged\) setPatientSafetyVerifyingMore\(true\)/u);
  assert.match(labSource, /disabled=\{doctorUrgentLoadingMore \|\| patientSafetyVerifyingMore\}/u);
});

test("lab navigation handoff resolves and verifies the exact requested patient", () => {
  assert.match(
    labSource,
    /const requestedPatientId = handoffPatientId;[\s\S]*?resolvePatientDirectoryEntries\(user, requestedPatientId\)/u,
  );
  assert.match(
    labSource,
    /result\.patients\.find\(\(entry\) => \([\s\S]*?entry\.id === requestedPatientId && entry\.archived !== true/u,
  );
});

test("status, result, and report actions fail closed and recheck the exact patient", () => {
  assert.match(
    labSource,
    /async function verifyActivePatient\(patientIdToVerify: string\)[\s\S]*?resolvePatientDirectoryEntries\(user, patientIdToVerify\)/u,
  );
  assert.match(
    labSource,
    /setActiveOrderPatientIds\(new Set\(\)\);[\s\S]*?setPatientSafetyScope\(""\);[\s\S]*?Laboratory actions are paused/u,
  );
  assert.match(
    labSource,
    /async function changeStatus[\s\S]*?await verifyActivePatient\(order\.patientId\);[\s\S]*?await updateDoc/u,
  );
  assert.match(
    labSource,
    /async function saveResult[\s\S]*?await verifyActivePatient\(resultOrder\.patientId\);[\s\S]*?uploadBytesResumable/u,
  );
  assert.match(
    labSource,
    /async function accessReport[\s\S]*?openPendingReportWindow\(\)[\s\S]*?await verifyActivePatient\(order\.patientId\);[\s\S]*?\/api\/labs\/report-access/u,
  );
});
