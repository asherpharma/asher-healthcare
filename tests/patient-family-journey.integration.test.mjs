import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizedPortalGrant,
  claimPortalInvitation,
  portalDashboard,
  projectGrantDashboard,
  provisionPortalAccount,
  revokePortalAccess,
} from "../server/patients/portal-access.js";
import { recordPortalDocumentAccess } from "../server/patients/portal-document-access.js";
import { recordPortalReportAccess } from "../server/patients/portal-report-access.js";
import { HttpError } from "../server/razorpay/http.js";
import {
  projectCommunicationDesk,
  validateConsentGrant,
} from "../server/communications/workflow.js";
import {
  SYNTHETIC_PROFILES,
  communicationJourneySnapshot,
  createPortalJourneyFixture,
  createSyntheticAuthFixture,
  portalProvisionPayload,
} from "./fixtures/isolated-clinic-journey.mjs";

const env = Object.freeze({
  FIREBASE_PROJECT_ID: "synthetic-emulator-only",
  FIREBASE_WEB_API_KEY: "synthetic-never-used",
});

function accountSession(fixture) {
  const profile = SYNTHETIC_PROFILES.familyAccount;
  const document = fixture.document(`patientAccounts/${profile.uid}`);
  assert.ok(document, "Synthetic portal account must exist");
  return {
    ...document.data,
    updateTime: document.updateTime,
    authenticationTime: Date.now(),
  };
}

function authorizeWith(fixture) {
  return (nextEnv, account, patientId, scope) => (
    authorizedPortalGrant(nextEnv, account, patientId, scope, fixture.list)
  );
}

async function provisionAndClaim() {
  const fixture = createPortalJourneyFixture();
  const auth = createSyntheticAuthFixture();
  const administrator = SYNTHETIC_PROFILES.administrator;
  const family = SYNTHETIC_PROFILES.familyAccount;

  const invitation = await provisionPortalAccount(
    env,
    portalProvisionPayload(),
    { uid: administrator.uid },
    fixture,
    auth,
  );
  assert.equal(invitation.uid, family.uid);
  assert.equal(fixture.document(`patientAccounts/${family.uid}`).data.status, "pending");

  const pendingGrants = fixture.documents(`patientAccounts/${family.uid}/grants`);
  assert.equal(pendingGrants.length, 1);
  assert.equal(pendingGrants[0].data.status, "pending");
  assert.equal(fixture.document(`patientAccessGrants/${pendingGrants[0].id}`).data.status, "pending");
  await assert.rejects(
    authorizedPortalGrant(
      env,
      accountSession(fixture),
      SYNTHETIC_PROFILES.patient.id,
      "reports",
      fixture.list,
    ),
    (error) => error instanceof HttpError && error.status === 404,
  );

  const claim = await claimPortalInvitation(
    env,
    {
      uid: family.uid,
      email: family.email,
      authenticationTime: Date.now(),
    },
    fixture,
    fixture.list,
  );
  assert.deepEqual(claim, { claimed: true, active: true });
  assert.equal(fixture.document(`patientAccounts/${family.uid}`).data.status, "active");
  assert.equal(fixture.document(`patientAccounts/${family.uid}/grants/${pendingGrants[0].id}`).data.status, "active");
  assert.equal(fixture.document(`patientAccessGrants/${pendingGrants[0].id}`).data.status, "active");

  return { fixture, auth, grantId: pendingGrants[0].id };
}

test("isolated family journey provisions, claims, opens scoped records, and revokes without external side effects", async () => {
  const { fixture, auth, grantId } = await provisionAndClaim();
  const patient = SYNTHETIC_PROFILES.patient;
  const unrelated = SYNTHETIC_PROFILES.unrelatedPatient;
  const family = SYNTHETIC_PROFILES.familyAccount;
  const administrator = SYNTHETIC_PROFILES.administrator;
  const account = accountSession(fixture);

  assert.deepEqual(
    auth.events.map((event) => event.type),
    ["lookup", "temporary_secret_generated", "identity_created", "invitation_captured"],
  );
  assert.equal(auth.events.find((event) => event.type === "invitation_captured").email, family.email);
  assert.equal(auth.events.some((event) => event.type === "identity_deleted"), false);

  const dashboard = await portalDashboard(env, account, {
    database: fixture,
    list: fixture.list,
    project: (nextEnv, grant, database) => (
      projectGrantDashboard(nextEnv, grant, database, fixture.query)
    ),
  });
  assert.equal(dashboard.family.length, 1);
  assert.equal(dashboard.family[0].patient.id, patient.id);
  assert.deepEqual(dashboard.family[0].grant.scopes.sort(), ["appointments", "billing", "prescriptions", "profile", "reports"]);
  assert.equal(dashboard.family[0].appointments[0].id, "synthetic-appointment-001");
  assert.equal(dashboard.family[0].prescriptions[0].id, "synthetic-prescription-001");
  assert.equal(dashboard.family[0].reports[0].id, "synthetic-report-001");
  assert.equal(dashboard.family[0].invoices[0].id, "synthetic-invoice-001");

  const prescription = await recordPortalDocumentAccess(env, {
    patientId: patient.id,
    documentId: "synthetic-prescription-001",
    documentType: "prescription",
    action: "download",
  }, account, { database: fixture, grantAuthorizer: authorizeWith(fixture) });
  assert.equal(prescription.document.medicines[0].name, "Synthetic medicine");

  const receipt = await recordPortalDocumentAccess(env, {
    patientId: patient.id,
    documentId: "synthetic-invoice-001",
    documentType: "receipt",
    action: "print",
  }, account, { database: fixture, grantAuthorizer: authorizeWith(fixture) });
  assert.equal(receipt.document.paymentStatus, "paid");

  const report = await recordPortalReportAccess(env, {
    patientId: patient.id,
    reportId: "synthetic-report-001",
    action: "download",
  }, account, { database: fixture, grantAuthorizer: authorizeWith(fixture) });
  assert.equal(report.storagePath, `reports/${patient.id}/synthetic-report-001.pdf`);

  await assert.rejects(
    authorizedPortalGrant(env, account, unrelated.id, "reports", fixture.list),
    (error) => error instanceof HttpError && error.status === 404,
  );

  const revoked = await revokePortalAccess(env, {
    accountUid: family.uid,
    reason: "synthetic-test-cleanup",
  }, { uid: administrator.uid }, fixture, fixture.list);
  assert.equal(revoked.changed, true);
  assert.equal(fixture.document(`patientAccounts/${family.uid}`).data.status, "revoked");
  assert.equal(fixture.document(`patientAccounts/${family.uid}/grants/${grantId}`).data.status, "revoked");
  assert.equal(fixture.document(`patientAccessGrants/${grantId}`).data.status, "revoked");

  await assert.rejects(
    recordPortalDocumentAccess(env, {
      patientId: patient.id,
      documentId: "synthetic-prescription-001",
      documentType: "prescription",
      action: "download",
    }, accountSession(fixture), { database: fixture, grantAuthorizer: authorizeWith(fixture) }),
    (error) => error instanceof HttpError && error.status === 404,
  );

  const auditEvents = fixture.documents("patientAccessAudit").map((entry) => entry.data.eventType);
  for (const expected of [
    "patient_portal.account_invited",
    "patient_portal.account_claimed",
    "patient_portal.dashboard_view_authorized",
    "patient_portal.prescription_download_authorized",
    "patient_portal.receipt_print_authorized",
    "patient_portal.report_download_authorized",
    "patient_portal.account_revoked",
  ]) {
    assert.ok(auditEvents.includes(expected), `Missing audit event ${expected}`);
  }
});

test("an expired synthetic grant disappears from the portal and denies every protected record", async () => {
  const { fixture, grantId } = await provisionAndClaim();
  const patient = SYNTHETIC_PROFILES.patient;
  const family = SYNTHETIC_PROFILES.familyAccount;
  const grantPath = `patientAccounts/${family.uid}/grants/${grantId}`;
  fixture.patch(grantPath, { expiresAt: "2020-01-01T00:00:00.000Z" });

  const account = accountSession(fixture);
  const dashboard = await portalDashboard(env, account, {
    database: fixture,
    list: fixture.list,
    project: (nextEnv, grant, database) => (
      projectGrantDashboard(nextEnv, grant, database, fixture.query)
    ),
  });
  assert.deepEqual(dashboard.family, []);

  for (const attempt of [
    () => recordPortalDocumentAccess(env, {
      patientId: patient.id,
      documentId: "synthetic-prescription-001",
      documentType: "prescription",
      action: "download",
    }, account, { database: fixture, grantAuthorizer: authorizeWith(fixture) }),
    () => recordPortalReportAccess(env, {
      patientId: patient.id,
      reportId: "synthetic-report-001",
      action: "print",
    }, account, { database: fixture, grantAuthorizer: authorizeWith(fixture) }),
  ]) {
    await assert.rejects(attempt(), (error) => error instanceof HttpError && error.status === 404);
  }
});

test("synthetic consent and reminder projections remain private through ready, opened, delivered, and revoked states", () => {
  const patient = SYNTHETIC_PROFILES.patient;
  const consent = validateConsentGrant({
    patientId: patient.id,
    purpose: "care",
    channel: "whatsapp",
    recipient: patient.phone,
    method: "patient-verbal",
  }, patient, new Date("2026-08-15T08:00:00.000Z"));
  assert.equal(consent.recipient, "+919000000001");

  const ready = projectCommunicationDesk(communicationJourneySnapshot({ outboxStatus: "ready" }));
  const opened = projectCommunicationDesk(communicationJourneySnapshot({ outboxStatus: "opened" }));
  const delivered = projectCommunicationDesk(communicationJourneySnapshot({ outboxStatus: "delivered" }));
  const revoked = projectCommunicationDesk(communicationJourneySnapshot({
    consentStatus: "revoked",
    outboxStatus: "cancelled",
  }));

  assert.equal(ready.summary.consentReady, 1);
  assert.equal(ready.summary.readyToOpen, 1);
  assert.equal(opened.summary.readyToOpen, 1);
  assert.equal(delivered.summary.delivered, 1);
  assert.equal(revoked.summary.consentReady, 0);
  assert.equal(revoked.candidates[0].channels.whatsapp.status, "revoked");
  for (const desk of [ready, opened, delivered, revoked]) {
    assert.equal("recipient" in desk.outbox[0], false);
    assert.equal(desk.outbox[0].maskedRecipient.endsWith("0001"), true);
    assert.equal(JSON.stringify(desk.outbox).includes("+919000000001"), false);
  }
});
