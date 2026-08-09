import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";

const LAB_REPORT_DOCUMENT_PREFIX = "lab-";
const LAB_REPORT_OBJECT_PREFIX = "lab-reports";
const LAB_REPORT_EXTENSIONS = new Set(["pdf", "jpg", "png", "webp"]);

function requireDocumentId(value, label) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!validDocumentId(id)) {
    throw new HttpError(409, `The ${label} is invalid.`);
  }
  return id;
}

/**
 * Server-owned report documents use a reserved identity that browser-created
 * clinical reports cannot claim. The lab-order API remains keyed by the
 * original labOrderId; callers do not need to know this internal document ID.
 */
export function labReportDocumentId(labOrderId) {
  return `${LAB_REPORT_DOCUMENT_PREFIX}${requireDocumentId(labOrderId, "laboratory order")}`;
}

export function labReportDocumentPath(patientId, labOrderId) {
  return `patients/${requireDocumentId(patientId, "patient record")}/reports/${labReportDocumentId(labOrderId)}`;
}

/** Existing production records created before the reserved-ID migration. */
export function legacyLabReportDocumentPath(patientId, labOrderId) {
  return `patients/${requireDocumentId(patientId, "patient record")}/reports/${requireDocumentId(labOrderId, "laboratory order")}`;
}

/**
 * Finalized laboratory bytes live outside the browser-writable reports/
 * namespace. Firebase Storage rules deny all browser access to this prefix;
 * only the condition-scoped server service accounts can create or read it.
 */
export function labReportStoragePath(patientId, labOrderId, extension) {
  const normalizedExtension = typeof extension === "string"
    ? extension.trim().toLowerCase()
    : "";
  if (!LAB_REPORT_EXTENSIONS.has(normalizedExtension)) {
    throw new HttpError(409, "The laboratory report file type is invalid.");
  }
  return `${LAB_REPORT_OBJECT_PREFIX}/${requireDocumentId(patientId, "patient record")}/${requireDocumentId(labOrderId, "laboratory order")}.${normalizedExtension}`;
}

export const LAB_REPORT_IDENTITY = Object.freeze({
  documentPrefix: LAB_REPORT_DOCUMENT_PREFIX,
  objectPrefix: LAB_REPORT_OBJECT_PREFIX,
});
