import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/lib/patient-identity.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "patient-identity.ts",
  reportDiagnostics: true,
});

assert.deepEqual(
  compiled.diagnostics ?? [],
  [],
  "patient-identity.ts should transpile without diagnostics",
);

const patientIdentity = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);

const {
  assessPatientDuplicate,
  buildPatientSearchQueryTokens,
  buildPatientSearchTokens,
  comparePatientNames,
  findPotentialPatientDuplicates,
  normalizeDateOfBirth,
  normalizeIndianPhone,
  normalizePatientName,
  normalizePatientNumber,
} = patientIdentity;

test("normalizes common Indian mobile formats to one E.164 value", () => {
  for (const input of [
    "98765 43210",
    "+91 98765-43210",
    "0091 9876543210",
    "91-9876543210",
    "09876543210",
  ]) {
    assert.equal(normalizeIndianPhone(input), "+919876543210");
  }
});

test("rejects invalid or partial phone values instead of matching them", () => {
  for (const input of ["", "12345", "5123456789", "+44 7700 900123", null]) {
    assert.equal(normalizeIndianPhone(input), null);
  }
});

test("normalizes names and patient numbers deterministically", () => {
  assert.equal(normalizePatientName("  Dr.  Śhafi   Ahamad "), "shafi ahamad");
  assert.equal(normalizePatientName("Baby of  Ananya"), "baby of ananya");
  assert.equal(normalizePatientName("अदिति शर्मा"), "अदिति शर्मा");
  assert.equal(normalizePatientNumber(" ahc-2026 / 0042 "), "AHC20260042");
});

test("normalizes only valid, unambiguous, non-future dates of birth", () => {
  const asOf = new Date(2026, 7, 2);
  assert.equal(normalizeDateOfBirth("1992-03-09", asOf), "1992-03-09");
  assert.equal(normalizeDateOfBirth("9/3/1992", asOf), "1992-03-09");
  assert.equal(normalizeDateOfBirth("31/02/1992", asOf), null);
  assert.equal(normalizeDateOfBirth("08/03/2027", asOf), null);
  assert.equal(normalizeDateOfBirth("03.09.1992", asOf), null);
});

test("builds bounded namespaced search prefixes", () => {
  const tokens = buildPatientSearchTokens({
    patientNumber: "AHC-0042",
    fullName: "Dr. Shaik Reshma",
    phone: "+91 98765 43210",
    dateOfBirth: "1992-03-09",
  });

  assert.ok(tokens.includes("name:sh"));
  assert.ok(tokens.includes("name:shaik r"));
  assert.ok(tokens.includes("name:resh"));
  assert.ok(tokens.includes("name-exact:shaik reshma"));
  assert.ok(tokens.includes("phone:98765"));
  assert.ok(tokens.includes("phone-exact:+919876543210"));
  assert.ok(tokens.includes("patient:AHC0"));
  assert.ok(tokens.includes("patient-exact:AHC0042"));
  assert.ok(tokens.includes("dob:1992-03-09"));
  assert.equal(tokens.length, new Set(tokens).size);
  assert.ok(tokens.length <= 96);
});

test("converts a staff query into compatible lookup tokens", () => {
  assert.deepEqual(buildPatientSearchQueryTokens("98765"), ["phone:98765", "patient:98765", "patient-exact:98765"]);
  assert.ok(buildPatientSearchQueryTokens("Resh").includes("name:resh"));
  assert.ok(buildPatientSearchQueryTokens("AHC-0042").includes("patient:AHC0042"));
  assert.ok(buildPatientSearchQueryTokens("09/03/1992").includes("dob:1992-03-09"));
});

test("recognizes safe exact and near-exact name comparisons", () => {
  assert.equal(comparePatientNames("Reshma Shaik", "Shaik Reshma").match, "strong");
  assert.equal(comparePatientNames("Shafi Ahamad", "Shafi Ahmad").match, "strong");
  assert.equal(comparePatientNames("Ravi Kumar", "Rani Kumar").match, "none");
});

test("requires three agreeing identity signals for high confidence", () => {
  const assessment = assessPatientDuplicate(
    { fullName: "Shafi Ahamad", phone: "9876543210", dateOfBirth: "1980-02-10" },
    { fullName: "Dr Shafi Ahmad", phone: "+91 98765 43210", dateOfBirth: "10/02/1980" },
  );

  assert.equal(assessment.confidence, "high");
  assert.deepEqual(assessment.reasons, ["phone", "date-of-birth", "name-strong"]);
  assert.equal(assessment.requiresReview, true);
  assert.equal(assessment.safeToAutoMerge, false);
});

test("shared family phone alone is only a possible duplicate", () => {
  const assessment = assessPatientDuplicate(
    { fullName: "Aarav Rao", phone: "9876543210", dateOfBirth: "2019-04-02" },
    { fullName: "Ananya Rao", phone: "9876543210", dateOfBirth: "1991-05-11" },
  );

  assert.equal(assessment.confidence, "possible");
  assert.deepEqual(assessment.reasons, ["phone"]);
  assert.deepEqual(assessment.conflicts.sort(), ["date-of-birth", "name"]);
});

test("name and DOB can flag a probable duplicate after a phone change", () => {
  const assessment = assessPatientDuplicate(
    { fullName: "Reshma Shaik", phone: "9876543210", dateOfBirth: "1992-03-09" },
    { fullName: "Shaik Reshma", phone: "9123456780", dateOfBirth: "09/03/1992" },
  );

  assert.equal(assessment.confidence, "probable");
  assert.ok(assessment.conflicts.includes("phone"));
  assert.equal(assessment.safeToAutoMerge, false);
});

test("invalid identifiers never create a false high-confidence match", () => {
  const assessment = assessPatientDuplicate(
    { fullName: "", phone: "12345", dateOfBirth: "31/02/2020" },
    { fullName: "", phone: "12345", dateOfBirth: "31/02/2020" },
  );
  assert.equal(assessment.confidence, "none");
  assert.equal(assessment.requiresReview, false);
});

test("finds and ranks potential duplicates without mutating the input", () => {
  const records = [
    { id: "phone-only", fullName: "Different Person", phone: "9876543210" },
    { id: "best", fullName: "Shafi Ahmad", phone: "9876543210", dateOfBirth: "1980-02-10" },
    { id: "none", fullName: "Someone Else", phone: "9123456780" },
  ];

  const matches = findPotentialPatientDuplicates(
    { fullName: "Shafi Ahamad", phone: "9876543210", dateOfBirth: "1980-02-10" },
    records,
  );
  assert.deepEqual(matches.map(({ patient }) => patient.id), ["best", "phone-only"]);
  assert.equal(records[0].id, "phone-only");
});
