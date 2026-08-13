import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";
import { authorizedPortalGrant } from "./portal-access.js";

const DOCUMENTS = Object.freeze({
  prescription: {
    scope: "prescriptions",
    path(patientId, documentId) { return `patients/${patientId}/prescriptions/${documentId}`; },
    project(data, documentId) {
      return {
        id: documentId,
        prescribedDate: String(data.prescribedDate || ""),
        doctorName: String(data.doctorName || ""),
        medicines: Array.isArray(data.medicines) ? data.medicines.slice(0, 20).map((medicine) => ({
          name: String(medicine?.name || ""),
          dose: String(medicine?.dose || ""),
          frequency: String(medicine?.frequency || ""),
          duration: String(medicine?.duration || ""),
          instructions: String(medicine?.instructions || ""),
        })) : [],
        advice: String(data.advice || ""),
      };
    },
  },
  receipt: {
    scope: "billing",
    path(_patientId, documentId) { return `invoices/${documentId}`; },
    project(data, documentId) {
      return {
        id: documentId,
        invoiceNumber: String(data.invoiceNumber || ""),
        items: Array.isArray(data.items) ? data.items.slice(0, 50).map((item) => ({
          description: String(item?.description || "Clinic service"),
          quantity: Number(item?.quantity || 0),
          unitPrice: Number(item?.unitPrice || 0),
          amount: Number(item?.amount || 0),
        })) : [],
        subtotal: Number(data.subtotal || 0),
        discount: Number(data.discount || 0),
        total: Number(data.total || 0),
        amountPaid: Number(data.amountPaid || 0),
        balance: Number(data.balance || 0),
        paymentStatus: String(data.paymentStatus || ""),
        paymentMethod: String(data.paymentMethod || ""),
        createdAt: String(data.createdAt || ""),
      };
    },
  },
});

const DEFAULT_DATABASE = { commitWrites, createDocumentWrite, getDocument, verifyDocumentWrite };

function cleanText(value, maximum = 128) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function normalizePortalDocumentRequest(body = {}) {
  const patientId = cleanText(body?.patientId);
  const documentId = cleanText(body?.documentId);
  const documentType = cleanText(body?.documentType, 24);
  const action = cleanText(body?.action, 16).toLowerCase();
  if (
    !validDocumentId(patientId)
    || !validDocumentId(documentId)
    || !Object.hasOwn(DOCUMENTS, documentType)
    || !["print", "download"].includes(action)
  ) {
    throw new HttpError(404, "This patient document is not available.");
  }
  return { patientId, documentId, documentType, action };
}

function validFuture(value, now) {
  if (!value) return true;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export async function recordPortalDocumentAccess(
  env,
  body,
  account,
  { database = DEFAULT_DATABASE, grantAuthorizer = authorizedPortalGrant } = {},
) {
  const input = normalizePortalDocumentRequest(body);
  const configuration = DOCUMENTS[input.documentType];
  const grant = await grantAuthorizer(env, account, input.patientId, configuration.scope);
  const accountPath = `patientAccounts/${account.uid}`;
  const grantPath = `${accountPath}/grants/${grant.id}`;
  const patientPath = `patients/${input.patientId}`;
  const recordPath = configuration.path(input.patientId, input.documentId);
  const [accountDocument, grantDocument, patientDocument, recordDocument] = await Promise.all([
    database.getDocument(env, accountPath),
    database.getDocument(env, grantPath),
    database.getDocument(env, patientPath),
    database.getDocument(env, recordPath),
  ]);
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
    || !grantDocument.data.scopes.includes(configuration.scope)
    || !validFuture(grantDocument.data.expiresAt, now)
    || !validFuture(grantDocument.data.reviewAt, now)
    || !patientDocument
    || patientDocument.data.archived === true
    || !recordDocument
    || (input.documentType === "receipt" && recordDocument.data.patientId !== input.patientId)
    || !recentAuthentication
  ) {
    throw new HttpError(404, "This patient document is not available.");
  }
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, accountPath, accountDocument.updateTime),
    database.verifyDocumentWrite(env, grantPath, grantDocument.updateTime),
    database.verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
    database.verifyDocumentWrite(env, recordPath, recordDocument.updateTime),
    database.createDocumentWrite(env, `patientAccessAudit/${crypto.randomUUID()}`, {
      eventType: `patient_portal.${input.documentType}_${input.action}_authorized`,
      category: "patient_access",
      actorUid: account.uid,
      actorRole: "patient_account",
      accountUid: account.uid,
      grantId: grant.id,
      patientId: input.patientId,
      documentId: input.documentId,
      documentType: input.documentType,
      action: input.action,
      outcome: "authorized",
      createdAt: now,
    }),
  ]);
  return { document: configuration.project(recordDocument.data, input.documentId) };
}
