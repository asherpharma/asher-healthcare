import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";

const TARGET_ROLES = new Set(["doctor", "reception"]);

const DEFAULT_DATABASE = {
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
};

function cleanName(value, fallback) {
  const name = typeof value === "string" ? value.trim().slice(0, 100) : "";
  return name || fallback;
}

export function normalizeStaffLabAccessRequest(body = {}) {
  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  if (!validDocumentId(uid)) {
    throw new HttpError(400, "Choose a valid staff account.");
  }
  if (typeof body.allowed !== "boolean") {
    throw new HttpError(400, "Choose whether laboratory report access is allowed.");
  }
  return { uid, allowed: body.allowed };
}

function currentAdministrator(authenticatedAdministrator, administratorDocument) {
  if (
    !authenticatedAdministrator
    || !validDocumentId(authenticatedAdministrator.uid)
    || !administratorDocument
    || administratorDocument.data.active !== true
    || administratorDocument.data.role !== "admin"
  ) {
    throw new HttpError(403, "This administrator account is no longer active.");
  }

  return {
    uid: authenticatedAdministrator.uid,
    role: "admin",
    displayName: cleanName(
      administratorDocument.data.displayName,
      "Clinic administrator",
    ),
  };
}

function currentTarget(uid, targetDocument) {
  if (!targetDocument) {
    throw new HttpError(404, "This staff account could not be found.");
  }
  if (targetDocument.data.active !== true) {
    throw new HttpError(409, "Reactivate this staff account before changing laboratory access.");
  }

  const role = String(targetDocument.data.role || "");
  if (role === "admin") {
    throw new HttpError(
      409,
      "Administrators already have laboratory access and do not need a separate grant.",
    );
  }
  if (!TARGET_ROLES.has(role)) {
    throw new HttpError(409, "This staff role cannot be assigned laboratory report access.");
  }

  return {
    uid,
    role,
    displayName: cleanName(targetDocument.data.displayName, "Clinic staff"),
    allowed: targetDocument.data.labReportOperator === true,
  };
}

export async function setStaffLabReportAccess(
  env,
  body,
  authenticatedAdministrator,
  database = DEFAULT_DATABASE,
) {
  const input = normalizeStaffLabAccessRequest(body);
  if (!validDocumentId(authenticatedAdministrator?.uid)) {
    throw new HttpError(403, "Only a clinic administrator can change laboratory access.");
  }

  const administratorPath = `staff/${authenticatedAdministrator.uid}`;
  const targetPath = `staff/${input.uid}`;
  const [administratorDocument, targetDocument] = await Promise.all([
    database.getDocument(env, administratorPath),
    database.getDocument(env, targetPath),
  ]);

  const actor = currentAdministrator(authenticatedAdministrator, administratorDocument);
  const target = currentTarget(input.uid, targetDocument);

  if (target.allowed === input.allowed) {
    return {
      uid: target.uid,
      role: target.role,
      displayName: target.displayName,
      labReportOperator: input.allowed,
      changed: false,
    };
  }

  const now = new Date();
  const eventType = input.allowed
    ? "staff.lab_report_access_granted"
    : "staff.lab_report_access_revoked";
  const auditId = crypto.randomUUID();

  await database.commitWrites(env, [
    database.verifyDocumentWrite(
      env,
      administratorPath,
      administratorDocument.updateTime,
    ),
    database.updateDocumentWrite(
      env,
      targetPath,
      {
        labReportOperator: input.allowed,
        updatedAt: now,
      },
      ["labReportOperator", "updatedAt"],
      targetDocument.updateTime,
    ),
    database.createDocumentWrite(env, `auditLogs/${auditId}`, {
      eventType,
      category: "staff_access",
      permission: "lab_report_operator",
      allowed: input.allowed,
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      targetUid: target.uid,
      targetName: target.displayName,
      targetRole: target.role,
      createdAt: now,
    }),
  ]);

  return {
    uid: target.uid,
    role: target.role,
    displayName: target.displayName,
    labReportOperator: input.allowed,
    changed: true,
  };
}
