import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const consultationSource = await readFile(
  new URL("../src/app/admin/consultations/page.tsx", import.meta.url),
  "utf8",
);

test("mobile doctors can switch clearly between the queue and consultation", () => {
  assert.match(consultationSource, /type MobileDoctorView = "queue" \| "consultation";/u);
  assert.match(consultationSource, /data-mobile-doctor-switcher/u);
  assert.match(consultationSource, /aria-label="Doctor mobile workspace view"/u);
  assert.match(consultationSource, /data-mobile-doctor-view="queue"/u);
  assert.match(consultationSource, /data-mobile-doctor-view="consultation"/u);
  assert.match(consultationSource, /xl:block/u);
});

test("selecting a patient reveals and focuses the mobile consultation chart", () => {
  assert.match(
    consultationSource,
    /if \(!selectedPatientId\) return;[\s\S]*?setMobileWorkspaceView\("consultation"\);[\s\S]*?consultationWorkspaceRef\.current/u,
  );
  assert.match(consultationSource, /workspace\.scrollIntoView/u);
  assert.match(consultationSource, /workspace\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(consultationSource, /prefers-reduced-motion: reduce/u);
});

test("the sticky patient context exposes each consultation section and safe completion", () => {
  for (const sectionId of [
    "consultation-clinical",
    "consultation-prescription",
    "consultation-laboratory",
    "consultation-follow-up",
    "consultation-complete",
  ]) {
    assert.match(consultationSource, new RegExp(`id="${sectionId}"`, "u"));
  }
  assert.match(consultationSource, /aria-label="Consultation section shortcuts"/u);
  assert.match(consultationSource, /id === "consultation-complete" \? "bg-\[#233A59\] text-white"/u);
  assert.match(consultationSource, /<button type="submit" disabled=\{saving\}/u);
});

test("mobile navigation leaves consultation autosave and role protections intact", () => {
  assert.match(consultationSource, /\/api\/staff\/consultation-draft/u);
  assert.match(consultationSource, /confirmConsultationSwitch\(\)/u);
  assert.match(consultationSource, /doctorCanOpenAppointment/u);
  assert.match(consultationSource, /draftStatus === "dirty" \|\| draftStatus === "saving" \|\| draftStatus === "error"/u);
});
