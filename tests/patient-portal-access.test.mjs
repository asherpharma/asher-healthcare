import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/razorpay/http.js";
import { claimPortalInvitation, enforcePortalQueryLimit, normalizePortalProvisionRequest, patientTokenAuthenticationTime, portalDashboard, projectGrantDashboard, provisionPortalAccount, resendPortalInvitation, PATIENT_PORTAL } from "../server/patients/portal-access.js";

const env = { FIREBASE_PROJECT_ID: "test", FIREBASE_WEB_API_KEY: "test" };
const updateTime = "2026-08-13T10:00:00.000000Z";
const doc = (data) => ({ data, updateTime });
function db(documents = {}) {
  const commits = [];
  return { commits, async getDocument(_e, path) { return documents[path] || null; }, verifyDocumentWrite(_e, path) { return { verify: path }; }, createDocumentWrite(_e, path, data) { return { create: path, data }; }, updateDocumentWrite(_e, path, data) { return { update: path, data }; }, async commitWrites(_e, writes) { commits.push(writes); } };
}
function body(overrides = {}) {
  return { displayName: "Patient Account", email: "patient@example.test", confirmEmail: "patient@example.test", accountEmailAttested: true, grants: [{ patientId: "patient-1", relationship: "self", consentRecordId: "FORM-1", consentMethod: "signed_form", evidenceType: "patient_authorization", consentAttested: true, scopes: ["profile", "appointments"] }], ...overrides };
}

test("account email requires exact re-entry and owner attestation", () => {
  assert.equal(normalizePortalProvisionRequest(body()).email, "patient@example.test");
  assert.throws(() => normalizePortalProvisionRequest(body({ confirmEmail: "wrong@example.test" })), HttpError);
  assert.throws(() => normalizePortalProvisionRequest(body({ accountEmailAttested: false })), HttpError);
});

test("consent filing reference rejects free text that could contain PHI", async () => {
  const database = db({ "staff/admin-1": doc({ active: true, role: "admin" }), "patients/patient-1": doc({ dateOfBirth: "1990-01-01" }) });
  const grant = { ...body().grants[0], consentRecordId: "Patient name and diagnosis" };
  await assert.rejects(provisionPortalAccount(env, body({ grants: [grant] }), { uid: "admin-1" }, database, { async findAuthUserByEmail() { assert.fail(); } }), (error) => error instanceof HttpError && error.status === 400);
});

test("existing Firebase identities, including staff identities, are rejected", async () => {
  const database = db({ "staff/admin-1": doc({ active: true, role: "admin" }), "patients/patient-1": doc({ dateOfBirth: "1990-01-01" }) });
  const auth = { async findAuthUserByEmail() { return { uid: "staff-1" }; }, createRandomPassword() { return "unused"; }, async createAuthUser() { assert.fail(); }, async deleteAuthUser() {}, async sendPasswordResetEmail() {} };
  await assert.rejects(provisionPortalAccount(env, body(), { uid: "admin-1" }, database, auth), (error) => error instanceof HttpError && error.status === 409);
  assert.equal(database.commits.length, 0);
});

test("provisioning stores immutable consent with the exact granted scopes and account identity", async () => {
  const database = db({ "staff/admin-1": doc({ active: true, role: "admin" }), "patients/patient-1": doc({ fullName: "Patient", dateOfBirth: "1990-01-01" }) });
  const auth = { async findAuthUserByEmail() { return null; }, createRandomPassword() { return "strong-random"; }, async createAuthUser() { return { localId: "account-1" }; }, async deleteAuthUser() {}, async sendPasswordResetEmail() {} };
  await provisionPortalAccount(env, body(), { uid: "admin-1" }, database, auth);
  const writes = database.commits[0];
  const consent = writes.find((write) => String(write.create || "").startsWith("patientAccessConsents/"));
  const nested = writes.find((write) => String(write.create || "").startsWith("patientAccounts/account-1/grants/"));
  const reverse = writes.find((write) => String(write.create || "").startsWith("patientAccessGrants/"));
  assert.deepEqual(consent.data.scopes, ["appointments", "profile"]);
  assert.deepEqual(consent.data.scopes, [...nested.data.scopes].sort());
  assert.deepEqual(consent.data.scopes, [...reverse.data.scopes].sort());
  assert.equal(consent.data.scopeSemanticsVersion, "1.0");
  assert.equal(consent.data.accountHolderEmail, "patient@example.test");
  assert.equal(consent.data.reviewAt, nested.data.reviewAt);
  assert.equal(consent.data.expiresAt, nested.data.expiresAt);
});

test("family portal caps linked patients for bounded server requests", () => {
  assert.equal(PATIENT_PORTAL.maxGrantsPerAccount, 5);
  assert.throws(() => normalizePortalProvisionRequest(body({ grants: Array.from({ length: 6 }, (_, index) => ({ ...body().grants[0], patientId: `patient-${index}` })) })), (error) => error instanceof HttpError && error.status === 400);
});

test("history over 50 records fails closed", () => {
  assert.equal(enforcePortalQueryLimit(Array.from({ length: 50 }), 50).length, 50);
  assert.throws(() => enforcePortalQueryLimit(Array.from({ length: 51 }), 50), (error) => error instanceof HttpError && error.status === 503);
});

test("parent access is reviewed annually", async () => {
  const database = db({ "staff/admin-1": doc({ active: true, role: "admin" }), "patients/patient-1": doc({ fullName: "Child", dateOfBirth: "2020-01-01" }) });
  const auth = { async findAuthUserByEmail() { return null; }, createRandomPassword() { return "strong-random"; }, async createAuthUser() { return { localId: "account-1" }; }, async deleteAuthUser() {}, async sendPasswordResetEmail() {} };
  await provisionPortalAccount(env, body({ grants: [{ ...body().grants[0], relationship: "parent", evidenceType: "parent_attestation" }] }), { uid: "admin-1" }, database, auth);
  const nested = database.commits[0].find((write) => String(write.create || "").startsWith("patientAccounts/account-1/grants/"));
  assert.ok(new Date(nested.data.reviewAt).getTime() <= Date.now() + 366 * 24 * 60 * 60 * 1000);
  assert.equal(nested.data.reviewPolicy, "annual_or_adulthood_whichever_is_earlier-v1");
});

test("active account password recovery is admin-attested, atomic, audited, and cooldown-bound", async () => {
  const database = db({ "staff/admin-1": doc({ active: true, role: "admin" }), "patientAccounts/account-1": doc({ email: "patient@example.test", status: "active" }) });
  let sent = false;
  await assert.rejects(resendPortalInvitation(env, { accountUid: "account-1" }, { uid: "admin-1" }, database, { async sendPasswordResetEmail() {} }), (error) => error instanceof HttpError && error.status === 400);
  await assert.rejects(resendPortalInvitation(env, { accountUid: "account-1", identityAttested: true, identityVerificationMethod: "registered_phone", identityVerificationReference: "Patient name and ID number" }, { uid: "admin-1" }, database, { async sendPasswordResetEmail() {} }), (error) => error instanceof HttpError && error.status === 400);
  await resendPortalInvitation(env, { accountUid: "account-1", identityAttested: true, identityVerificationMethod: "registered_phone", identityVerificationReference: "CALL-1" }, { uid: "admin-1" }, database, { async sendPasswordResetEmail() { sent = true; } });
  assert.equal(sent, true);
  assert.equal(database.commits[0].at(-1).data.eventType, "patient_portal.password_reset_authorized");
});

test("unknown DOB and contradictory relationship evidence fail before creating identity", async () => {
  const auth = { async findAuthUserByEmail() { assert.fail("validation must precede identity lookup"); } };
  for (const [patient, grant] of [
    [{ dateOfBirth: "" }, { relationship: "adult_proxy" }],
    [{ dateOfBirth: "1990-01-01" }, { relationship: "adult_proxy", evidenceType: "parent_attestation" }],
    [{ dateOfBirth: "2015-01-01" }, { relationship: "guardian", evidenceType: "guardianship_document", consentMethod: "signed_form" }],
    [{ dateOfBirth: "2015-01-01" }, { relationship: "self" }],
  ]) {
    const database = db({ "staff/admin-1": doc({ active: true, role: "admin" }), "patients/patient-1": doc(patient) });
    const nextGrant = { ...body().grants[0], ...grant };
    await assert.rejects(provisionPortalAccount(env, body({ grants: [nextGrant] }), { uid: "admin-1" }, database, auth), (error) => error instanceof HttpError && error.status === 400);
  }
});

test("claim atomically activates the exact pending nested and reverse grant", async () => {
  const database = db({ "patientAccounts/account-1": doc({ uid: "account-1", email: "patient@example.test", status: "pending" }), "patientAccessGrants/grant-1": doc({ accountUid: "account-1", patientId: "patient-1", status: "pending" }) });
  const list = async () => [{ id: "grant-1", data: { patientId: "patient-1", status: "pending", scopes: ["profile"] }, updateTime }];
  const result = await claimPortalInvitation(env, { uid: "account-1", email: "patient@example.test", authenticationTime: Date.now() }, database, list);
  assert.equal(result.active, true);
  assert.deepEqual(database.commits[0].slice(0, 3).map((write) => write.update), ["patientAccounts/account-1", "patientAccounts/account-1/grants/grant-1", "patientAccessGrants/grant-1"]);
});

test("claim rejects stale, revoked, expired, and patient-B reverse grants", async () => {
  for (const item of [
    { auth: Date.now() - 11 * 60_000 },
    { nested: { status: "revoked" } },
    { nested: { expiresAt: "2020-01-01T00:00:00Z" } },
    { reverse: { patientId: "patient-B" } },
  ]) {
    const nested = { patientId: "patient-A", status: "pending", scopes: ["profile"], ...item.nested };
    const reverse = { accountUid: "account-1", patientId: "patient-A", status: "pending", ...item.reverse };
    const database = db({ "patientAccounts/account-1": doc({ uid: "account-1", email: "patient@example.test", status: "pending" }), "patientAccessGrants/grant-1": doc(reverse) });
    await assert.rejects(claimPortalInvitation(env, { uid: "account-1", email: "patient@example.test", authenticationTime: item.auth || Date.now() }, database, async () => [{ id: "grant-1", data: nested, updateTime }]), (error) => error instanceof HttpError && error.status === 403);
    assert.equal(database.commits.length, 0);
  }
});

test("profile-less projection redacts demographics and exposes summaries only", async () => {
  const database = db({ "patients/patient-1": doc({ fullName: "Child", phone: "9999999999", dateOfBirth: "2020-01-01", gender: "Female", doctorName: "Doctor" }) });
  const grant = { id: "grant-1", data: { patientId: "patient-1", relationship: "parent", scopes: ["prescriptions", "reports", "billing"] } };
  const query = async (_e, options) => options.collectionId === "prescriptions" ? [{ id: "rx-1", data: { medicines: [{ name: "Secret" }] } }] : options.collectionId === "reports" ? [{ id: "report-1", data: { fileName: "patient-name.pdf", category: "Lab" } }] : [{ id: "invoice-1", data: { notes: "Internal" } }];
  const projected = await projectGrantDashboard(env, grant, database, query);
  assert.deepEqual([projected.patient.phone, projected.patient.dateOfBirth, projected.patient.gender, projected.patient.doctorName], ["", "", "", ""]);
  assert.equal("medicines" in projected.prescriptions[0], false);
  assert.equal("fileName" in projected.reports[0], false);
  assert.equal("notes" in projected.invoices[0], false);
  assert.equal(projected.patient.patientNumber, "");
});

test("recent-auth gates use the signed token auth_time and reject UID mismatch", () => {
  const payload = Buffer.from(JSON.stringify({ sub: "account-1", auth_time: 1_786_600_000 })).toString("base64url");
  assert.equal(patientTokenAuthenticationTime(`header.${payload}.signature`, "account-1"), 1_786_600_000_000);
  assert.throws(() => patientTokenAuthenticationTime(`header.${payload}.signature`, "account-2"), (error) => error instanceof HttpError && error.status === 401);
});

test("dashboard fails closed before audit when aggregate record verification exceeds its atomic limit", async () => {
  const database = db();
  const grants = [{ id: "grant-1", data: { patientId: "patient-1", status: "active", scopes: ["profile", "appointments"] }, updateTime }];
  const recordVersions = Array.from({ length: 448 }, (_, index) => ({ path: `appointments/appointment-${index}`, updateTime }));
  await assert.rejects(portalDashboard({}, { uid: "account-1", updateTime, displayName: "Family" }, {
    database,
    list: async () => grants,
    project: async () => ({
      _patientUpdateTime: updateTime,
      _recordVersions: recordVersions,
      grant: { id: "grant-1", scopes: ["appointments"] },
      patient: { id: "patient-1", fullName: "Patient" },
      appointments: [], prescriptions: [], reports: [], invoices: [],
    }),
  }), (error) => error instanceof HttpError && error.status === 503);
  assert.equal(database.commits.length, 0);
});

test("dashboard rejects a queried row with no immutable update version", async () => {
  const database = db();
  const grants = [{ id: "grant-1", data: { patientId: "patient-1", status: "active", scopes: ["profile", "appointments"] }, updateTime }];
  await assert.rejects(portalDashboard({}, { uid: "account-1", updateTime, displayName: "Family" }, {
    database,
    list: async () => grants,
    project: async () => ({
      _patientUpdateTime: updateTime,
      _recordVersions: [{ path: "appointments/changed", updateTime: "" }],
      grant: { id: "grant-1", scopes: ["appointments"] },
      patient: { id: "patient-1", fullName: "Patient" },
      appointments: [], prescriptions: [], reports: [], invoices: [],
    }),
  }), (error) => error instanceof HttpError && error.status === 503);
  assert.equal(database.commits.length, 0);
});

test("dashboard omits legacy active grants missing required basic identity scope", async () => {
  const database = db();
  const result = await portalDashboard({}, { uid: "account-1", updateTime, displayName: "Family" }, {
    database,
    list: async () => [{ id: "grant-1", data: { patientId: "patient-1", status: "active", scopes: ["reports"] }, updateTime }],
    project: async () => assert.fail("malformed grant must not be projected"),
  });
  assert.deepEqual(result.family, []);
});
