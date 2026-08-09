import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";

export const FINALIZATION_INTENT_SCHEMA_VERSION = 1;
export const FINALIZATION_INTENT_STATUSES = new Set([
  "prepared",
  "promoting",
  "promoted",
  "discarding",
  "completed",
  "discarded",
]);

const HEX_DIGEST = /^[a-f0-9]{64}$/u;
const GENERATION = /^\d+$/u;

function cleanText(value, maximumLength = 5_000) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function finalizationIntentPath(labOrderId) {
  if (!validDocumentId(labOrderId)) {
    throw new HttpError(400, "Choose a valid laboratory order.");
  }
  return `labReportFinalizationIntents/${labOrderId}`;
}

export async function sha256Hex(value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  if (!(bytes instanceof Uint8Array)) {
    throw new HttpError(500, "The report integrity fingerprint could not be created.");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function finalizationRequestFingerprint({
  input,
  patientId,
  stagedGeneration,
  destinationPath,
  uploadedBy,
  contentSha256,
}) {
  return sha256Hex(JSON.stringify([
    FINALIZATION_INTENT_SCHEMA_VERSION,
    input.labOrderId,
    patientId,
    input.stagedStoragePath,
    String(stagedGeneration),
    destinationPath,
    input.fileName,
    input.contentType,
    input.size,
    input.sourceProvider,
    input.externalLinkVersion || 0,
    input.resultSummary,
    uploadedBy,
    contentSha256,
  ]));
}

export function preparedFinalizationIntent({
  input,
  patientId,
  stagedGeneration,
  destinationPath,
  uploadedBy,
  contentSha256,
  requestFingerprint,
  actor,
  now,
  attemptNumber = 1,
}) {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new HttpError(500, "The report finalization attempt number is invalid.");
  }
  return {
    schemaVersion: FINALIZATION_INTENT_SCHEMA_VERSION,
    attemptNumber,
    status: "prepared",
    labOrderId: input.labOrderId,
    patientId,
    stagedStoragePath: input.stagedStoragePath,
    stagedGeneration: String(stagedGeneration),
    destinationPath,
    fileName: input.fileName,
    contentType: input.contentType,
    size: input.size,
    sourceProvider: input.sourceProvider,
    externalLinkVersion: input.externalLinkVersion || 0,
    resultSummary: input.resultSummary,
    uploadedBy,
    preparedBy: actor.uid,
    preparedByRole: actor.role,
    contentSha256,
    requestFingerprint,
    preparedAt: now,
    updatedAt: now,
  };
}

export function assertValidFinalizationIntent(intentDocument, labOrderId) {
  const intent = intentDocument?.data;
  if (
    !intentDocument
    || !intent
    || intent.schemaVersion !== FINALIZATION_INTENT_SCHEMA_VERSION
    || (
      intent.attemptNumber != null
      && (!Number.isSafeInteger(intent.attemptNumber) || intent.attemptNumber < 1)
    )
    || intent.labOrderId !== labOrderId
    || !validDocumentId(intent.labOrderId)
    || !validDocumentId(intent.patientId)
    || !validDocumentId(intent.uploadedBy)
    || !validDocumentId(intent.preparedBy)
    || !FINALIZATION_INTENT_STATUSES.has(intent.status)
    || !GENERATION.test(String(intent.stagedGeneration || ""))
    || !HEX_DIGEST.test(String(intent.contentSha256 || ""))
    || !HEX_DIGEST.test(String(intent.requestFingerprint || ""))
    || typeof intent.stagedStoragePath !== "string"
    || typeof intent.destinationPath !== "string"
    || typeof intent.fileName !== "string"
    || typeof intent.contentType !== "string"
    || !Number.isSafeInteger(intent.size)
    || intent.size <= 0
    || intent.size > 10 * 1024 * 1024
    || !["ayuslab", "manual"].includes(intent.sourceProvider)
    || !Number.isSafeInteger(intent.externalLinkVersion)
    || intent.externalLinkVersion < 0
    || typeof intent.resultSummary !== "string"
    || Array.from(intent.resultSummary).length > 5_000
  ) {
    throw new HttpError(
      409,
      "This report finalization record needs administrator review before it can continue.",
    );
  }
  return intent;
}

function validRecordedTimestamp(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * A deterministic intent may be reopened only after the audited cleanup flow
 * has reached its terminal discarded state. Older schema-v1 intents did not
 * persist attemptNumber, so they are treated as attempt 1 during migration.
 */
export function assertDiscardedFinalizationIntent(intent) {
  const attemptNumber = intent?.attemptNumber == null ? 1 : intent.attemptNumber;
  if (
    intent?.status !== "discarded"
    || !Number.isSafeInteger(attemptNumber)
    || attemptNumber < 1
    || !validDocumentId(intent.discardedBy)
    || !validRecordedTimestamp(intent.discardedAt)
    || !validDocumentId(intent.discardRequestedBy)
    || !validRecordedTimestamp(intent.discardRequestedAt)
    || typeof intent.discardObjectWasPresent !== "boolean"
    || (
      intent.discardObjectWasPresent
      && !GENERATION.test(String(intent.discardGeneration || ""))
    )
  ) {
    throw new HttpError(
      409,
      "This discarded report attempt needs administrator review before it can be reopened.",
    );
  }
  // Re-run the fixed-code validator without accepting any free-form evidence.
  normalizedDiscardReason(intent.discardReasonCode);
  return { intent, attemptNumber };
}

export function assertIntentMatchesRequest(intent, expected, actor) {
  const mismatched = [
    [intent.labOrderId, expected.input.labOrderId],
    [intent.patientId, expected.patientId],
    [intent.stagedStoragePath, expected.input.stagedStoragePath],
    [intent.destinationPath, expected.destinationPath],
    [intent.fileName, expected.input.fileName],
    [intent.contentType, expected.input.contentType],
    [intent.size, expected.input.size],
    [intent.sourceProvider, expected.input.sourceProvider],
    [intent.externalLinkVersion, expected.input.externalLinkVersion || 0],
    [intent.resultSummary, expected.input.resultSummary],
  ].some(([left, right]) => left !== right);
  if (mismatched) {
    throw new HttpError(
      409,
      "A different report finalization request already exists for this laboratory order.",
    );
  }
  if (intent.uploadedBy !== actor.uid && actor.role !== "admin") {
    throw new HttpError(
      403,
      "For safety, the staff member who selected this report must finish attaching it.",
    );
  }
  return intent;
}

export function assertIntentMatchesVerifiedObject(intent, verified) {
  if (
    intent.stagedGeneration !== String(verified.stagedGeneration)
    || intent.uploadedBy !== verified.uploadedBy
    || intent.contentSha256 !== verified.contentSha256
    || intent.requestFingerprint !== verified.requestFingerprint
  ) {
    throw new HttpError(
      409,
      "The staged report does not match the prepared finalization record.",
    );
  }
  return intent;
}

export function redactedIntentResponse(intent, { object = null } = {}) {
  return {
    labOrderId: intent.labOrderId,
    patientId: intent.patientId,
    attemptNumber: Number(intent.attemptNumber || 1),
    status: intent.status,
    sourceProvider: intent.sourceProvider,
    contentType: intent.contentType,
    size: intent.size,
    uploadedBy: intent.uploadedBy,
    preparedBy: intent.preparedBy,
    preparedAt: intent.preparedAt || null,
    completedAt: intent.completedAt || null,
    discardedAt: intent.discardedAt || null,
    object: object
      ? {
          present: object.present === true,
          verified: object.verified === true,
          generation: object.generation || "",
        }
      : undefined,
  };
}

export function normalizedDiscardReason(value) {
  const reason = cleanText(value, 40).toLowerCase();
  const allowed = new Set([
    "wrong_file",
    "duplicate_upload",
    "order_cancelled",
    "patient_archived",
    "provider_link_changed",
    "other_verified",
  ]);
  if (!allowed.has(reason)) {
    throw new HttpError(400, "Choose a valid verified discard reason.");
  }
  return reason;
}
