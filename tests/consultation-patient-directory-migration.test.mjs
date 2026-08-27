import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const consultationSource = await readFile(
  new URL("../src/app/admin/consultations/page.tsx", import.meta.url),
  "utf8",
);

test("consultation workspace has no legacy bulk directory or getDoc enumeration", () => {
  assert.doesNotMatch(consultationSource, /\bfetchPatientDirectory\b/u);
  assert.doesNotMatch(consultationSource, /\bgetDoc\s*\(/u);
  assert.match(consultationSource, /fetchPatientDirectoryPage/u);
  assert.match(consultationSource, /searchPatientDirectory/u);
  assert.match(consultationSource, /resolvePatientDirectoryEntries/u);
});

test("consultation workspace starts with a recent bounded patient page", () => {
  assert.match(
    consultationSource,
    /fetchPatientDirectoryPage\(user, \{ pageSize: 25 \}\)/u,
  );
  assert.match(
    consultationSource,
    /Showing recent active patients\. Search to find older charts\./u,
  );
});

test("general and appointment-link patient searches are readiness gated and debounced", () => {
  for (const [searchValue, sequenceRef, loadingSetter] of [
    ["search", "patientSearchSequenceRef", "setPatientSearchLoading"],
    ["linkSearch", "linkSearchSequenceRef", "setLinkSearchLoading"],
  ]) {
    const pattern = new RegExp(
      `const term = ${searchValue}\\.trim\\(\\);[\\s\\S]*?const sequence = \\+\\+${sequenceRef}\\.current;[\\s\\S]*?if \\(!term \\|\\| !patientSearchReady\\(term\\)\\) return;[\\s\\S]*?window\\.setTimeout[\\s\\S]*?${loadingSetter}\\(true\\);[\\s\\S]*?searchPatientDirectory\\(user, term, \\{ pageSize: 12 \\}\\)[\\s\\S]*?\\}, 260\\);`,
      "u",
    );
    assert.match(consultationSource, pattern);
  }
  assert.equal(
    [...consultationSource.matchAll(/searchPatientDirectory\(user, term, \{ pageSize: 12 \}\)/gu)].length,
    2,
  );
});

test("appointment patient links resolve exactly in complete batches of at most 50", () => {
  assert.match(consultationSource, /const PATIENT_RESOLUTION_BATCH_SIZE = 50;/u);
  assert.match(
    consultationSource,
    /appointments\.map\(\(appointment\) => appointment\.patientId\)[\s\S]*?new Set/u,
  );
  assert.match(
    consultationSource,
    /missingIds\.slice\([\s\S]*?index \* PATIENT_RESOLUTION_BATCH_SIZE[\s\S]*?\(index \+ 1\) \* PATIENT_RESOLUTION_BATCH_SIZE/u,
  );
  assert.match(
    consultationSource,
    /Promise\.all\(batches\.map\(\(batch\) => resolvePatientDirectoryEntries\(user, batch\)\)\)/u,
  );
  assert.match(
    consultationSource,
    /result\.unavailableIds\.forEach[\s\S]*?unavailablePatientRecords\.current\.add/u,
  );
});

test("direct patient handoff verifies the exact active chart", () => {
  assert.match(
    consultationSource,
    /handoff\.intent !== "open-patient-consultation"[\s\S]*?resolvePatientDirectoryEntries\(user, handoff\.patientId\)/u,
  );
  assert.match(
    consultationSource,
    /result\.patients\.find\(\(candidate\) => candidate\.id === handoff\.patientId\)[\s\S]*?!patient \|\| !isActivePatient\(patient\)/u,
  );
});

test("starting and completing consultations recheck the exact patient before writes", () => {
  assert.match(
    consultationSource,
    /async function beginAppointmentConsultation[\s\S]*?resolvePatientDirectoryEntries\(user, patientId\)[\s\S]*?await batch\.commit\(\)/u,
  );
  assert.match(
    consultationSource,
    /const candidate = verifiedPatient;[\s\S]*?appointmentSelectionError/u,
  );
  assert.match(
    consultationSource,
    /async function completeConsultation[\s\S]*?resolvePatientDirectoryEntries\(user, selectedPatient\.id\)[\s\S]*?await batch\.commit\(\)/u,
  );
  assert.match(
    consultationSource,
    /patient\.id === selectedPatient\.id && patient\.archived !== true/u,
  );
});

test("opening a patient linker clears results from the previous appointment", () => {
  assert.match(
    consultationSource,
    /const initialLinkSearch = entry\.patientName \|\| entry\.phone \|\| "";[\s\S]*?setLinkSearchResults\(\[\]\);[\s\S]*?setLinkSearchLoading\(patientSearchReady\(initialLinkSearch\)\)/u,
  );
  assert.match(
    consultationSource,
    /const initialLinkSearch = isLinking \? "" : entry\.patientName \|\| entry\.phone \|\| "";[\s\S]*?setLinkSearchResults\(\[\]\)/u,
  );
});
