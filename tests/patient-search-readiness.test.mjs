import assert from "node:assert/strict";
import test from "node:test";

import { patientSearchReady } from "../src/lib/patient-search-readiness.ts";

test("global patient search becomes ready for bounded names and Indian mobile formats", () => {
  assert.equal(patientSearchReady("Asha"), true);
  assert.equal(patientSearchReady("  Meera Rao  "), true);
  assert.equal(patientSearchReady("Éva"), true);
  assert.equal(patientSearchReady("Li"), false);
  assert.equal(patientSearchReady("9019263709"), true);
  assert.equal(patientSearchReady("+91 90192 63709"), true);
  assert.equal(patientSearchReady("09019263709"), true);
  assert.equal(patientSearchReady("+91"), false);
});

test("global patient search accepts clinic numbers and treats incomplete hyphens as not ready", () => {
  for (const value of ["ASH-1", "ash-ABC", "AHC-00042", "MRN-12", "ASH-12-3"]) {
    assert.equal(patientSearchReady(value), true, `${value} should be search-ready`);
  }
  for (const value of ["", "-", "--", "A-", " A "]) {
    assert.equal(patientSearchReady(value), false, `${value || "blank"} should not be search-ready`);
  }
});
