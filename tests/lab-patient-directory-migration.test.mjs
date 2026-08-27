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

test("loaded lab-order patients resolve exactly in complete batches of at most 50", () => {
  assert.match(labSource, /const PATIENT_SAFETY_BATCH_SIZE = 50;/u);
  assert.match(
    labSource,
    /const patientIds = \[\.\.\.new Set\(orders\.map\(\(order\) => order\.patientId\)\.filter\(Boolean\)\)\];/u,
  );
  assert.match(
    labSource,
    /patientIds\.slice\([\s\S]*?index \* PATIENT_SAFETY_BATCH_SIZE[\s\S]*?\(index \+ 1\) \* PATIENT_SAFETY_BATCH_SIZE/u,
  );
  assert.match(
    labSource,
    /await Promise\.all\([\s\S]*?batches\.map\(\(batch\) => resolvePatientDirectoryEntries\(user, batch\)\)/u,
  );
  assert.match(
    labSource,
    /setPatientSafetyLoading\(true\);[\s\S]*?setPatientSafetyScope\(""\);[\s\S]*?setActiveOrderPatientIds\(new Set\(\)\);/u,
  );
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
