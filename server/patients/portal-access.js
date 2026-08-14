import {
  commitWrites,
  createAuthUser,
  createDocumentWrite,
  createRandomPassword,
  deleteAuthUser,
  getDocument,
  sendPasswordResetEmail,
  serviceAccountAccessToken,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError, requireEnvironment } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";

const PORTAL_CONTINUE_URL = "https://asherhealthcare.in/portal/login?welcome=1";
const ACCOUNT_STATUSES = new Set(["pending", "active", "revoked"]);
const GRANT_STATUSES = new Set(["pending", "active", "revoked"]);
const RELATIONSHIPS = new Set(["self", "parent", "guardian", "adult_proxy"]);
const SCOPES = new Set(["profile", "appointments", "prescriptions", "reports", "billing"]);
const DEFAULT_SCOPES = Object.freeze([...SCOPES]);
const MAX_GRANTS_PER_ACCOUNT = 5;
const MAX_ACCOUNTS = 200;
const MAX_DASHBOARD_VERIFY_WRITES = 450;
const CONSENT_ATTESTATION = Object.freeze({
  id: "asher-portal-grant-verification-v1",
  version: "1.0",
  text: "I verified this exact patient, relationship, permission scope and clinic-held authorization evidence before granting portal access.",
});
const REVERIFICATION_ATTESTATION = Object.freeze({
  id: "asher-portal-grant-reverification-v1",
  version: "1.0",
  text: "I re-verified the account holder's identity, this exact patient relationship, permission scope and new clinic-held authorization evidence before renewing portal access.",
});
const IDENTITY_VERIFICATION_METHODS = new Set(["in_person", "registered_phone", "photo_id"]);
const REVERIFICATION_REASONS = new Set([
  "scheduled_review",
  "expired_access",
  "relationship_change",
  "scope_change",
  "identity_update",
]);
const REVIEW_WARNING_DAYS = 30;

const DEFAULT_DATABASE = {
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
};

export async function findAuthUserByEmail(env, email) {
  requireEnvironment(env, ["FIREBASE_PROJECT_ID", "FIREBASE_WEB_API_KEY"]);
  const accessToken = await serviceAccountAccessToken(env);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: [email] }),
    },
  );
  const result = await response.json();
  if (!response.ok) {
    console.error("Patient portal auth lookup failed", response.status, result?.error?.message);
    throw new HttpError(503, "The secure family sign-in service is temporarily unavailable.");
  }
  const user = result.users?.[0];
  return validDocumentId(user?.localId)
    ? { uid: user.localId, email: canonicalEmail(user.email || email) }
    : null;
}

function cleanText(value, maximum = 200) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().replace(/\s+/gu, " ").slice(0, maximum)
    : "";
}

function canonicalEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new HttpError(400, "Enter a valid family account email address.");
  }
  return email;
}

function timestampText(value) {
  if (value instanceof Date) return value.toISOString();
  return cleanText(value, 40);
}

function futureTimestamp(value, now) {
  const text = timestampText(value);
  if (!text) return true;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && parsed > now.getTime();
}

function requiredUpdateTime(value) {
  const updateTime = cleanText(value, 100);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(updateTime)
    || !Number.isFinite(Date.parse(updateTime))
  ) {
    throw new HttpError(400, "Refresh the family access list before renewing this permission.");
  }
  return updateTime;
}

function referenceCode(value, message) {
  const reference = cleanText(value, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$/u.test(reference)) {
    throw new HttpError(400, message);
  }
  return reference;
}

function parsedDeadline(value) {
  const text = timestampText(value);
  if (!text) return { text: "", time: null, valid: true };
  const time = Date.parse(text);
  return { text, time: Number.isFinite(time) ? time : null, valid: Number.isFinite(time) };
}

export function portalGrantLifecycle(grant = {}, now = new Date()) {
  const status = cleanText(grant?.status, 20);
  if (status === "revoked") return { state: "revoked", nextActionAt: "", daysUntilAction: null };

  const review = parsedDeadline(grant?.reviewAt);
  const expiry = parsedDeadline(grant?.expiresAt);
  if (!review.valid || !expiry.valid) {
    return { state: "review_due", nextActionAt: "", daysUntilAction: 0 };
  }

  const nowTime = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowTime)) throw new HttpError(500, "A portal review date could not be evaluated safely.");
  if (expiry.time !== null && expiry.time <= nowTime) {
    return { state: "expired", nextActionAt: expiry.text, daysUntilAction: 0 };
  }
  if (review.time !== null && review.time <= nowTime) {
    return { state: "review_due", nextActionAt: review.text, daysUntilAction: 0 };
  }

  const deadlines = [
    ...(review.time === null ? [] : [{ kind: "review", text: review.text, time: review.time }]),
    ...(expiry.time === null ? [] : [{ kind: "expiry", text: expiry.text, time: expiry.time }]),
  ].sort((left, right) => left.time - right.time);
  const next = deadlines[0];
  if (next) {
    const daysUntilAction = Math.max(0, Math.ceil((next.time - nowTime) / (24 * 60 * 60 * 1000)));
    if (daysUntilAction <= REVIEW_WARNING_DAYS) {
      return {
        state: next.kind === "expiry" ? "expiring_soon" : "review_soon",
        nextActionAt: next.text,
        daysUntilAction,
      };
    }
    return { state: status === "pending" ? "pending" : "current", nextActionAt: next.text, daysUntilAction };
  }
  return { state: status === "pending" ? "pending" : "current", nextActionAt: "", daysUntilAction: null };
}

function strictScopes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > SCOPES.size) {
    throw new HttpError(400, "Choose valid patient portal permissions.");
  }
  const result = [...new Set(value.map((scope) => cleanText(scope, 40)))];
  if (result.some((scope) => !SCOPES.has(scope))) {
    throw new HttpError(400, "Choose valid patient portal permissions.");
  }
  if (!result.includes("profile")) {
    throw new HttpError(400, "Basic patient identity permission is required for every family portal grant.");
  }
  return result;
}

function samePortalScopes(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const leftScopes = [...new Set(left.map((scope) => cleanText(scope, 40)))].sort();
  const rightScopes = [...new Set(right.map((scope) => cleanText(scope, 40)))].sort();
  return leftScopes.length === left.length
    && rightScopes.length === right.length
    && leftScopes.every((scope) => SCOPES.has(scope))
    && rightScopes.every((scope) => SCOPES.has(scope))
    && leftScopes.length === rightScopes.length
    && leftScopes.every((scope, index) => scope === rightScopes[index]);
}

function patientAgeOn(dateOfBirth, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateOfBirth)) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime()) || dob > now) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < dob.getUTCMonth()
    || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function adulthoodReviewAt(dateOfBirth) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateOfBirth)) return null;
  const review = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(review.getTime())) return null;
  review.setUTCFullYear(review.getUTCFullYear() + 18);
  return review;
}

function validateGrantRequest(input, patient, now) {
  const patientId = cleanText(input?.patientId, 128);
  if (!validDocumentId(patientId)) throw new HttpError(400, "Choose a valid patient record.");
  const relationship = cleanText(input?.relationship, 30);
  if (!RELATIONSHIPS.has(relationship)) throw new HttpError(400, "Choose a valid family relationship.");
  const consentRecordId = cleanText(input?.consentRecordId, 100);
  const consentMethod = cleanText(input?.consentMethod, 30);
  const evidenceType = cleanText(input?.evidenceType, 40);
  if (
    input?.consentAttested !== true
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$/u.test(consentRecordId)
    || !["signed_form", "in_person", "verified_guardianship"].includes(consentMethod)
    || !["patient_authorization", "parent_attestation", "guardianship_document"].includes(evidenceType)
  ) {
    throw new HttpError(400, "Record the clinic consent or guardianship reference for every linked patient.");
  }
  const requiredEvidence = relationship === "parent"
    ? "parent_attestation"
    : relationship === "guardian"
      ? "guardianship_document"
      : "patient_authorization";
  const methodAllowed = relationship === "guardian"
    ? consentMethod === "verified_guardianship"
    : consentMethod === "signed_form" || consentMethod === "in_person";
  if (evidenceType !== requiredEvidence || !methodAllowed) {
    throw new HttpError(400, "The authorization evidence does not match the selected family relationship.");
  }
  const age = patientAgeOn(cleanText(patient.dateOfBirth, 10), now);
  let authorizationBasis = "self";
  let reviewAt = null;
  let expiresAt = null;
  if (relationship === "parent" || relationship === "guardian") {
    if (age === null || age >= 18) {
      throw new HttpError(400, "Adult family access requires explicit adult proxy authorization.");
    }
    authorizationBasis = relationship === "parent" ? "minor_parent" : "legal_guardian";
    const adulthood = adulthoodReviewAt(patient.dateOfBirth);
    const annualReview = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    reviewAt = adulthood && adulthood < annualReview ? adulthood : annualReview;
  } else if (relationship === "adult_proxy") {
    if (age === null) {
      throw new HttpError(400, "Confirm the adult patient's date of birth before granting proxy access.");
    }
    if (age < 18) {
      throw new HttpError(400, "Use parent or guardian access for a minor patient.");
    }
    authorizationBasis = "adult_proxy";
    expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  } else if (age === null || age < 18) {
    throw new HttpError(400, "Use verified parent or guardian access for a patient under 18.");
  }
  return {
    patientId,
    relationship,
    authorizationBasis,
    scopes: strictScopes(input?.scopes || DEFAULT_SCOPES),
    consentEvidence: {
      recordId: consentRecordId,
      version: "asher-portal-consent-v1",
      subject: relationship === "self" ? "patient" : relationship,
      method: consentMethod,
      evidenceType,
      staffAttested: true,
      attestationId: CONSENT_ATTESTATION.id,
      attestationVersion: CONSENT_ATTESTATION.version,
      attestationText: CONSENT_ATTESTATION.text,
      capturedAt: now,
    },
    reviewAt,
    expiresAt,
    reviewPolicy: relationship === "parent" || relationship === "guardian"
      ? "annual_or_adulthood_whichever_is_earlier-v1"
      : relationship === "adult_proxy" ? "annual_expiry-v1" : "clinic_revocation-v1",
  };
}

function currentAdministrator(authenticatedAdministrator, document) {
  if (
    !authenticatedAdministrator
    || !validDocumentId(authenticatedAdministrator.uid)
    || !document
    || document.data.active !== true
    || document.data.role !== "admin"
  ) {
    throw new HttpError(403, "Only an active clinic administrator can manage family access.");
  }
  return { uid: authenticatedAdministrator.uid, role: "admin" };
}

export function normalizePortalProvisionRequest(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Enter valid family portal access details.");
  }
  const displayName = cleanText(body.displayName, 100);
  if (displayName.length < 2) throw new HttpError(400, "Enter the family account holder's name.");
  if (!Array.isArray(body.grants) || body.grants.length < 1 || body.grants.length > MAX_GRANTS_PER_ACCOUNT) {
    throw new HttpError(400, `Link between 1 and ${MAX_GRANTS_PER_ACCOUNT} patient records.`);
  }
  const ids = body.grants.map((grant) => cleanText(grant?.patientId, 128));
  if (new Set(ids).size !== ids.length) throw new HttpError(400, "Each patient can be linked only once.");
  const email = canonicalEmail(body.email);
  if (canonicalEmail(body.confirmEmail) !== email || body.accountEmailAttested !== true) {
    throw new HttpError(400, "Re-enter and verify the authorized account holder's email address.");
  }
  return { displayName, email, grants: body.grants };
}

export async function provisionPortalAccount(
  env,
  body,
  authenticatedAdministrator,
  database = DEFAULT_DATABASE,
  auth = {
    createAuthUser,
    createRandomPassword,
    deleteAuthUser,
    findAuthUserByEmail,
    sendPasswordResetEmail,
  },
) {
  const input = normalizePortalProvisionRequest(body);
  const administratorPath = `staff/${authenticatedAdministrator?.uid || "invalid"}`;
  const administratorDocument = validDocumentId(authenticatedAdministrator?.uid)
    ? await database.getDocument(env, administratorPath)
    : null;
  const administrator = currentAdministrator(authenticatedAdministrator, administratorDocument);
  const patientDocuments = await Promise.all(input.grants.map(async (grant) => {
    const patientId = cleanText(grant?.patientId, 128);
    if (!validDocumentId(patientId)) throw new HttpError(400, "Choose a valid patient record.");
    const patient = await database.getDocument(env, `patients/${patientId}`);
    if (!patient || patient.data.archived === true) {
      throw new HttpError(400, "One selected patient record is unavailable for new portal access.");
    }
    return { patientId, patient };
  }));
  const now = new Date();
  const grants = patientDocuments.map(({ patientId, patient }, index) => ({
    grantId: crypto.randomUUID().replaceAll("-", ""),
    consentId: crypto.randomUUID().replaceAll("-", ""),
    patient,
    ...validateGrantRequest({ ...input.grants[index], patientId }, patient.data, now),
  }));

  let createdUid = "";
  try {
    const existingUser = await auth.findAuthUserByEmail(env, input.email);
    if (existingUser) {
      throw new HttpError(409, "This email already has an Asher sign-in. Use a different email for the family portal so staff and patient sessions remain separate.");
    }
    const user = await auth.createAuthUser(env, {
      displayName: input.displayName,
      email: input.email,
      password: auth.createRandomPassword(),
    });
    createdUid = cleanText(user?.localId, 128);
    if (!validDocumentId(createdUid)) throw new HttpError(503, "The family sign-in account could not be prepared.");
    const existingAccount = await database.getDocument(env, `patientAccounts/${createdUid}`);
    if (existingAccount) {
      throw new HttpError(409, "This email already has a family portal account. Revoke or update its existing access instead.");
    }
    await auth.sendPasswordResetEmail(env, input.email, PORTAL_CONTINUE_URL);

    const writes = [
      database.verifyDocumentWrite(env, administratorPath, administratorDocument.updateTime),
      ...patientDocuments.map(({ patientId, patient }) => (
        database.verifyDocumentWrite(env, `patients/${patientId}`, patient.updateTime)
      )),
      database.createDocumentWrite(env, `patientAccounts/${createdUid}`, {
        uid: createdUid,
        email: input.email,
        displayName: input.displayName,
        status: "pending",
        inviteStatus: "pending",
        signInMethod: "set_password_invitation",
        invitedBy: administrator.uid,
        accountEmailVerifiedBy: administrator.uid,
        accountEmailVerifiedAt: now,
        accountEmailVerificationMethod: "staff_reentry_and_attestation",
        accessSemanticsVersion: "current_and_future_records_until_expiry_or_revocation-v1",
        invitedAt: now,
        claimedAt: null,
        revokedAt: null,
        revokedBy: "",
        createdAt: now,
        updatedAt: now,
      }),
      ...grants.map((grant) => database.createDocumentWrite(
        env,
        `patientAccounts/${createdUid}/grants/${grant.grantId}`,
        {
          grantId: grant.grantId,
          patientId: grant.patientId,
          relationship: grant.relationship,
          authorizationBasis: grant.authorizationBasis,
          scopes: grant.scopes,
          scopeSemantics: "current_and_future_records_until_expiry_or_revocation",
          scopeSemanticsVersion: "1.0",
          status: "pending",
          verifiedBy: administrator.uid,
          verifiedAt: now,
          consentRecordId: grant.consentId,
          reviewAt: grant.reviewAt,
          reviewPolicy: grant.reviewPolicy,
          expiresAt: grant.expiresAt,
          activatedAt: null,
          revokedAt: null,
          revokedBy: "",
          createdAt: now,
          updatedAt: now,
        },
      )),
      ...grants.flatMap((grant) => [
        database.createDocumentWrite(env, `patientAccessGrants/${grant.grantId}`, {
          grantId: grant.grantId,
          accountUid: createdUid,
          patientId: grant.patientId,
          relationship: grant.relationship,
          authorizationBasis: grant.authorizationBasis,
          scopes: grant.scopes,
          scopeSemantics: "current_and_future_records_until_expiry_or_revocation",
          scopeSemanticsVersion: "1.0",
          status: "pending",
          verifiedBy: administrator.uid,
          verifiedAt: now,
          consentRecordId: grant.consentId,
          reviewAt: grant.reviewAt,
          reviewPolicy: grant.reviewPolicy,
          expiresAt: grant.expiresAt,
          activatedAt: null,
          revokedAt: null,
          revokedBy: "",
          createdAt: now,
          updatedAt: now,
        }),
        database.createDocumentWrite(env, `patientAccessConsents/${grant.consentId}`, {
          consentRecordId: grant.consentId,
          clinicReference: grant.consentEvidence.recordId,
          version: grant.consentEvidence.version,
          accountUid: createdUid,
          patientId: grant.patientId,
          grantId: grant.grantId,
          relationship: grant.relationship,
          authorizationBasis: grant.authorizationBasis,
          accountHolderName: input.displayName,
          accountHolderEmail: input.email,
          scopes: [...grant.scopes].sort(),
          scopeSemantics: "current_and_future_records_until_expiry_or_revocation",
          scopeSemanticsVersion: "1.0",
          subject: grant.consentEvidence.subject,
          reviewAt: grant.reviewAt,
          expiresAt: grant.expiresAt,
          method: grant.consentEvidence.method,
          evidenceType: grant.consentEvidence.evidenceType,
          reviewPolicy: grant.reviewPolicy,
          staffAttested: grant.consentEvidence.staffAttested,
          attestationId: grant.consentEvidence.attestationId,
          attestationVersion: grant.consentEvidence.attestationVersion,
          attestationText: grant.consentEvidence.attestationText,
          verifiedBy: administrator.uid,
          verifiedAt: now,
          createdAt: now,
        }),
      ]),
      database.createDocumentWrite(env, `patientAccessAudit/${crypto.randomUUID()}`, {
        eventType: "patient_portal.account_invited",
        category: "patient_access",
        actorUid: administrator.uid,
        actorRole: administrator.role,
        accountUid: createdUid,
        grantCount: grants.length,
        accountEmailVerified: true,
        accountEmailVerificationMethod: "staff_reentry_and_attestation",
        createdAt: now,
      }),
    ];
    await database.commitWrites(env, writes);
    return {
      uid: createdUid,
      displayName: input.displayName,
      email: input.email,
      status: "pending",
      signInMethod: "set_password_invitation",
      grants: grants.map((grant) => ({
        grantId: grant.grantId,
        patientId: grant.patientId,
        patientName: cleanText(grant.patient.data.fullName, 100) || "Patient",
        relationship: grant.relationship,
        status: "pending",
      })),
    };
  } catch (error) {
    if (createdUid) {
      try { await auth.deleteAuthUser(env, createdUid); } catch (rollbackError) {
        console.error("Could not roll back incomplete family account", rollbackError);
      }
    }
    throw error;
  }
}

function decodeValue(value = {}) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return undefined;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function pathUrl(env, path) {
  const encoded = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/${encoded}`;
}

async function authorizedFetch(env, url, options = {}) {
  const accessToken = await serviceAccountAccessToken(env);
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const result = await response.json();
  if (!response.ok) {
    console.error("Patient portal Firestore request failed", response.status, result?.error?.status);
    throw new HttpError(503, "The secure patient portal is temporarily unavailable.");
  }
  return result;
}

async function listDocuments(env, collectionPath, maximum = 100) {
  const url = new URL(pathUrl(env, collectionPath));
  url.searchParams.set("pageSize", String(Math.min(maximum + 1, 1000)));
  const result = await authorizedFetch(env, url);
  const documents = (result.documents || []).map((document) => ({
    id: decodeURIComponent(document.name.split("/").at(-1) || ""),
    data: decodeFields(document.fields || {}),
    updateTime: document.updateTime,
  }));
  if (documents.length > maximum || result.nextPageToken) {
    throw new HttpError(503, "This family account has more linked records than can be opened safely.");
  }
  return documents;
}

async function runQuery(env, { collectionId, parentPath = "", whereField = "", whereValue = "", fields = [], limit = 50 }) {
  const base = parentPath ? `${pathUrl(env, parentPath)}:runQuery` : `${pathUrl(env, "").replace(/\/$/u, "")}:runQuery`;
  const structuredQuery = {
    from: [{ collectionId }],
    ...(whereField ? {
      where: { fieldFilter: { field: { fieldPath: whereField }, op: "EQUAL", value: { stringValue: whereValue } } },
    } : {}),
    ...(fields.length ? { select: { fields: fields.map((fieldPath) => ({ fieldPath })) } } : {}),
    limit: limit + 1,
  };
  const rows = await authorizedFetch(env, base, { method: "POST", body: JSON.stringify({ structuredQuery }) });
  if (!Array.isArray(rows)) throw new HttpError(503, "The secure patient portal is temporarily unavailable.");
  const documents = rows.flatMap((row) => row?.document?.name ? [{
    id: decodeURIComponent(row.document.name.split("/").at(-1) || ""),
    data: decodeFields(row.document.fields || {}),
    updateTime: row.document.updateTime,
  }] : []);
  return enforcePortalQueryLimit(documents, limit);
}

export function enforcePortalQueryLimit(documents, limit = 50) {
  if (!Array.isArray(documents) || documents.length > limit) {
    throw new HttpError(503, "This patient has more historical records than can be opened safely at once. Please contact the clinic.");
  }
  return documents;
}

export async function verifyPatientFirebaseUser(request, env) {
  requireEnvironment(env, ["FIREBASE_WEB_API_KEY"]);
  const authorization = request.headers.get("Authorization") || "";
  const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!idToken) throw new HttpError(401, "Sign in to the patient portal to continue.");
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) },
  );
  const result = await response.json();
  const user = result.users?.[0];
  if (!response.ok || !validDocumentId(user?.localId) || !user?.email || user.disabled === true) {
    throw new HttpError(401, "Your patient portal session has expired. Sign in again.");
  }
  const authenticationTime = patientTokenAuthenticationTime(idToken, user.localId);
  return {
    uid: user.localId,
    email: canonicalEmail(user.email),
    displayName: cleanText(user.displayName, 100),
    authenticationTime: Number.isFinite(authenticationTime) ? authenticationTime : 0,
  };
}

export function patientTokenAuthenticationTime(idToken, expectedUid) {
  try {
    const encodedPayload = String(idToken).split(".")[1] || "";
    const normalized = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    const tokenUid = cleanText(payload.sub || payload.user_id, 128);
    const authenticationTime = Number(payload.auth_time) * 1000;
    if (tokenUid !== expectedUid || !Number.isFinite(authenticationTime) || authenticationTime <= 0) throw new Error("invalid token claims");
    return authenticationTime;
  } catch {
    throw new HttpError(401, "Your patient portal session has expired. Sign in again.");
  }
}

function matchingAccount(user, accountDocument, { allowPending = false } = {}) {
  const status = cleanText(accountDocument?.data?.status, 20);
  if (
    !accountDocument
    || canonicalEmail(accountDocument.data.email) !== user.email
    || !ACCOUNT_STATUSES.has(status)
    || (allowPending ? !["pending", "active"].includes(status) : status !== "active")
  ) {
    throw new HttpError(403, "This patient portal account is not active. Please contact the clinic.");
  }
  return {
    uid: user.uid,
    email: user.email,
    displayName: cleanText(accountDocument.data.displayName, 100) || user.displayName || "Family account",
    status,
    updateTime: accountDocument.updateTime,
    authenticationTime: Number(user.authenticationTime || 0),
  };
}

export async function requireActivePatient(request, env, database = DEFAULT_DATABASE) {
  const user = await verifyPatientFirebaseUser(request, env);
  if (!Number.isFinite(user.authenticationTime) || Date.now() - user.authenticationTime > 12 * 60 * 60 * 1000) {
    throw new HttpError(401, "Your patient portal session has expired. Sign in again.");
  }
  const accountDocument = await database.getDocument(env, `patientAccounts/${user.uid}`);
  return matchingAccount(user, accountDocument);
}

export async function claimPortalInvitation(env, authenticatedUser, database = DEFAULT_DATABASE, list = listDocuments) {
  const accountPath = `patientAccounts/${authenticatedUser.uid}`;
  const accountDocument = await database.getDocument(env, accountPath);
  const account = matchingAccount(authenticatedUser, accountDocument, { allowPending: true });
  if (account.status === "active") return { claimed: false, active: true };
  const grants = await list(env, `${accountPath}/grants`, MAX_GRANTS_PER_ACCOUNT);
  const reverseGrants = await Promise.all(grants.map((grant) => (
    database.getDocument(env, `patientAccessGrants/${grant.id}`)
  )));
  const now = new Date();
  if (
    !Number.isFinite(account.authenticationTime)
    || now.getTime() - account.authenticationTime > 10 * 60 * 1000
    || grants.length < 1
    || grants.some((grant) => grant.data.status !== "pending" || !futureTimestamp(grant.data.expiresAt, now) || !futureTimestamp(grant.data.reviewAt, now))
    || reverseGrants.some((grant, index) => !grant || grant.data.status !== "pending" || grant.data.accountUid !== account.uid || grant.data.patientId !== grants[index].data.patientId)
  ) {
    throw new HttpError(403, "This patient portal invitation cannot be activated. Please contact the clinic.");
  }
  await database.commitWrites(env, [
    database.updateDocumentWrite(env, accountPath, {
      status: "active", inviteStatus: "claimed", claimedAt: now, updatedAt: now,
    }, ["status", "inviteStatus", "claimedAt", "updatedAt"], accountDocument.updateTime),
    ...grants.map((grant) => database.updateDocumentWrite(
      env,
      `${accountPath}/grants/${grant.id}`,
      { status: "active", activatedAt: now, updatedAt: now },
      ["status", "activatedAt", "updatedAt"],
      grant.updateTime,
    )),
    ...grants.map((grant, index) => database.updateDocumentWrite(
      env,
      `patientAccessGrants/${grant.id}`,
      { status: "active", activatedAt: now, updatedAt: now },
      ["status", "activatedAt", "updatedAt"],
      reverseGrants[index].updateTime,
    )),
    database.createDocumentWrite(env, `patientAccessAudit/${crypto.randomUUID()}`, {
      eventType: "patient_portal.account_claimed",
      category: "patient_access",
      actorUid: authenticatedUser.uid,
      actorRole: "patient_account",
      accountUid: authenticatedUser.uid,
      grantCount: grants.length,
      createdAt: now,
    }),
  ]);
  return { claimed: true, active: true };
}

function activeGrant(grant, now, scope = "") {
  const status = cleanText(grant?.data?.status, 20);
  const scopes = Array.isArray(grant?.data?.scopes) ? grant.data.scopes : [];
  return GRANT_STATUSES.has(status)
    && status === "active"
    && validDocumentId(grant?.data?.patientId)
    && scopes.includes("profile")
    && (!scope || scopes.includes(scope))
    && futureTimestamp(grant.data.expiresAt, now)
    && futureTimestamp(grant.data.reviewAt, now);
}

function sortByDate(documents, fields) {
  return [...documents].sort((left, right) => {
    const leftValue = fields.map((field) => timestampText(left.data[field])).find(Boolean) || "";
    const rightValue = fields.map((field) => timestampText(right.data[field])).find(Boolean) || "";
    return rightValue.localeCompare(leftValue);
  });
}

function doctorLabel(doctorId) {
  return doctorId === "pediatrics" ? "Dr. Lt Col Shafi Ahamad" : doctorId === "obg" ? "Dr. Shaik Reshma" : "Clinic doctor";
}

export async function projectGrantDashboard(env, grant, database = DEFAULT_DATABASE, query = runQuery) {
  const patientId = grant.data.patientId;
  const patientDocument = await database.getDocument(env, `patients/${patientId}`);
  if (!patientDocument || patientDocument.data.archived === true) return null;
  const scopes = new Set(grant.data.scopes || []);
  const profileAllowed = scopes.has("profile");
  const [appointments, prescriptions, reports, invoices] = await Promise.all([
    scopes.has("appointments") ? query(env, {
      collectionId: "appointments", whereField: "patientId", whereValue: patientId,
      fields: ["doctorId", "preferredDate", "preferredTime", "status", "queueToken"], limit: 50,
    }) : [],
    scopes.has("prescriptions") ? query(env, {
      parentPath: `patients/${patientId}`, collectionId: "prescriptions",
      fields: ["prescribedDate", "doctorName", "createdAt"], limit: 50,
    }) : [],
    scopes.has("reports") ? query(env, {
      parentPath: `patients/${patientId}`, collectionId: "reports",
      fields: ["contentType", "size", "category", "reportDate", "createdAt"], limit: 50,
    }) : [],
    scopes.has("billing") ? query(env, {
      collectionId: "invoices", whereField: "patientId", whereValue: patientId,
      fields: ["invoiceNumber", "total", "amountPaid", "balance", "paymentStatus", "createdAt"], limit: 50,
    }) : [],
  ]);

  return {
    _patientUpdateTime: patientDocument.updateTime,
    _recordVersions: [
      ...appointments.map((entry) => ({ path: `appointments/${entry.id}`, updateTime: entry.updateTime })),
      ...prescriptions.map((entry) => ({ path: `patients/${patientId}/prescriptions/${entry.id}`, updateTime: entry.updateTime })),
      ...reports.map((entry) => ({ path: `patients/${patientId}/reports/${entry.id}`, updateTime: entry.updateTime })),
      ...invoices.map((entry) => ({ path: `invoices/${entry.id}`, updateTime: entry.updateTime })),
    ],
    grant: {
      id: grant.id,
      relationship: cleanText(grant.data.relationship, 30),
      scopes: [...scopes].filter((scope) => SCOPES.has(scope)),
      expiresAt: timestampText(grant.data.expiresAt),
      reviewAt: timestampText(grant.data.reviewAt),
    },
    patient: {
      id: patientId,
      patientNumber: cleanText(patientDocument.data.patientNumber, 40),
      fullName: cleanText(patientDocument.data.fullName, 100) || "Patient",
      phone: profileAllowed ? cleanText(patientDocument.data.phone, 20) : "",
      dateOfBirth: profileAllowed ? cleanText(patientDocument.data.dateOfBirth, 10) : "",
      gender: profileAllowed ? cleanText(patientDocument.data.gender, 30) : "",
      doctorName: profileAllowed
        ? cleanText(patientDocument.data.doctorName, 100) || doctorLabel(patientDocument.data.doctorId)
        : "",
      profileAllowed,
    },
    appointments: sortByDate(appointments, ["preferredDate"]).map((entry) => ({
      id: entry.id,
      doctorName: doctorLabel(entry.data.doctorId),
      preferredDate: cleanText(entry.data.preferredDate, 10),
      preferredTime: cleanText(entry.data.preferredTime, 10),
      status: cleanText(entry.data.status, 30),
      queueToken: Number(entry.data.queueToken || 0),
    })),
    prescriptions: sortByDate(prescriptions, ["prescribedDate", "createdAt"]).map((entry) => ({
      id: entry.id,
      prescribedDate: cleanText(entry.data.prescribedDate, 10),
      doctorName: cleanText(entry.data.doctorName, 100),
    })),
    reports: sortByDate(reports, ["reportDate", "createdAt"]).map((entry) => ({
      id: entry.id,
      contentType: cleanText(entry.data.contentType, 100),
      size: Number(entry.data.size || 0),
      category: cleanText(entry.data.category, 100),
      reportDate: cleanText(entry.data.reportDate, 10),
    })),
    invoices: sortByDate(invoices, ["createdAt"]).map((entry) => ({
      id: entry.id,
      invoiceNumber: cleanText(entry.data.invoiceNumber, 40),
      total: Number(entry.data.total || 0),
      amountPaid: Number(entry.data.amountPaid || 0),
      balance: Number(entry.data.balance || 0),
      paymentStatus: cleanText(entry.data.paymentStatus, 20),
      createdAt: timestampText(entry.data.createdAt),
    })),
  };
}

export async function portalDashboard(
  env,
  account,
  {
    database = DEFAULT_DATABASE,
    list = listDocuments,
    project = projectGrantDashboard,
  } = {},
) {
  const grants = await list(env, `patientAccounts/${account.uid}/grants`, MAX_GRANTS_PER_ACCOUNT);
  const now = new Date();
  const active = grants.filter((grant) => activeGrant(grant, now));
  const projected = (await Promise.all(active.map((grant) => project(env, grant, database)))).filter(Boolean);
  const recordVersions = projected.flatMap((entry) => entry._recordVersions || []);
  const verificationTimes = [
    account.updateTime,
    ...active.map((grant) => grant.updateTime),
    ...projected.map((entry) => entry._patientUpdateTime),
    ...recordVersions.map((record) => record.updateTime),
  ];
  const totalWrites = 1 + active.length + projected.length + recordVersions.length + 1;
  if (
    totalWrites > MAX_DASHBOARD_VERIFY_WRITES
    || verificationTimes.some((value) => !cleanText(value, 100))
    || recordVersions.some((record) => !cleanText(record.path, 300))
  ) {
    throw new HttpError(503, "This family portal has more records than can be opened safely at once. Please contact the clinic.");
  }
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, `patientAccounts/${account.uid}`, account.updateTime),
    ...active.map((grant) => database.verifyDocumentWrite(
      env,
      `patientAccounts/${account.uid}/grants/${grant.id}`,
      grant.updateTime,
    )),
    ...projected.map((entry) => database.verifyDocumentWrite(
      env,
      `patients/${entry.patient.id}`,
      entry._patientUpdateTime,
    )),
    ...recordVersions.map((record) => (
      database.verifyDocumentWrite(env, record.path, record.updateTime)
    )),
    database.createDocumentWrite(env, `patientAccessAudit/${crypto.randomUUID()}`, {
      eventType: "patient_portal.dashboard_view_authorized",
      category: "patient_access",
      actorUid: account.uid,
      actorRole: "patient_account",
      accountUid: account.uid,
      grantIds: active.map((grant) => grant.id),
      patientCount: projected.length,
      outcome: "authorized",
      createdAt: now,
    }),
  ]);
  const family = projected.map((entry) => {
    const safeEntry = { ...entry };
    delete safeEntry._patientUpdateTime;
    delete safeEntry._recordVersions;
    return safeEntry;
  });
  return {
    account: { displayName: account.displayName },
    family,
    generatedAt: now.toISOString(),
  };
}

export async function authorizedPortalGrant(env, account, patientId, scope, list = listDocuments) {
  if (!validDocumentId(patientId) || !SCOPES.has(scope)) {
    throw new HttpError(404, "This patient document is not available.");
  }
  const grants = await list(env, `patientAccounts/${account.uid}/grants`, MAX_GRANTS_PER_ACCOUNT);
  const grant = grants.find((entry) => entry.data.patientId === patientId && activeGrant(entry, new Date(), scope));
  if (!grant) throw new HttpError(404, "This patient document is not available.");
  return grant;
}

export async function adminPortalDirectory(env, authenticatedAdministrator, database = DEFAULT_DATABASE, list = listDocuments) {
  const adminPath = `staff/${authenticatedAdministrator?.uid || "invalid"}`;
  const adminDocument = await database.getDocument(env, adminPath);
  const administrator = currentAdministrator(authenticatedAdministrator, adminDocument);
  const accounts = await list(env, "patientAccounts", MAX_ACCOUNTS);
  const now = new Date();
  const result = await Promise.all(accounts.map(async (account) => {
    const grants = await list(env, `patientAccounts/${account.id}/grants`, MAX_GRANTS_PER_ACCOUNT);
    return {
      uid: account.id,
      displayName: cleanText(account.data.displayName, 100),
      email: cleanText(account.data.email, 254),
      status: cleanText(account.data.status, 20),
      invitedAt: timestampText(account.data.invitedAt),
      claimedAt: timestampText(account.data.claimedAt),
      grants: await Promise.all(grants.map(async (grant) => {
        const patient = await database.getDocument(env, `patients/${grant.data.patientId}`);
        const lifecycle = portalGrantLifecycle(grant.data, now);
        return {
          grantId: grant.id,
          grantVersion: cleanText(grant.updateTime, 100),
          patientId: cleanText(grant.data.patientId, 128),
          patientName: cleanText(patient?.data?.fullName, 100) || "Patient record",
          relationship: cleanText(grant.data.relationship, 30),
          status: cleanText(grant.data.status, 20),
          scopes: Array.isArray(grant.data.scopes) ? grant.data.scopes.filter((scope) => SCOPES.has(scope)) : [],
          reviewAt: timestampText(grant.data.reviewAt),
          expiresAt: timestampText(grant.data.expiresAt),
          reviewPolicy: cleanText(grant.data.reviewPolicy, 100),
          lifecycle: lifecycle.state,
          nextActionAt: lifecycle.nextActionAt,
          daysUntilAction: lifecycle.daysUntilAction,
        };
      })),
    };
  }));
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, adminPath, adminDocument.updateTime),
    database.createDocumentWrite(env, `patientAccessAudit/${crypto.randomUUID()}`, {
      eventType: "patient_portal.admin_directory_view_authorized",
      category: "patient_access",
      actorUid: administrator.uid,
      actorRole: administrator.role,
      accountCount: result.length,
      outcome: "authorized",
      createdAt: now,
    }),
  ]);
  return result;
}

export async function resendPortalInvitation(env, body, authenticatedAdministrator, database = DEFAULT_DATABASE, auth = { sendPasswordResetEmail }) {
  const accountUid = cleanText(body?.accountUid, 128);
  const identityVerificationMethod = cleanText(body?.identityVerificationMethod, 40);
  const identityVerificationReference = cleanText(body?.identityVerificationReference, 100);
  if (!validDocumentId(accountUid) || body?.identityAttested !== true || !["in_person", "registered_phone", "photo_id"].includes(identityVerificationMethod) || !/^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$/u.test(identityVerificationReference)) throw new HttpError(400, "Record a valid clinic filing reference for the identity verification.");
  const adminPath = `staff/${authenticatedAdministrator?.uid || "invalid"}`;
  const accountPath = `patientAccounts/${accountUid}`;
  const [adminDocument, accountDocument] = await Promise.all([database.getDocument(env, adminPath), database.getDocument(env, accountPath)]);
  const administrator = currentAdministrator(authenticatedAdministrator, adminDocument);
  if (!accountDocument || !["pending", "active"].includes(accountDocument.data.status)) throw new HttpError(409, "A password link cannot be sent for this family account.");
  const now = new Date();
  const lastSent = Date.parse(timestampText(accountDocument.data.inviteLastSentAt));
  if (Number.isFinite(lastSent) && now.getTime() - lastSent < 10 * 60 * 1000) throw new HttpError(429, "Please wait 10 minutes before resending this invitation.");
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, adminPath, adminDocument.updateTime),
    database.updateDocumentWrite(env, accountPath, { inviteLastSentAt: now, inviteLastSentBy: administrator.uid, updatedAt: now }, ["inviteLastSentAt", "inviteLastSentBy", "updatedAt"], accountDocument.updateTime),
    database.createDocumentWrite(env, `patientAccessAudit/${crypto.randomUUID()}`, { eventType: accountDocument.data.status === "pending" ? "patient_portal.invitation_resend_authorized" : "patient_portal.password_reset_authorized", category: "patient_access", actorUid: administrator.uid, actorRole: administrator.role, accountUid, identityVerified: true, identityVerificationMethod, identityVerificationReference, outcome: "authorized", createdAt: now }),
  ]);
  await auth.sendPasswordResetEmail(env, canonicalEmail(accountDocument.data.email), PORTAL_CONTINUE_URL);
  return { accepted: true };
}

export function normalizePortalRenewRequest(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Enter valid family access re-verification details.");
  }
  const accountUid = cleanText(body.accountUid, 128);
  const grantId = cleanText(body.grantId, 128);
  if (!validDocumentId(accountUid) || !validDocumentId(grantId)) {
    throw new HttpError(400, "Choose valid family access to renew.");
  }
  const identityVerificationMethod = cleanText(body.identityVerificationMethod, 40);
  if (body.identityAttested !== true || !IDENTITY_VERIFICATION_METHODS.has(identityVerificationMethod)) {
    throw new HttpError(400, "Verify the family account holder's identity before renewing access.");
  }
  const identityVerificationReference = referenceCode(
    body.identityVerificationReference,
    "Record a valid clinic filing reference for the identity verification.",
  );
  const consentRecordId = referenceCode(
    body.consentRecordId,
    "Record the new clinic consent or guardianship filing reference.",
  );
  if (identityVerificationReference.toLocaleUpperCase("en-IN") === consentRecordId.toLocaleUpperCase("en-IN")) {
    throw new HttpError(400, "Identity verification and consent must use separate clinic filing references.");
  }
  const reverificationReason = cleanText(body.reverificationReason, 40);
  if (!REVERIFICATION_REASONS.has(reverificationReason)) {
    throw new HttpError(400, "Choose why this family permission is being re-verified.");
  }
  return {
    accountUid,
    grantId,
    grantVersion: requiredUpdateTime(body.grantVersion),
    relationship: cleanText(body.relationship, 30),
    scopes: strictScopes(body.scopes),
    consentRecordId,
    consentMethod: cleanText(body.consentMethod, 30),
    evidenceType: cleanText(body.evidenceType, 40),
    consentAttested: body.consentAttested === true,
    identityAttested: true,
    identityVerificationMethod,
    identityVerificationReference,
    reverificationReason,
  };
}

export async function renewPortalGrant(env, body, authenticatedAdministrator, database = DEFAULT_DATABASE) {
  const input = normalizePortalRenewRequest(body);
  const adminPath = `staff/${authenticatedAdministrator?.uid || "invalid"}`;
  const adminDocument = validDocumentId(authenticatedAdministrator?.uid)
    ? await database.getDocument(env, adminPath)
    : null;
  const administrator = currentAdministrator(authenticatedAdministrator, adminDocument);
  const accountPath = `patientAccounts/${input.accountUid}`;
  const grantPath = `${accountPath}/grants/${input.grantId}`;
  const reverseGrantPath = `patientAccessGrants/${input.grantId}`;
  const [accountDocument, grantDocument, reverseGrantDocument] = await Promise.all([
    database.getDocument(env, accountPath),
    database.getDocument(env, grantPath),
    database.getDocument(env, reverseGrantPath),
  ]);
  if (!accountDocument || !["pending", "active"].includes(cleanText(accountDocument.data.status, 20))) {
    throw new HttpError(409, "This family portal account cannot be renewed.");
  }
  if (!grantDocument || !reverseGrantDocument || grantDocument.updateTime !== input.grantVersion) {
    throw new HttpError(409, "This family permission changed. Refresh and verify the latest record.");
  }
  const status = cleanText(grantDocument.data.status, 20);
  if (
    !["pending", "active"].includes(status)
    || cleanText(reverseGrantDocument.data.status, 20) !== status
    || reverseGrantDocument.data.accountUid !== input.accountUid
    || reverseGrantDocument.data.patientId !== grantDocument.data.patientId
    || cleanText(reverseGrantDocument.data.relationship, 30) !== cleanText(grantDocument.data.relationship, 30)
    || cleanText(reverseGrantDocument.data.consentRecordId, 128) !== cleanText(grantDocument.data.consentRecordId, 128)
    || !samePortalScopes(reverseGrantDocument.data.scopes, grantDocument.data.scopes)
  ) {
    throw new HttpError(409, "This family permission cannot be renewed. Refresh and review its current status.");
  }
  const patientId = cleanText(grantDocument.data.patientId, 128);
  const previousConsentId = cleanText(grantDocument.data.consentRecordId, 128);
  if (!validDocumentId(patientId) || !validDocumentId(previousConsentId)) {
    throw new HttpError(409, "This family permission is missing its prior authorization record and cannot be renewed.");
  }
  const patientPath = `patients/${patientId}`;
  const previousConsentPath = `patientAccessConsents/${previousConsentId}`;
  const [patientDocument, previousConsentDocument] = await Promise.all([
    database.getDocument(env, patientPath),
    database.getDocument(env, previousConsentPath),
  ]);
  if (!patientDocument || patientDocument.data.archived === true) {
    throw new HttpError(409, "This patient chart is unavailable for family access renewal.");
  }
  if (
    !previousConsentDocument
    || previousConsentDocument.data.accountUid !== input.accountUid
    || previousConsentDocument.data.patientId !== patientId
    || previousConsentDocument.data.grantId !== input.grantId
  ) {
    throw new HttpError(409, "The prior authorization record does not match this family permission.");
  }
  if (
    cleanText(previousConsentDocument.data.clinicReference, 100).toLocaleUpperCase("en-IN")
    === input.consentRecordId.toLocaleUpperCase("en-IN")
  ) {
    throw new HttpError(409, "Record a new clinic consent or guardianship filing reference before renewing access.");
  }

  const now = new Date();
  const renewed = validateGrantRequest({ ...input, patientId }, patientDocument.data, now);
  const newConsentId = crypto.randomUUID().replaceAll("-", "");
  const renewalCount = Number.isSafeInteger(grantDocument.data.renewalCount)
    ? Math.max(0, grantDocument.data.renewalCount) + 1
    : 1;
  const sharedGrantUpdate = {
    relationship: renewed.relationship,
    authorizationBasis: renewed.authorizationBasis,
    scopes: renewed.scopes,
    verifiedBy: administrator.uid,
    verifiedAt: now,
    consentRecordId: newConsentId,
    reviewAt: renewed.reviewAt,
    reviewPolicy: renewed.reviewPolicy,
    expiresAt: renewed.expiresAt,
    renewalCount,
    lastReverifiedAt: now,
    lastReverifiedBy: administrator.uid,
    updatedAt: now,
  };
  const sharedFields = [
    "relationship", "authorizationBasis", "scopes", "verifiedBy", "verifiedAt", "consentRecordId",
    "reviewAt", "reviewPolicy", "expiresAt", "renewalCount", "lastReverifiedAt", "lastReverifiedBy", "updatedAt",
  ];
  const previousLifecycle = portalGrantLifecycle(grantDocument.data, now).state;
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, adminPath, adminDocument.updateTime),
    database.verifyDocumentWrite(env, accountPath, accountDocument.updateTime),
    database.verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
    database.verifyDocumentWrite(env, previousConsentPath, previousConsentDocument.updateTime),
    database.updateDocumentWrite(env, grantPath, sharedGrantUpdate, sharedFields, grantDocument.updateTime),
    database.updateDocumentWrite(env, reverseGrantPath, sharedGrantUpdate, sharedFields, reverseGrantDocument.updateTime),
    database.createDocumentWrite(env, `patientAccessConsents/${newConsentId}`, {
      consentRecordId: newConsentId,
      clinicReference: renewed.consentEvidence.recordId,
      version: renewed.consentEvidence.version,
      lifecycleEvent: "reverification",
      supersedesConsentRecordId: previousConsentId,
      accountUid: input.accountUid,
      patientId,
      grantId: input.grantId,
      relationship: renewed.relationship,
      authorizationBasis: renewed.authorizationBasis,
      accountHolderName: cleanText(accountDocument.data.displayName, 100),
      accountHolderEmail: canonicalEmail(accountDocument.data.email),
      scopes: [...renewed.scopes].sort(),
      scopeSemantics: "current_and_future_records_until_expiry_or_revocation",
      scopeSemanticsVersion: "1.0",
      subject: renewed.consentEvidence.subject,
      reviewAt: renewed.reviewAt,
      expiresAt: renewed.expiresAt,
      method: renewed.consentEvidence.method,
      evidenceType: renewed.consentEvidence.evidenceType,
      reviewPolicy: renewed.reviewPolicy,
      staffAttested: true,
      attestationId: REVERIFICATION_ATTESTATION.id,
      attestationVersion: REVERIFICATION_ATTESTATION.version,
      attestationText: REVERIFICATION_ATTESTATION.text,
      identityVerified: true,
      identityVerificationMethod: input.identityVerificationMethod,
      identityVerificationReference: input.identityVerificationReference,
      identityVerifiedBy: administrator.uid,
      identityVerifiedAt: now,
      reverificationReason: input.reverificationReason,
      verifiedBy: administrator.uid,
      verifiedAt: now,
      createdAt: now,
    }),
    database.createDocumentWrite(env, `patientAccessAudit/${crypto.randomUUID()}`, {
      eventType: "patient_portal.grant_reverified",
      category: "patient_access",
      actorUid: administrator.uid,
      actorRole: administrator.role,
      accountUid: input.accountUid,
      grantId: input.grantId,
      patientId,
      previousConsentRecordId: previousConsentId,
      newConsentRecordId: newConsentId,
      previousLifecycle,
      previousRelationship: cleanText(grantDocument.data.relationship, 30),
      renewedRelationship: renewed.relationship,
      previousScopes: Array.isArray(grantDocument.data.scopes) ? grantDocument.data.scopes : [],
      renewedScopes: renewed.scopes,
      identityVerified: true,
      identityVerificationMethod: input.identityVerificationMethod,
      identityVerificationReference: input.identityVerificationReference,
      reverificationReason: input.reverificationReason,
      outcome: "authorized",
      createdAt: now,
    }),
  ]);
  return {
    changed: true,
    accountUid: input.accountUid,
    grantId: input.grantId,
    status,
    consentRecordId: newConsentId,
    reviewAt: timestampText(renewed.reviewAt),
    expiresAt: timestampText(renewed.expiresAt),
  };
}

export function normalizePortalRevokeRequest(body = {}) {
  const accountUid = cleanText(body?.accountUid, 128);
  const grantId = cleanText(body?.grantId, 128);
  if (!validDocumentId(accountUid) || (grantId && !validDocumentId(grantId))) {
    throw new HttpError(400, "Choose valid patient portal access to revoke.");
  }
  return { accountUid, grantId, reason: cleanText(body?.reason, 300) };
}

export async function revokePortalAccess(env, body, authenticatedAdministrator, database = DEFAULT_DATABASE, list = listDocuments) {
  const input = normalizePortalRevokeRequest(body);
  const adminPath = `staff/${authenticatedAdministrator?.uid || "invalid"}`;
  const accountPath = `patientAccounts/${input.accountUid}`;
  const [adminDocument, accountDocument] = await Promise.all([
    database.getDocument(env, adminPath), database.getDocument(env, accountPath),
  ]);
  const admin = currentAdministrator(authenticatedAdministrator, adminDocument);
  if (!accountDocument) throw new HttpError(404, "This patient portal account could not be found.");
  const allGrants = await list(env, `${accountPath}/grants`, MAX_GRANTS_PER_ACCOUNT);
  const targets = input.grantId ? allGrants.filter((grant) => grant.id === input.grantId) : allGrants;
  if (input.grantId && targets.length !== 1) throw new HttpError(404, "This patient access grant could not be found.");
  const activeTargets = targets.filter((grant) => grant.data.status !== "revoked");
  if (activeTargets.length === 0 && (input.grantId || accountDocument.data.status === "revoked")) {
    return { changed: false, accountUid: input.accountUid, grantId: input.grantId };
  }
  const reverseTargets = await Promise.all(activeTargets.map((grant) => (
    database.getDocument(env, `patientAccessGrants/${grant.id}`)
  )));
  if (reverseTargets.some((reverse, index) => (
    !reverse
    || reverse.data.accountUid !== input.accountUid
    || reverse.data.patientId !== activeTargets[index].data.patientId
    || reverse.data.status === "revoked"
  ))) {
    throw new HttpError(409, "This patient access record changed. Refresh and try again.");
  }
  const now = new Date();
  const accountRevocation = !input.grantId;
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, adminPath, adminDocument.updateTime),
    ...(accountRevocation ? [database.updateDocumentWrite(
      env, accountPath,
      { status: "revoked", inviteStatus: "revoked", revokedAt: now, revokedBy: admin.uid, updatedAt: now },
      ["status", "inviteStatus", "revokedAt", "revokedBy", "updatedAt"], accountDocument.updateTime,
    )] : [database.verifyDocumentWrite(env, accountPath, accountDocument.updateTime)]),
    ...activeTargets.map((grant) => database.updateDocumentWrite(
      env, `${accountPath}/grants/${grant.id}`,
      { status: "revoked", revokedAt: now, revokedBy: admin.uid, revocationReason: input.reason, updatedAt: now },
      ["status", "revokedAt", "revokedBy", "revocationReason", "updatedAt"], grant.updateTime,
    )),
    ...activeTargets.map((grant, index) => database.updateDocumentWrite(
      env, `patientAccessGrants/${grant.id}`,
      { status: "revoked", revokedAt: now, revokedBy: admin.uid, revocationReason: input.reason, updatedAt: now },
      ["status", "revokedAt", "revokedBy", "revocationReason", "updatedAt"], reverseTargets[index].updateTime,
    )),
    database.createDocumentWrite(env, `patientAccessAudit/${crypto.randomUUID()}`, {
      eventType: accountRevocation ? "patient_portal.account_revoked" : "patient_portal.grant_revoked",
      category: "patient_access",
      actorUid: admin.uid,
      actorRole: admin.role,
      accountUid: input.accountUid,
      grantId: input.grantId,
      patientIds: activeTargets.map((grant) => grant.data.patientId),
      authorizationBases: activeTargets.map((grant) => cleanText(grant.data.authorizationBasis, 30)),
      revokedGrantCount: activeTargets.length,
      reason: input.reason,
      createdAt: now,
    }),
  ]);
  return { changed: true, accountUid: input.accountUid, grantId: input.grantId };
}

export const PATIENT_PORTAL = Object.freeze({
  scopes: [...SCOPES],
  maxGrantsPerAccount: MAX_GRANTS_PER_ACCOUNT,
});
