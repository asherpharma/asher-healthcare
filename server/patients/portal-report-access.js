import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";
import { authorizedPortalGrant } from "./portal-access.js";
import { validateLabReportPath } from "../storage/report-objects.js";

const ACTION_EVENTS = Object.freeze({
  download: "patient_portal.report_download_authorized",
  print: "patient_portal.report_print_authorized",
});

const DEFAULT_DATABASE = {
  commitWrites,
  createDocumentWrite,
  getDocument,
  verifyDocumentWrite,
};

function cleanText(value, maximum = 128) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function normalizePortalReportRequest(body = {}) {
  const patientId = cleanText(body?.patientId);
  const reportId = cleanText(body?.reportId);
  const action = cleanText(body?.action, 16).toLowerCase();
  if (!validDocumentId(patientId) || !validDocumentId(reportId) || !Object.hasOwn(ACTION_EVENTS, action)) {
    throw new HttpError(404, "This patient document is not available.");
  }
  return { patientId, reportId, action };
}

export async function recordPortalReportAccess(
  env,
  body,
  account,
  {
    database = DEFAULT_DATABASE,
    grantAuthorizer = authorizedPortalGrant,
    audit = true,
  } = {},
) {
  const input = normalizePortalReportRequest(body);
  const grant = await grantAuthorizer(env, account, input.patientId, "reports");
  const accountPath = `patientAccounts/${account.uid}`;
  const grantPath = `${accountPath}/grants/${grant.id}`;
  const patientPath = `patients/${input.patientId}`;
  const reportPath = `${patientPath}/reports/${input.reportId}`;
  const [accountDocument, grantDocument, patientDocument, reportDocument] = await Promise.all([
    database.getDocument(env, accountPath),
    database.getDocument(env, grantPath),
    database.getDocument(env, patientPath),
    database.getDocument(env, reportPath),
  ]);
  const expiry = grantDocument?.data?.expiresAt ? Date.parse(String(grantDocument.data.expiresAt)) : Number.POSITIVE_INFINITY;
  const review = grantDocument?.data?.reviewAt ? Date.parse(String(grantDocument.data.reviewAt)) : Number.POSITIVE_INFINITY;
  const now = new Date();
  const recentAuthentication = Number.isFinite(account.authenticationTime)
    && now.getTime() - account.authenticationTime <= 30 * 60 * 1000;
  if (
    !accountDocument
    || accountDocument.data.uid !== account.uid
    || String(accountDocument.data.email || "").trim().toLowerCase() !== String(account.email || "").trim().toLowerCase()
    || accountDocument.data.status !== "active"
    || !grantDocument
    || grantDocument.data.status !== "active"
    || grantDocument.data.patientId !== input.patientId
    || !Array.isArray(grantDocument.data.scopes)
    || !grantDocument.data.scopes.includes("reports")
    || (!Number.isFinite(expiry) && expiry !== Number.POSITIVE_INFINITY)
    || (!Number.isFinite(review) && review !== Number.POSITIVE_INFINITY)
    || expiry <= now.getTime()
    || review <= now.getTime()
    || !recentAuthentication
    || !patientDocument
    || patientDocument.data.archived === true
    || !reportDocument
  ) {
    throw new HttpError(404, "This patient document is not available.");
  }
  const storagePath = validateLabReportPath(reportDocument.data.storagePath, input.patientId);
  if (audit) await database.commitWrites(env, [
    database.verifyDocumentWrite(env, accountPath, accountDocument.updateTime),
    database.verifyDocumentWrite(env, grantPath, grantDocument.updateTime),
    database.verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
    database.verifyDocumentWrite(env, reportPath, reportDocument.updateTime),
    database.createDocumentWrite(env, `patientAccessAudit/${crypto.randomUUID()}`, {
      eventType: ACTION_EVENTS[input.action],
      category: "patient_access",
      actorUid: account.uid,
      actorRole: "patient_account",
      accountUid: account.uid,
      grantId: grant.id,
      patientId: input.patientId,
      reportId: input.reportId,
      action: input.action,
      outcome: "authorized",
      createdAt: now,
    }),
  ]);
  return { action: input.action, patientId: input.patientId, storagePath };
}
