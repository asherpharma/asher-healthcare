import { doctorCanEditPatient } from "./profile.js";
import {
  assertActivePatientDocument,
  commitWrites,
  createDocumentWrite,
  getDocument,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";
import { validatePatientReportPath } from "../storage/report-objects.js";

const ACTION_EVENTS = Object.freeze({
  view: "patient_report.view_authorized",
  download: "patient_report.download_authorized",
  print: "patient_report.print_authorized",
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

export function normalizePatientReportAccessRequest(body = {}) {
  const patientId = cleanText(body.patientId, 128);
  const reportId = cleanText(body.reportId, 128);
  if (!validDocumentId(patientId) || !validDocumentId(reportId)) {
    throw new HttpError(400, "Choose a valid patient report.");
  }
  const action = cleanText(body.action, 16).toLowerCase();
  if (!Object.hasOwn(ACTION_EVENTS, action)) {
    throw new HttpError(400, "Choose view, download, or print for this report.");
  }
  return { patientId, reportId, action };
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
  };
}

export function assertPatientReportReadAccess(actor, patient) {
  if (actor?.role === "admin") return actor;
  if (doctorCanEditPatient(actor, patient)) return actor;
  throw new HttpError(
    403,
    "Only an administrator or the doctor currently assigned to this patient can open the report.",
  );
}

export async function recordPatientReportAccess(
  env,
  body,
  authenticatedStaff,
  database = DEFAULT_DATABASE,
) {
  const input = normalizePatientReportAccessRequest(body);
  const staffPath = `staff/${authenticatedStaff?.uid || "invalid"}`;
  const staffDocument = validDocumentId(authenticatedStaff?.uid)
    ? await database.getDocument(env, staffPath)
    : null;
  const actor = currentActor(authenticatedStaff, staffDocument);

  const patientPath = `patients/${input.patientId}`;
  const patientDocument = assertActivePatientDocument(
    await database.getDocument(env, patientPath),
    {
      missingStatus: 404,
      missingMessage: "This patient record could not be found.",
      archivedMessage: "This patient record is archived.",
    },
  );
  assertPatientReportReadAccess(actor, patientDocument.data);

  const reportPath = `${patientPath}/reports/${input.reportId}`;
  const reportDocument = await database.getDocument(env, reportPath);
  if (!reportDocument) {
    throw new HttpError(404, "This patient report could not be found.");
  }
  const storagePath = validatePatientReportPath(
    reportDocument.data?.storagePath,
    input.patientId,
  );

  const now = new Date();
  const auditId = crypto.randomUUID();
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, staffPath, staffDocument.updateTime),
    database.verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
    database.verifyDocumentWrite(env, reportPath, reportDocument.updateTime),
    database.createDocumentWrite(env, `auditLogs/${auditId}`, {
      eventType: ACTION_EVENTS[input.action],
      category: "patient_report",
      patientId: input.patientId,
      reportId: input.reportId,
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
    patientId: input.patientId,
    storagePath,
  };
}
