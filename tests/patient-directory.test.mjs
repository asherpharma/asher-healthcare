import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_DIRECTORY_PAGE_SIZE,
  MAX_PATIENT_RESOLVER_IDS,
  normalizeDirectoryCursor,
  normalizeDirectoryPageSize,
  normalizePatientResolverIds,
  patientDirectoryListUrl,
  patientDirectoryPageForStaff,
  projectLegacyPatientSearch,
  projectPatientDirectory,
  resolvePatientDirectoryEntriesForStaff,
} from "../server/patients/directory.js";
import {
  createPatientSearchPrefixes,
  patientSearchDoctorKey,
  patientSearchToken,
} from "../server/patients/search-index.js";
import {
  decodePatientSearchCursor,
  encodePatientSearchCursor,
  patientSearchQuery,
  patientSearchStaffScope,
  projectPatientSearchResults,
} from "../server/patients/search.js";
import {
  patientSearchBackfillWrites,
  planPatientSearchBackfill,
} from "../server/patients/search-backfill.js";

const activePediatricPatient = {
  id: "patient-ped",
  patientNumber: "ASH-PED001",
  fullName: "Aarav Kumar",
  phone: "9000000001",
  dateOfBirth: "2020-04-05",
  gender: "male",
  doctorId: "pediatrics",
  doctorName: "Dr. Lt Col Shafi Ahamad",
  caseType: "specialist",
  specialty: "pediatrics",
  consultationFee: 500,
  address: "RK Hegde Nagar",
  allergies: "Peanuts",
  medicalHistory: "Asthma",
  createdAt: "2026-08-01T10:00:00.000Z",
};

const activeObgPatient = {
  id: "patient-obg",
  patientNumber: "ASH-OBG001",
  fullName: "Meera Rao",
  phone: "9000000002",
  dateOfBirth: "1992-08-10",
  gender: "female",
  doctorId: "obg",
  doctorName: "Dr. Shaik Reshma",
  caseType: "specialist",
  specialty: "obg",
  consultationFee: 500,
  address: "Thanisandra",
  allergies: "Penicillin",
  medicalHistory: "Private history",
  createdAt: "2026-08-02T10:00:00.000Z",
};

const archivedPatient = {
  ...activePediatricPatient,
  id: "patient-archived",
  patientNumber: "ASH-OLD001",
  fullName: "Archived Patient",
  archived: true,
  archivedAt: "2026-08-03T10:00:00.000Z",
  archivedBy: "admin-user",
  archiveReason: "Duplicate chart",
};

const documents = [activePediatricPatient, activeObgPatient, archivedPatient];

test("reception gets active operational records without clinical history", () => {
  const patients = projectPatientDirectory(
    documents,
    { uid: "reception-user", role: "reception" },
    { active: true },
  );

  assert.deepEqual(patients.map((patient) => patient.id).sort(), ["patient-obg", "patient-ped"]);
  patients.forEach((patient) => {
    assert.equal("address" in patient, false);
    assert.equal("allergies" in patient, false);
    assert.equal("medicalHistory" in patient, false);
    assert.equal("createdAt" in patient, false);
    assert.equal("updatedAt" in patient, false);
    assert.equal("archived" in patient, false);
  });
});

test("directory pages are capped, recent-first, and request only operational fields", () => {
  assert.equal(normalizeDirectoryPageSize(10_000), MAX_DIRECTORY_PAGE_SIZE);
  assert.equal(normalizeDirectoryPageSize(0), 1);
  assert.equal(normalizeDirectoryPageSize("not-a-number"), 25);
  assert.equal(normalizeDirectoryCursor("page-token_1"), "page-token_1");
  assert.throws(() => normalizeDirectoryCursor("private token?"), /expired/u);

  const url = patientDirectoryListUrl(
    { FIREBASE_PROJECT_ID: "asher-test" },
    { pageSize: 10_000, cursor: "page-token_1" },
  );
  assert.equal(url.searchParams.get("pageSize"), String(MAX_DIRECTORY_PAGE_SIZE));
  assert.equal(url.searchParams.get("pageToken"), "page-token_1");
  assert.equal(url.searchParams.get("orderBy"), "updatedAt desc");
  const fields = url.searchParams.getAll("mask.fieldPaths");
  assert.equal(fields.includes("fullName"), true);
  assert.equal(fields.includes("address"), false);
  assert.equal(fields.includes("allergies"), false);
  assert.equal(fields.includes("medicalHistory"), false);

  const archivedUrl = patientDirectoryListUrl(
    { FIREBASE_PROJECT_ID: "asher-test" },
    { pageSize: 25, archivedOnly: true },
  );
  assert.equal(archivedUrl.searchParams.get("orderBy"), "archived desc, updatedAt desc");
});

test("the recent directory endpoint returns one bounded minimal page", async () => {
  const requestedUrls = [];
  const responseDocument = {
    name: "projects/asher-test/databases/(default)/documents/patients/patient-ped",
    fields: {
      patientNumber: { stringValue: "ASH-PED001" },
      fullName: { stringValue: "Aarav Kumar" },
      phone: { stringValue: "9000000001" },
      doctorId: { stringValue: "pediatrics" },
      doctorName: { stringValue: "Dr. Lt Col Shafi Ahamad" },
      archived: { booleanValue: false },
      updatedAt: { timestampValue: "2026-08-13T10:00:00.000Z" },
    },
  };
  const result = await patientDirectoryPageForStaff(
    { FIREBASE_PROJECT_ID: "asher-test" },
    { uid: "reception-1", role: "admin" },
    { pageSize: 10_000 },
    {
      async getDocument(_env, path) {
        assert.equal(path, "staff/reception-1");
        return { data: { active: true, role: "reception" } };
      },
      async accessTokenProvider() { return "access-token"; },
      async fetchImpl(url) {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({ documents: [responseDocument] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  );

  assert.equal(requestedUrls.length, 1);
  assert.equal(new URL(requestedUrls[0]).searchParams.get("pageSize"), "50");
  assert.deepEqual(result, {
    patients: [{
      id: "patient-ped",
      patientNumber: "ASH-PED001",
      fullName: "Aarav Kumar",
      phone: "9000000001",
      dateOfBirth: "",
      gender: "",
      doctorId: "pediatrics",
      doctorName: "Dr. Lt Col Shafi Ahamad",
      caseType: "",
      specialty: "",
      consultationFee: 0,
    }],
    nextCursor: "",
    hasMore: false,
  });
});

test("exact patient resolver is capped, deduplicated, and validates references", () => {
  assert.deepEqual(normalizePatientResolverIds(["patient-1", "patient-1"]), ["patient-1"]);
  assert.throws(() => normalizePatientResolverIds([]), /at least one/u);
  assert.throws(() => normalizePatientResolverIds(["patient/private"]), /invalid/u);
  assert.throws(
    () => normalizePatientResolverIds(Array.from(
      { length: MAX_PATIENT_RESOLVER_IDS + 1 },
      (_, index) => `patient-${index}`,
    )),
    /No more than 50/u,
  );
});

test("exact patient resolver reports missing, archived, and out-of-scope charts identically", async () => {
  const records = new Map([
    ["patients/patient-ped", { data: activePediatricPatient }],
    ["patients/patient-obg", { data: activeObgPatient }],
    ["patients/patient-archived", { data: archivedPatient }],
  ]);
  const result = await resolvePatientDirectoryEntriesForStaff(
    { FIREBASE_PROJECT_ID: "asher-test" },
    { uid: "doctor-1", role: "admin" },
    {
      patientIds: ["patient-ped", "patient-obg", "patient-archived", "patient-missing"],
      includeArchived: true,
    },
    {
      async getDocument(_env, path) {
        if (path === "staff/doctor-1") {
          return {
            data: {
              active: true,
              role: "doctor",
              doctorName: "Dr. Lt Col Shafi Ahamad",
            },
          };
        }
        return records.get(path) || null;
      },
    },
  );

  assert.deepEqual(result.patients.map((patient) => patient.id), ["patient-ped"]);
  assert.deepEqual(result.unavailableIds, [
    "patient-obg",
    "patient-archived",
    "patient-missing",
  ]);
  assert.equal("address" in result.patients[0], false);
  assert.equal("allergies" in result.patients[0], false);
  assert.equal("archived" in result.patients[0], false);
});

test("admin exact resolver can explicitly inspect archive metadata", async () => {
  const result = await resolvePatientDirectoryEntriesForStaff(
    {},
    { uid: "admin-1", role: "admin" },
    { patientIds: "patient-archived", includeArchived: true },
    {
      async getDocument(_env, path) {
        if (path === "staff/admin-1") return { data: { active: true, role: "admin" } };
        if (path === "patients/patient-archived") return { data: archivedPatient };
        return null;
      },
    },
  );

  assert.deepEqual(result.unavailableIds, []);
  assert.equal(result.patients[0].archived, true);
  assert.equal(result.patients[0].archiveReason, "Duplicate chart");
});

test("archived-only directory is admin-only and returns archive metadata", () => {
  const patients = projectPatientDirectory(
    documents,
    { uid: "admin-user", role: "admin" },
    { active: true, role: "admin" },
    { archivedOnly: true },
  );
  assert.deepEqual(patients.map((patient) => patient.id), ["patient-archived"]);
  assert.equal(patients[0].archived, true);
  assert.equal(patients[0].archiveReason, "Duplicate chart");
  assert.throws(
    () => projectPatientDirectory(
      documents,
      { uid: "reception-user", role: "reception" },
      { active: true, role: "reception" },
      { archivedOnly: true },
    ),
    /Only clinic administrators/u,
  );
});

test("archived-only page stops before the active registry", async () => {
  const encodedPatient = (patient) => ({
    name: `projects/asher-test/databases/(default)/documents/patients/${patient.id}`,
    fields: {
      fullName: { stringValue: patient.fullName },
      phone: { stringValue: patient.phone },
      archived: { booleanValue: patient.archived === true },
      updatedAt: { timestampValue: "2026-08-13T10:00:00.000Z" },
      archiveReason: { stringValue: patient.archiveReason || "" },
    },
  });
  const result = await patientDirectoryPageForStaff(
    { FIREBASE_PROJECT_ID: "asher-test" },
    { uid: "admin-1", role: "admin" },
    { archivedOnly: true, pageSize: 25 },
    {
      async getDocument() { return { data: { active: true, role: "admin" } }; },
      async accessTokenProvider() { return "access-token"; },
      async fetchImpl(url) {
        assert.equal(
          new URL(String(url)).searchParams.get("orderBy"),
          "archived desc, updatedAt desc",
        );
        return new Response(JSON.stringify({
          documents: [encodedPatient(archivedPatient), encodedPatient(activePediatricPatient)],
          nextPageToken: "active-page-token",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  );

  assert.deepEqual(result.patients.map((patient) => patient.id), ["patient-archived"]);
  assert.equal(result.nextCursor, "");
  assert.equal(result.hasMore, false);
});

test("only an admin requesting archived records receives archive metadata", () => {
  const patients = projectPatientDirectory(
    documents,
    { uid: "admin-user", role: "admin" },
    { active: true },
    { includeArchived: true },
  );
  const archived = patients.find((patient) => patient.id === "patient-archived");

  assert.equal(patients.length, 3);
  assert.equal(archived?.archived, true);
  assert.equal(archived?.archiveReason, "Duplicate chart");
  assert.equal("allergies" in archived, false);
  assert.equal("medicalHistory" in archived, false);
});

test("reception cannot expand its scope with includeArchived", () => {
  const patients = projectPatientDirectory(
    documents,
    { uid: "reception-user", role: "reception" },
    { active: true },
    { includeArchived: true },
  );

  assert.deepEqual(patients.map((patient) => patient.id).sort(), ["patient-obg", "patient-ped"]);
});

test("doctor receives only charts assigned to that doctor", () => {
  const conflictingAssignment = {
    ...activeObgPatient,
    id: "patient-conflict",
    doctorId: "pediatrics",
  };
  const patients = projectPatientDirectory(
    [...documents, conflictingAssignment],
    { uid: "doctor-user", role: "doctor" },
    { active: true, doctorName: "Dr. Lt Col Shafi Ahamad" },
  );

  assert.deepEqual(patients.map((patient) => patient.id), ["patient-ped"]);
  assert.equal(patients[0].doctorName, "Dr. Lt Col Shafi Ahamad");
});

test("unlinked doctor cannot obtain a directory", () => {
  assert.throws(
    () => projectPatientDirectory(
      documents,
      { uid: "doctor-user", role: "doctor" },
      { active: true, doctorName: "" },
    ),
    /not linked/u,
  );
});

test("patient search index supports name words, canonical mobile, and patient number", () => {
  const prefixes = createPatientSearchPrefixes({
    patientNumber: "ASH-PED001",
    fullName: "Mrs Aarav Kumar",
    phone: "+91 90000 00001",
  });

  assert.equal(prefixes.includes("name:aar"), true);
  assert.equal(prefixes.includes("name:kumar"), true);
  assert.equal(prefixes.includes("tel:900000"), true);
  assert.equal(prefixes.includes("tel:9000000001"), true);
  assert.equal(prefixes.includes("id:ASH-PED"), true);
  assert.equal(prefixes.length <= 96, true);
});

test("patient search reserves index space for a later surname in long names", () => {
  const prefixes = createPatientSearchPrefixes({
    patientNumber: "ASH-20260813-EXTRAORDINARILYLONG",
    fullName: "Mrs Ananthapadmanabhan Venkatanarasimharaju Lakshminarayanaswamy Chandrasekhar",
    phone: "+91 90000 00001",
  });

  assert.equal(prefixes.includes("name:chandrasekhar"), true);
  assert.equal(prefixes.includes("name:chandras"), true);
  assert.equal(prefixes.length <= 96, true);
});

test("patient search selects a privacy-safe indexed token", () => {
  assert.equal(patientSearchToken("Kum"), "name:kum");
  assert.equal(patientSearchToken("900000"), "tel:900000");
  assert.equal(patientSearchToken("ash-ped"), "id:ASH-PED");
  assert.equal(patientSearchToken("ahc-0042"), "id:AHC-0042");
  assert.equal(patientSearchToken("Mary-Jane"), "name:mary jane");
  assert.equal(patientSearchToken("ab"), "");
});

test("patient search derives a canonical doctor scope with doctor name precedence", () => {
  assert.equal(patientSearchDoctorKey({ doctorId: "pediatrics" }), "pediatrics");
  assert.equal(patientSearchDoctorKey({ doctorName: "Dr. Shaik Reshma" }), "obg");
  assert.equal(patientSearchDoctorKey({
    doctorName: "Dr. Shaik Reshma",
    doctorId: "pediatrics",
  }), "obg");
  assert.equal(patientSearchDoctorKey({ doctorName: "Unknown" }), "");
});

test("legacy search matches normalized name words without returning address", () => {
  const matches = projectLegacyPatientSearch(
    [activePediatricPatient, activeObgPatient],
    { uid: "reception-1", role: "reception" },
    { active: true },
    "name:kumar",
    10,
  );

  assert.deepEqual(matches.map((patient) => patient.id), ["patient-ped"]);
  assert.equal("address" in matches[0], false);
  assert.equal("allergies" in matches[0], false);
  assert.equal("medicalHistory" in matches[0], false);
});

test("legacy archived search remains bounded to archived admin results", () => {
  const matches = projectLegacyPatientSearch(
    documents,
    { uid: "admin-1", role: "admin" },
    { active: true, role: "admin" },
    "name:arch",
    10,
    { archivedOnly: true },
  );

  assert.deepEqual(matches.map((patient) => patient.id), ["patient-archived"]);
  assert.equal(matches[0].archived, true);
  assert.equal(matches[0].archiveReason, "Duplicate chart");
});

test("patient search cursors are query-bound and reject tampering", () => {
  const cursor = encodePatientSearchCursor({
    queryKey: "name:aar|pediatrics",
    updatedAt: "2026-08-13T10:00:00.000Z",
    id: "patient-ped",
  });
  assert.deepEqual(decodePatientSearchCursor(cursor, "name:aar|pediatrics"), {
    updatedAt: "2026-08-13T10:00:00.000Z",
    id: "patient-ped",
  });
  assert.throws(() => decodePatientSearchCursor(cursor, "name:aar|obg"), /expired/u);
});

test("patient search query is bounded and indexed", () => {
  const query = patientSearchQuery(
    { FIREBASE_PROJECT_ID: "asher-test" },
    {
      token: "name:aar",
      pageSize: 10,
      cursor: {
        updatedAt: "2026-08-13T10:00:00.000Z",
        id: "patient-ped",
      },
      doctorKey: "pediatrics",
    },
  );
  assert.equal(query.limit, 11);
  assert.equal(query.where.compositeFilter.filters.some((entry) => (
    entry.fieldFilter.field.fieldPath === "searchPrefixes"
    && entry.fieldFilter.op === "ARRAY_CONTAINS"
  )), true);
  assert.equal(query.where.compositeFilter.filters.some((entry) => (
    entry.fieldFilter.field.fieldPath === "searchDoctorKey"
    && entry.fieldFilter.value.stringValue === "pediatrics"
  )), true);
  assert.equal(query.startAt.before, false);
  assert.match(query.startAt.values[1].referenceValue, /patients\/patient-ped$/u);
});

test("archived search uses the same bounded index with an archived predicate", () => {
  const query = patientSearchQuery(
    { FIREBASE_PROJECT_ID: "asher-test" },
    { token: "name:arch", pageSize: 10, archivedOnly: true },
  );
  const archivedFilter = query.where.compositeFilter.filters.find((entry) => (
    entry.fieldFilter.field.fieldPath === "archived"
  ));
  assert.equal(query.limit, 11);
  assert.equal(archivedFilter.fieldFilter.value.booleanValue, true);

  const results = projectPatientSearchResults(documents, { archivedOnly: true });
  assert.deepEqual(results.map((patient) => patient.id), ["patient-archived"]);
  assert.equal(results[0].archiveReason, "Duplicate chart");
  assert.equal("address" in results[0], false);
});

test("archived search scope is restricted to a currently active admin", () => {
  assert.deepEqual(
    patientSearchStaffScope(
      { uid: "admin-1", role: "reception" },
      { active: true, role: "admin" },
      { archivedOnly: true },
    ),
    { uid: "admin-1", role: "admin", doctorName: "" },
  );
  assert.throws(
    () => patientSearchStaffScope(
      { uid: "reception-1", role: "admin" },
      { active: true, role: "reception" },
      { archivedOnly: true },
    ),
    /Only clinic administrators/u,
  );
  assert.throws(
    () => patientSearchStaffScope(
      { uid: "admin-1", role: "admin" },
      { active: false, role: "admin" },
      { archivedOnly: true },
    ),
    /no longer active/u,
  );
});

test("patient search deployment declares both required composite indexes", () => {
  const config = JSON.parse(
    readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"),
  );
  const fieldPaths = (index) => index.fields.map((field) => field.fieldPath);
  const patientIndexes = config.indexes.filter((index) => (
    index.collectionGroup === "patients" && index.queryScope === "COLLECTION"
  ));

  assert.equal(patientIndexes.some((index) => (
    JSON.stringify(fieldPaths(index)) === JSON.stringify(["archived", "updatedAt"])
    && index.fields[0].order === "DESCENDING"
    && index.fields[1].order === "DESCENDING"
  )), true);

  assert.equal(patientIndexes.some((index) => (
    JSON.stringify(fieldPaths(index)) === JSON.stringify([
      "searchPrefixes",
      "archived",
      "updatedAt",
    ])
    && index.fields[0].arrayConfig === "CONTAINS"
    && index.fields[2].order === "DESCENDING"
  )), true);
  assert.equal(patientIndexes.some((index) => (
    JSON.stringify(fieldPaths(index)) === JSON.stringify([
      "searchPrefixes",
      "searchDoctorKey",
      "archived",
      "updatedAt",
    ])
    && index.fields[0].arrayConfig === "CONTAINS"
    && index.fields[3].order === "DESCENDING"
  )), true);
});

test("patient search projection enforces doctor scope and omits private fields", () => {
  const results = projectPatientSearchResults([
    { ...activePediatricPatient, searchPrefixes: ["name:aar"], updatedAt: "2026-08-13T10:00:00Z" },
    { ...activeObgPatient, searchPrefixes: ["name:mee"], updatedAt: "2026-08-13T09:00:00Z" },
  ], { doctorName: "Dr. Lt Col Shafi Ahamad" });

  assert.deepEqual(results.map((patient) => patient.id), ["patient-ped"]);
  assert.equal("address" in results[0], false);
  assert.equal("allergies" in results[0], false);
  assert.equal("medicalHistory" in results[0], false);
  assert.equal("searchPrefixes" in results[0], false);
  assert.equal("updatedAt" in results[0], false);
});

test("patient search backfill plans only missing or stale protected indexes", () => {
  const current = {
    patientNumber: "ASH-PED001",
    fullName: "Aarav Kumar",
    phone: "9000000001",
  };
  const expected = createPatientSearchPrefixes(current);
  const complete = {
    ...current,
    doctorId: "pediatrics",
    searchDoctorKey: "pediatrics",
    searchPrefixes: expected,
    archived: false,
    updatedAt: "2026-08-13T10:00:01Z",
  };
  const planned = planPatientSearchBackfill([
    { id: "missing", data: { ...current, doctorName: "Dr. Lt Col Shafi Ahamad" }, updateTime: "2026-08-13T10:00:00Z", updatedAtWasTimestamp: false },
    { id: "current", data: complete, updateTime: "2026-08-13T10:00:01Z", updatedAtWasTimestamp: true },
    { id: "stale", data: { ...complete, searchPrefixes: ["name:old"] }, updateTime: "2026-08-13T10:00:02Z", updatedAtWasTimestamp: true },
  ]);

  assert.deepEqual(planned.map((entry) => entry.id), ["missing", "stale"]);
  assert.deepEqual(planned[0].updates.searchPrefixes, expected);
  assert.equal(planned[0].updates.searchDoctorKey, "pediatrics");
  assert.equal(planned[0].updates.archived, false);
  assert.equal(planned[0].updates.updatedAt.toISOString(), "2026-08-13T10:00:00.000Z");
  assert.deepEqual(planned[1].fieldPaths, ["searchPrefixes"]);
});

test("patient search backfill binds every service-account batch to the current admin record", () => {
  const writes = patientSearchBackfillWrites(
    { FIREBASE_PROJECT_ID: "asher-test" },
    {
      uid: "admin-1",
      role: "admin",
      displayName: "Clinic Admin",
      staffUpdateTime: "2026-08-13T10:00:00.000Z",
    },
    [],
    {
      scannedCount: 0,
      complete: true,
      now: new Date("2026-08-13T10:01:00.000Z"),
      auditId: "audit-1",
    },
  );

  assert.deepEqual(writes[0], {
    verify: "projects/asher-test/databases/(default)/documents/staff/admin-1",
    currentDocument: { updateTime: "2026-08-13T10:00:00.000Z" },
  });
  assert.match(writes.at(-1).update.name, /auditLogs\/audit-1$/u);
});
