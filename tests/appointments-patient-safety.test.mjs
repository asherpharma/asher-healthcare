import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appointmentsSource = await readFile(
  new URL("../src/app/admin/appointments/page.tsx", import.meta.url),
  "utf8",
);

test("appointment safety resolves only the patients referenced by loaded appointments", () => {
  assert.match(
    appointmentsSource,
    /import \{ resolvePatientDirectoryEntries \} from "@\/lib\/patient-directory";/u,
  );
  assert.doesNotMatch(appointmentsSource, /fetchPatientDirectory(?:Page)?/u);
  assert.match(
    appointmentsSource,
    /const appointmentPatientIds = useMemo\([\s\S]*?uniqueAppointmentPatientIds\(allItems\)/u,
  );
});

test("loaded appointment patient ids are deduplicated and resolved in batches of at most 50", () => {
  assert.match(appointmentsSource, /const PATIENT_SAFETY_BATCH_SIZE = 50;/u);
  assert.match(appointmentsSource, /const patientIds = new Set<string>\(\);/u);
  assert.match(
    appointmentsSource,
    /patientIds\.slice\(index, index \+ PATIENT_SAFETY_BATCH_SIZE\)/u,
  );
  assert.match(
    appointmentsSource,
    /await Promise\.all\([\s\S]*?patientSafetyBatches\(appointmentPatientIds\)\.map[\s\S]*?resolvePatientDirectoryEntries\(user, patientIds/u,
  );
});

test("appointment actions stay paused until every exact patient batch resolves", () => {
  assert.match(
    appointmentsSource,
    /patientSafetyRequestRef\.current = requestId;[\s\S]*?setArchiveLoading\(true\);[\s\S]*?await Promise\.all/u,
  );
  assert.match(
    appointmentsSource,
    /if \(requestId === patientSafetyRequestRef\.current\) setArchiveLoading\(false\);/u,
  );
  assert.match(
    appointmentsSource,
    /if \(archiveLoading \|\| archiveSafetyError \|\| appointmentPatientIsUnavailable\(item\)\) return false;/u,
  );
  assert.match(
    appointmentsSource,
    /setActivePatientIds\(new Set\(\)\);[\s\S]*?Appointment actions are paused to protect patient records/u,
  );
});

test("patient handoffs and write-time checks use exact fail-closed resolution", () => {
  assert.match(
    appointmentsSource,
    /resolvePatientDirectoryEntries\(user, \[patientId\], \{ includeArchived: profile\.role === "admin" \}\)/u,
  );
  assert.match(
    appointmentsSource,
    /async function verifyPatientIsActive[\s\S]*?resolvePatientDirectoryEntries\(user, \[patientId\]/u,
  );
  assert.match(
    appointmentsSource,
    /patient\.id === patientId && patient\.archived !== true/u,
  );
  assert.match(
    appointmentsSource,
    /next\.delete\(patientId\);[\s\S]*?archived or unavailable/u,
  );
});
