import {
  assertActivePatientDocument,
  commitWrites,
  createDocumentWrite,
  documentName,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";
import { doctorCanEditPatient } from "../patients/profile.js";
import {
  labReportDocumentId,
  labReportDocumentPath,
  labReportStoragePath,
  legacyLabReportDocumentPath,
} from "./report-identity.js";
import { REPORT_FINALIZER_STORAGE } from "../storage/report-finalizer-objects.js";
import {
  assertIntentMatchesRequest,
  assertIntentMatchesVerifiedObject,
  assertDiscardedFinalizationIntent,
  assertValidFinalizationIntent,
  finalizationIntentPath,
  finalizationRequestFingerprint,
  preparedFinalizationIntent,
  sha256Hex,
} from "./finalization-intents.js";
import {
  assertCurrentAyusLink,
  assertUnattachedLabOrder,
  completedFinalizationWrites,
} from "./finalization-records.js";

const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const REPORT_TYPES = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});
const SOURCE_PROVIDERS = new Set(["ayuslab", "manual"]);
const STALE_ATTEMPT_FIELDS = Object.freeze([
  "promotionStartedBy",
  "promotionStartedAt",
  "promotionLeaseExpiresAt",
  "permanentGeneration",
  "promotedBy",
  "promotedAt",
  "discardGeneration",
  "discardObjectWasPresent",
  "discardReasonCode",
  "discardRequestedBy",
  "discardRequestedAt",
  "discardedBy",
  "discardedAt",
  "completedBy",
  "completedAt",
]);

const DEFAULT_DATABASE = Object.freeze({
  getDocument,
  commitWrites,
  createDocumentWrite,
  updateDocumentWrite,
  verifyDocumentWrite,
});

function cleanText(value, maximumLength) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function genericReportFileName(value, extension) {
  const rawFileName = typeof value === "string" ? value.trim() : "";
  if (Array.from(rawFileName).length > 100) {
    throw new HttpError(400, `Use a generic report filename ending in .${extension}.`);
  }
  const fileName = rawFileName.toLowerCase();
  if (
    !/^(?:lab|medical)-report(?:-[a-z0-9]{1,16})?[.](?:pdf|jpg|jpeg|png|webp)$/u.test(fileName)
    || !fileName.endsWith(`.${extension}`)
    || fileName.includes("..")
  ) {
    throw new HttpError(400, `Use a generic report filename ending in .${extension}.`);
  }
  return `lab-report.${extension}`;
}

export function normalizeLabReportFinalizationRequest(body = {}) {
  const labOrderId = typeof body.labOrderId === "string" ? body.labOrderId.trim() : "";
  if (!validDocumentId(labOrderId)) {
    throw new HttpError(400, "Choose a valid laboratory order.");
  }

  const stagedStoragePath = typeof body.stagedStoragePath === "string"
    ? body.stagedStoragePath.trim()
    : "";
  if (
    stagedStoragePath.length > 1_500
    ||
    !/^pending-reports\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{8,100}-report[.](?:pdf|jpg|jpeg|png|webp)$/u.test(stagedStoragePath)
    || stagedStoragePath.includes("..")
  ) {
    throw new HttpError(400, "Choose a report uploaded through the secure staging area.");
  }

  const contentType = cleanText(body.contentType, 100).toLowerCase();
  const extension = REPORT_TYPES[contentType];
  if (!extension) {
    throw new HttpError(400, "Choose a PDF, JPEG, PNG, or WebP report.");
  }
  const stagedExtension = stagedStoragePath.split(".").at(-1)?.toLowerCase() || "";
  if (
    (contentType === "image/jpeg" && !["jpg", "jpeg"].includes(stagedExtension))
    || (contentType !== "image/jpeg" && stagedExtension !== extension)
  ) {
    throw new HttpError(400, "The staged report extension does not match its file type.");
  }
  const fileName = genericReportFileName(body.fileName, extension);
  const size = body.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > MAX_REPORT_BYTES) {
    throw new HttpError(400, "The report must be 10 MB or smaller.");
  }

  const sourceProvider = cleanText(body.sourceProvider, 20).toLowerCase();
  if (!SOURCE_PROVIDERS.has(sourceProvider)) {
    throw new HttpError(400, "Choose AyusLab or manual report import.");
  }
  const externalLinkVersion = body.externalLinkVersion == null
    ? null
    : body.externalLinkVersion;
  if (
    (externalLinkVersion !== null && (
      typeof externalLinkVersion !== "number"
      || !Number.isSafeInteger(externalLinkVersion)
      || externalLinkVersion < 1
    ))
    || (sourceProvider === "ayuslab" && externalLinkVersion === null)
    || (sourceProvider === "manual" && externalLinkVersion !== null)
  ) {
    throw new HttpError(400, "The external laboratory link version is invalid.");
  }
  if (body.resultSummary != null && typeof body.resultSummary !== "string") {
    throw new HttpError(400, "Enter the clinical result summary as text.");
  }
  const rawResultSummary = body.resultSummary || "";
  if (Array.from(rawResultSummary).length > 5_000) {
    throw new HttpError(400, "Keep the clinical result summary within 5,000 characters.");
  }
  const resultSummary = rawResultSummary.trim();

  return {
    labOrderId,
    stagedStoragePath,
    fileName,
    contentType,
    extension,
    size,
    sourceProvider,
    externalLinkVersion,
    resultSummary,
  };
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

function verifyMissingDocumentWrite(env, path) {
  return {
    verify: documentName(env, path),
    currentDocument: { exists: false },
  };
}

async function assertDiscardedObjectAbsent(env, intent, storage) {
  try {
    await storage.fetchImmutableReportObject(env, intent.destinationPath);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return;
    throw error;
  }
  throw new HttpError(
    409,
    "The discarded report object still exists and must be reconciled before a new attempt.",
  );
}

function reopenedFinalizationAudit({ actor, intent, nextAttemptNumber, now }) {
  return {
    eventType: "lab_report.finalization_reopened",
    category: "lab_report",
    action: "reopened",
    labOrderId: intent.labOrderId,
    patientId: intent.patientId,
    finalizationIntentId: intent.labOrderId,
    previousAttemptNumber: Number(intent.attemptNumber || 1),
    nextAttemptNumber,
    previousDiscardReasonCode: intent.discardReasonCode,
    previousDiscardedBy: intent.discardedBy,
    previousDiscardedAt: intent.discardedAt,
    actorUid: actor.uid,
    actorName: actor.displayName,
    actorRole: actor.role,
    createdAt: now,
  };
}

export function assertLabReportFinalizationAccess(actor, patient, sourceProvider) {
  if (actor?.role === "admin") return actor;
  if (actor?.role === "reception") {
    if (sourceProvider === "ayuslab" && actor.labReportOperator !== true) {
      throw new HttpError(403, "An administrator must grant AyusLab report access first.");
    }
    return actor;
  }
  if (actor?.role === "doctor" && doctorCanEditPatient(actor, patient)) {
    if (sourceProvider === "ayuslab" && actor.labReportOperator !== true) {
      throw new HttpError(403, "An administrator must grant AyusLab report access first.");
    }
    return actor;
  }
  throw new HttpError(403, "This patient is not currently assigned to your doctor account.");
}

function hasPrefix(bytes, prefix) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

export function verifyReportBytes(bytes, contentType) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_REPORT_BYTES) {
    throw new HttpError(409, "The staged report file is empty or too large.");
  }
  const valid = (
    (contentType === "application/pdf" && hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    || (contentType === "image/jpeg" && hasPrefix(bytes, [0xff, 0xd8, 0xff]))
    || (contentType === "image/png" && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || (
      contentType === "image/webp"
      && hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
      && bytes.byteLength >= 12
      && hasPrefix(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
    )
  );
  if (!valid) {
    throw new HttpError(409, "The report contents do not match the declared file type.");
  }
  return bytes;
}

export async function finalizeLabReport(
  env,
  body,
  authenticatedStaff,
  {
    database = DEFAULT_DATABASE,
    storage = REPORT_FINALIZER_STORAGE,
    now = new Date(),
  } = {},
) {
  const input = normalizeLabReportFinalizationRequest(body);
  const staffPath = `staff/${authenticatedStaff?.uid || "invalid"}`;
  const staffDocument = validDocumentId(authenticatedStaff?.uid)
    ? await database.getDocument(env, staffPath)
    : null;
  const actor = currentActor(authenticatedStaff, staffDocument);

  const orderPath = `labOrders/${input.labOrderId}`;
  const orderDocument = await database.getDocument(env, orderPath);
  if (!orderDocument) throw new HttpError(404, "This laboratory order could not be found.");

  const patientId = typeof orderDocument.data.patientId === "string"
    ? orderDocument.data.patientId.trim()
    : "";
  if (!validDocumentId(patientId)) {
    throw new HttpError(409, "This laboratory order is not linked to a valid patient record.");
  }
  if (!input.stagedStoragePath.startsWith(`pending-reports/${patientId}/`)) {
    throw new HttpError(409, "The staged report does not belong to this patient.");
  }

  const patientPath = `patients/${patientId}`;
  const patientDocument = assertActivePatientDocument(
    await database.getDocument(env, patientPath),
    {
      missingMessage: "The patient record linked to this laboratory order no longer exists.",
      archivedMessage: "Restore this patient record before attaching a laboratory report.",
    },
  );
  assertLabReportFinalizationAccess(actor, patientDocument.data, input.sourceProvider);
  if (actor.role === "reception" && input.resultSummary) {
    throw new HttpError(403, "Reception staff cannot author a clinical result summary.");
  }

  const reportPath = labReportDocumentPath(patientId, input.labOrderId);
  const reportDocument = await database.getDocument(env, reportPath);
  const legacyReportDocument = await database.getDocument(
    env,
    legacyLabReportDocumentPath(patientId, input.labOrderId),
  );
  const intentPath = finalizationIntentPath(input.labOrderId);
  let intentDocument = await database.getDocument(env, intentPath);
  let intent = intentDocument
    ? assertValidFinalizationIntent(intentDocument, input.labOrderId)
    : null;
  const destinationPath = labReportStoragePath(
    patientId,
    input.labOrderId,
    input.extension,
  );
  let discardedAttempt = null;
  if (intent) {
    if (intent.status === "discarded") {
      discardedAttempt = assertDiscardedFinalizationIntent(intent);
    } else {
      assertIntentMatchesRequest(intent, { input, patientId, destinationPath }, actor);
    }
    if (!discardedAttempt && intent.status === "completed") {
      if (
        !reportDocument
        || legacyReportDocument
        || reportDocument.data?.finalizationIntentId !== input.labOrderId
        || reportDocument.data?.storagePath !== intent.destinationPath
        || orderDocument.data?.reportFinalizationIntentId !== input.labOrderId
        || orderDocument.data?.reportStoragePath !== intent.destinationPath
      ) {
        throw new HttpError(
          409,
          "This completed report finalization needs administrator review.",
        );
      }
      return {
        finalized: true,
        alreadyFinalized: true,
        labOrderId: input.labOrderId,
        reportId: labReportDocumentId(input.labOrderId),
        contentType: intent.contentType,
        size: intent.size,
        sourceProvider: intent.sourceProvider,
        stagingCleaned: true,
      };
    }
    if (!discardedAttempt && !["prepared", "promoting", "promoted"].includes(intent.status)) {
      throw new HttpError(
        409,
        "This report finalization is under administrator review and cannot continue here.",
      );
    }
  }
  assertUnattachedLabOrder(orderDocument.data);
  if (reportDocument || legacyReportDocument) {
    throw new HttpError(409, "A report is already attached to this laboratory order.");
  }

  let externalLinkDocument = null;
  if (input.sourceProvider === "ayuslab") {
    externalLinkDocument = assertCurrentAyusLink(
      await database.getDocument(env, `externalLabLinks/ayuslab_${input.labOrderId}`),
      { ...input, patientId },
    );
  }

  const staged = await storage.fetchStagedReportObject(env, input.stagedStoragePath);
  if (
    staged.size !== input.size
    || staged.contentType !== input.contentType
    || !/^\d+$/u.test(String(staged.generation || ""))
    || staged.metadata?.patientId !== patientId
    || staged.metadata?.labOrderId !== input.labOrderId
    || !validDocumentId(staged.metadata?.uploadedBy)
  ) {
    throw new HttpError(409, "The staged report metadata changed. Choose the file again.");
  }
  const uploadedBy = staged.metadata.uploadedBy;
  if (uploadedBy !== actor.uid && actor.role !== "admin") {
    throw new HttpError(
      403,
      "For safety, the staff member who selected this report must finish attaching it.",
    );
  }
  verifyReportBytes(staged.bytes, input.contentType);

  const contentSha256 = await sha256Hex(staged.bytes);
  const requestFingerprint = await finalizationRequestFingerprint({
    input,
    patientId,
    stagedGeneration: staged.generation,
    destinationPath,
    uploadedBy,
    contentSha256,
  });
  if (discardedAttempt) {
    if (input.stagedStoragePath === intent.stagedStoragePath) {
      throw new HttpError(
        409,
        "Choose a newly staged report file before reopening this discarded attempt.",
      );
    }
    await assertDiscardedObjectAbsent(env, intent, storage);
    const nextAttemptNumber = discardedAttempt.attemptNumber + 1;
    const reopenedIntent = preparedFinalizationIntent({
      input,
      patientId,
      stagedGeneration: staged.generation,
      destinationPath,
      uploadedBy,
      contentSha256,
      requestFingerprint,
      actor,
      now,
      attemptNumber: nextAttemptNumber,
    });
    const reopenedData = {
      ...reopenedIntent,
      reopenedFromAttempt: discardedAttempt.attemptNumber,
      reopenedBy: actor.uid,
      reopenedAt: now,
    };
    const reopenWrites = [
      database.verifyDocumentWrite(env, staffPath, staffDocument.updateTime),
      database.verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
      database.verifyDocumentWrite(env, orderPath, orderDocument.updateTime),
      verifyMissingDocumentWrite(env, reportPath),
      verifyMissingDocumentWrite(
        env,
        legacyLabReportDocumentPath(patientId, input.labOrderId),
      ),
    ];
    if (externalLinkDocument) {
      reopenWrites.push(database.verifyDocumentWrite(
        env,
        `externalLabLinks/ayuslab_${input.labOrderId}`,
        externalLinkDocument.updateTime,
      ));
    }
    reopenWrites.push(
      database.updateDocumentWrite(
        env,
        intentPath,
        reopenedData,
        [...Object.keys(reopenedData), ...STALE_ATTEMPT_FIELDS],
        intentDocument.updateTime,
      ),
      database.createDocumentWrite(
        env,
        `auditLogs/${crypto.randomUUID()}`,
        reopenedFinalizationAudit({ actor, intent, nextAttemptNumber, now }),
      ),
    );
    await database.commitWrites(env, reopenWrites);
    intentDocument = await database.getDocument(env, intentPath);
    intent = assertValidFinalizationIntent(intentDocument, input.labOrderId);
    assertIntentMatchesRequest(intent, { input, patientId, destinationPath }, actor);
    assertIntentMatchesVerifiedObject(intent, {
      stagedGeneration: staged.generation,
      uploadedBy,
      contentSha256,
      requestFingerprint,
    });
  } else if (intent) {
    assertIntentMatchesVerifiedObject(intent, {
      stagedGeneration: staged.generation,
      uploadedBy,
      contentSha256,
      requestFingerprint,
    });
  } else {
    const preparedIntent = preparedFinalizationIntent({
      input,
      patientId,
      stagedGeneration: staged.generation,
      destinationPath,
      uploadedBy,
      contentSha256,
      requestFingerprint,
      actor,
      now,
    });
    const preparationWrites = [
      database.verifyDocumentWrite(env, staffPath, staffDocument.updateTime),
      database.verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
      database.verifyDocumentWrite(env, orderPath, orderDocument.updateTime),
    ];
    if (externalLinkDocument) {
      preparationWrites.push(database.verifyDocumentWrite(
        env,
        `externalLabLinks/ayuslab_${input.labOrderId}`,
        externalLinkDocument.updateTime,
      ));
    }
    preparationWrites.push(database.createDocumentWrite(env, intentPath, preparedIntent));
    await database.commitWrites(env, preparationWrites);
    intentDocument = await database.getDocument(env, intentPath);
    intent = assertValidFinalizationIntent(intentDocument, input.labOrderId);
    assertIntentMatchesRequest(intent, { input, patientId, destinationPath }, actor);
    assertIntentMatchesVerifiedObject(intent, {
      stagedGeneration: staged.generation,
      uploadedBy,
      contentSha256,
      requestFingerprint,
    });
  }

  if (intent.status === "prepared") {
    const promotionStartedAt = now;
    const promotionLeaseExpiresAt = new Date(now.getTime() + 15 * 60 * 1_000);
    const promotionWrites = [
      database.verifyDocumentWrite(env, staffPath, staffDocument.updateTime),
      database.verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
      database.verifyDocumentWrite(env, orderPath, orderDocument.updateTime),
    ];
    if (externalLinkDocument) {
      promotionWrites.push(database.verifyDocumentWrite(
        env,
        `externalLabLinks/ayuslab_${input.labOrderId}`,
        externalLinkDocument.updateTime,
      ));
    }
    promotionWrites.push(database.updateDocumentWrite(
      env,
      intentPath,
      {
        status: "promoting",
        promotionStartedBy: actor.uid,
        promotionStartedAt,
        promotionLeaseExpiresAt,
        updatedAt: promotionStartedAt,
      },
      [
        "status",
        "promotionStartedBy",
        "promotionStartedAt",
        "promotionLeaseExpiresAt",
        "updatedAt",
      ],
      intentDocument.updateTime,
    ));
    await database.commitWrites(env, promotionWrites);
    intentDocument = await database.getDocument(env, intentPath);
    intent = assertValidFinalizationIntent(intentDocument, input.labOrderId);
    if (intent.status !== "promoting") {
      throw new HttpError(409, "The report promotion state changed. Review it and try again.");
    }
  }

  const permanentObject = await storage.createImmutableReportObject(env, destinationPath, {
    bytes: staged.bytes,
    contentType: input.contentType,
  });
  if (intent.status === "promoted") {
    if (String(intent.permanentGeneration || "") !== String(permanentObject.generation)) {
      throw new HttpError(409, "The promoted report generation needs administrator review.");
    }
  } else {
    await database.commitWrites(env, [
      database.updateDocumentWrite(
        env,
        intentPath,
        {
          status: "promoted",
          permanentGeneration: String(permanentObject.generation),
          promotedBy: actor.uid,
          promotedAt: now,
          updatedAt: now,
        },
        [
          "status",
          "permanentGeneration",
          "promotedBy",
          "promotedAt",
          "updatedAt",
        ],
        intentDocument.updateTime,
      ),
    ]);
    intentDocument = await database.getDocument(env, intentPath);
    intent = assertValidFinalizationIntent(intentDocument, input.labOrderId);
    if (
      intent.status !== "promoted"
      || String(intent.permanentGeneration || "") !== String(permanentObject.generation)
    ) {
      throw new HttpError(409, "The promoted report generation needs administrator review.");
    }
  }
  const completion = completedFinalizationWrites({
    env,
    database,
    intentDocument,
    intent,
    actor,
    staffDocument,
    patientDocument,
    orderDocument,
    externalLinkDocument,
    permanentGeneration: permanentObject.generation,
    now,
  });
  await database.commitWrites(env, completion.writes);

  let stagingCleaned = true;
  try {
    await storage.deleteStagedReportObject(
      env,
      input.stagedStoragePath,
      String(staged.generation),
    );
  } catch {
    // The permanent report and database pointer are authoritative. A bucket
    // lifecycle policy provides a second cleanup layer for abandoned staging.
    stagingCleaned = false;
  }

  return {
    finalized: true,
    alreadyFinalized: false,
    labOrderId: input.labOrderId,
    reportId: labReportDocumentId(input.labOrderId),
    contentType: input.contentType,
    size: input.size,
    sourceProvider: input.sourceProvider,
    stagingCleaned,
  };
}
