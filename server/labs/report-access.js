import {
  assertActivePatientDocument,
  commitWrites,
  createDocumentWrite,
  getDocument,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";
import { doctorCanEditPatient } from "../patients/profile.js";
import { validateLabReportPath } from "../storage/report-objects.js";

const ACTION_EVENTS = Object.freeze({
  preview: "lab_report.preview_authorized",
  download: "lab_report.download_authorized",
  print: "lab_report.print_authorized",
});

const DEFAULT_DATABASE = {
  commitWrites,
  createDocumentWrite,
  getDocument,
  verifyDocumentWrite,
};

function cleanText(value, maximumLength) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function normalizeLabReportAccessRequest(body = {}) {
  const labOrderId = cleanText(body.labOrderId, 128);
  if (!validDocumentId(labOrderId)) {
    throw new HttpError(400, "Choose a valid laboratory order.");
  }

  const action = cleanText(body.action, 16).toLowerCase();
  if (!Object.hasOwn(ACTION_EVENTS, action)) {
    throw new HttpError(400, "Choose preview, download, or print for this report.");
  }
  return { labOrderId, action };
}

function currentActor(authenticatedStaff, staffDocument) {
  const role = String(staffDocument?.data?.role || "");
  if (
    !authenticatedStaff
    || !validDocumentId(authenticatedStaff.uid)
    || !staffDocument
    || staffDocument.data.active !== true
    || !["admin", "doctor", "reception"].includes(role)
  ) {
    throw new HttpError(403, "This staff account is no longer active.");
  }

  return {
    uid: authenticatedStaff.uid,
    role,
    displayName: cleanText(
      staffDocument.data.displayName
        || authenticatedStaff.displayName
        || authenticatedStaff.email
        || "Clinic staff",
      100,
    ),
    doctorName: cleanText(staffDocument.data.doctorName, 100),
    labReportOperator: role === "admin" || staffDocument.data.labReportOperator === true,
  };
}

export function assertLabReportReadAccess(actor, patient) {
  if (actor?.role === "admin") return actor;
  if (actor?.role === "reception" && actor.labReportOperator === true) return actor;
  if (doctorCanEditPatient(actor, patient)) {
    return actor;
  }
  throw new HttpError(
    403,
    "Only an administrator, an authorized laboratory operator, or the assigned doctor can open this report.",
  );
}

function assertAttachedReport(order, patientId) {
  if (order?.status === "cancelled") {
    throw new HttpError(409, "A report for a cancelled laboratory order cannot be opened.");
  }
  const reportStoragePath = String(order?.reportStoragePath || "").trim();
  if (
    !reportStoragePath
  ) {
    throw new HttpError(409, "No securely attached report is available for this laboratory order.");
  }
  return validateLabReportPath(reportStoragePath, patientId);
}

export async function recordLabReportAccess(
  env,
  body,
  authenticatedStaff,
  database = DEFAULT_DATABASE,
) {
  const input = normalizeLabReportAccessRequest(body);
  const staffPath = `staff/${authenticatedStaff?.uid || "invalid"}`;
  const staffDocument = validDocumentId(authenticatedStaff?.uid)
    ? await database.getDocument(env, staffPath)
    : null;
  const actor = currentActor(authenticatedStaff, staffDocument);

  const orderPath = `labOrders/${input.labOrderId}`;
  const orderDocument = await database.getDocument(env, orderPath);
  if (!orderDocument) {
    throw new HttpError(404, "This laboratory order could not be found.");
  }

  const patientId = String(orderDocument.data.patientId || "").trim();
  if (!validDocumentId(patientId)) {
    throw new HttpError(409, "This laboratory order is not linked to a valid patient record.");
  }

  const patientPath = `patients/${patientId}`;
  const patientDocument = assertActivePatientDocument(
    await database.getDocument(env, patientPath),
    {
      missingMessage: "The patient record linked to this laboratory order no longer exists.",
      archivedMessage: "The patient record linked to this laboratory order is archived.",
    },
  );
  assertLabReportReadAccess(actor, patientDocument.data);
  const storagePath = assertAttachedReport(orderDocument.data, patientId);

  const now = new Date();
  const auditId = crypto.randomUUID();
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, staffPath, staffDocument.updateTime),
    database.verifyDocumentWrite(env, orderPath, orderDocument.updateTime),
    database.verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
    database.createDocumentWrite(env, `auditLogs/${auditId}`, {
      eventType: ACTION_EVENTS[input.action],
      category: "lab_report",
      labOrderId: input.labOrderId,
      patientId,
      action: input.action,
      outcome: "authorized",
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      createdAt: now,
    }),
  ]);

  return {
    recorded: true,
    action: input.action,
    patientId,
    storagePath,
  };
}
