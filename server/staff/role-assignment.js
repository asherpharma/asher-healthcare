import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";
import { RECEPTION_DOCTORS } from "../reception/workflow.js";

const STAFF_ROLES = new Set(["admin", "doctor", "reception"]);
const DOCTOR_BY_NAME = new Map(
  Object.values(RECEPTION_DOCTORS).map((doctor) => [doctor.name, doctor]),
);

const DEFAULT_DATABASE = {
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
};

function canonicalRole(value) {
  return STAFF_ROLES.has(value) ? value : "invalid";
}

function canonicalDoctorId(value) {
  const doctor = DOCTOR_BY_NAME.get(String(value || "").trim());
  if (doctor) return doctor.id;
  return String(value || "").trim() ? "noncanonical" : "unassigned";
}

export function normalizeStaffRoleAssignmentRequest(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Choose a valid staff access assignment.");
  }

  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  if (!validDocumentId(uid)) {
    throw new HttpError(400, "Choose a valid staff account.");
  }

  const role = typeof body.role === "string" ? body.role.trim() : "";
  if (!STAFF_ROLES.has(role)) {
    throw new HttpError(400, "Choose a valid staff role.");
  }

  const requestedDoctorName = typeof body.doctorName === "string"
    ? body.doctorName.trim()
    : "";
  if (role === "doctor") {
    const doctor = DOCTOR_BY_NAME.get(requestedDoctorName);
    if (!doctor) {
      throw new HttpError(400, "Assign this login to one of the clinic doctors.");
    }
    return { uid, role, doctorName: doctor.name, doctorId: doctor.id };
  }
  if (requestedDoctorName) {
    throw new HttpError(400, "Only doctor accounts can have a doctor assignment.");
  }

  return { uid, role, doctorName: "", doctorId: "unassigned" };
}

export function normalizeStaffActiveRequest(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Choose a valid staff access change.");
  }
  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  if (!validDocumentId(uid)) {
    throw new HttpError(400, "Choose a valid staff account.");
  }
  if (typeof body.active !== "boolean") {
    throw new HttpError(400, "Choose whether this staff account is active.");
  }
  return { uid, active: body.active };
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
  return { uid: authenticatedAdministrator.uid, role: "admin" };
}

function currentTarget(uid, targetDocument) {
  if (!targetDocument) {
    throw new HttpError(404, "This staff account could not be found.");
  }
  return {
    uid,
    role: String(targetDocument.data.role || "").trim(),
    doctorName: String(targetDocument.data.doctorName || "").trim(),
    labReportOperator: targetDocument.data.labReportOperator === true,
  };
}

export async function setStaffRoleAssignment(
  env,
  body,
  authenticatedAdministrator,
  database = DEFAULT_DATABASE,
) {
  const input = normalizeStaffRoleAssignmentRequest(body);
  if (!validDocumentId(authenticatedAdministrator?.uid)) {
    throw new HttpError(403, "Only a clinic administrator can change staff roles.");
  }

  const administratorPath = `staff/${authenticatedAdministrator.uid}`;
  const targetPath = `staff/${input.uid}`;
  const [administratorDocument, targetDocument] = await Promise.all([
    database.getDocument(env, administratorPath),
    database.getDocument(env, targetPath),
  ]);
  const actor = currentAdministrator(authenticatedAdministrator, administratorDocument);
  const target = currentTarget(input.uid, targetDocument);

  const roleChanged = target.role !== input.role;
  const doctorChanged = target.doctorName !== input.doctorName;
  if (!roleChanged && !doctorChanged) {
    return {
      uid: target.uid,
      role: input.role,
      doctorName: input.doctorName,
      labReportOperator: target.labReportOperator,
      changed: false,
    };
  }
  if (roleChanged && actor.uid === target.uid) {
    throw new HttpError(409, "You cannot change your own administrator role.");
  }

  const now = new Date();
  const privilegeContextChanged = roleChanged || doctorChanged;
  const updates = {
    role: input.role,
    doctorName: input.doctorName,
    updatedBy: actor.uid,
    updatedAt: now,
    ...(privilegeContextChanged ? { labReportOperator: false } : {}),
  };
  const fieldPaths = [
    "role",
    "doctorName",
    "updatedBy",
    "updatedAt",
    ...(privilegeContextChanged ? ["labReportOperator"] : []),
  ];
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
      updates,
      fieldPaths,
      targetDocument.updateTime,
    ),
    database.createDocumentWrite(env, `auditLogs/${auditId}`, {
      eventType: "staff.access_profile_changed",
      category: "staff_access",
      changeType: roleChanged
        ? (doctorChanged ? "role_and_doctor_assignment" : "role")
        : "doctor_assignment",
      actorUid: actor.uid,
      actorRole: actor.role,
      targetUid: target.uid,
      previousRole: canonicalRole(target.role),
      nextRole: input.role,
      previousDoctorId: canonicalDoctorId(target.doctorName),
      nextDoctorId: input.doctorId,
      explicitLabAccessRevoked: privilegeContextChanged && target.labReportOperator,
      createdAt: now,
    }),
  ]);

  return {
    uid: target.uid,
    role: input.role,
    doctorName: input.doctorName,
    labReportOperator: privilegeContextChanged ? false : target.labReportOperator,
    changed: true,
  };
}

export async function setStaffActiveState(
  env,
  body,
  authenticatedAdministrator,
  database = DEFAULT_DATABASE,
) {
  const input = normalizeStaffActiveRequest(body);
  if (!validDocumentId(authenticatedAdministrator?.uid)) {
    throw new HttpError(403, "Only a clinic administrator can change staff access.");
  }

  const administratorPath = `staff/${authenticatedAdministrator.uid}`;
  const targetPath = `staff/${input.uid}`;
  const [administratorDocument, targetDocument] = await Promise.all([
    database.getDocument(env, administratorPath),
    database.getDocument(env, targetPath),
  ]);
  const actor = currentAdministrator(authenticatedAdministrator, administratorDocument);
  if (!targetDocument) {
    throw new HttpError(404, "This staff account could not be found.");
  }
  if (actor.uid === input.uid && !input.active) {
    throw new HttpError(409, "You cannot deactivate your own administrator account.");
  }

  const previousActive = targetDocument.data.active === true;
  if (previousActive === input.active) {
    return { uid: input.uid, active: input.active, changed: false };
  }

  const now = new Date();
  const auditId = crypto.randomUUID();
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, administratorPath, administratorDocument.updateTime),
    database.updateDocumentWrite(
      env,
      targetPath,
      { active: input.active, updatedBy: actor.uid, updatedAt: now },
      ["active", "updatedBy", "updatedAt"],
      targetDocument.updateTime,
    ),
    database.createDocumentWrite(env, `auditLogs/${auditId}`, {
      eventType: input.active ? "staff.access_reactivated" : "staff.access_deactivated",
      category: "staff_access",
      actorUid: actor.uid,
      actorRole: actor.role,
      targetUid: input.uid,
      previousActive,
      nextActive: input.active,
      createdAt: now,
    }),
  ]);

  return { uid: input.uid, active: input.active, changed: true };
}
