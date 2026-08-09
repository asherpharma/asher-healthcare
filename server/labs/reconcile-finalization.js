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
import { REPORT_RECONCILIATION_STORAGE } from "../storage/report-finalizer-objects.js";
import {
  assertValidFinalizationIntent,
  finalizationIntentPath,
  normalizedDiscardReason,
  redactedIntentResponse,
  sha256Hex,
} from "./finalization-intents.js";
import {
  assertCurrentAyusLink,
  assertUnattachedLabOrder,
  completedFinalizationWrites,
} from "./finalization-records.js";
import {
  labReportDocumentPath,
  legacyLabReportDocumentPath,
} from "./report-identity.js";

const OPERATIONS = new Set(["inspect", "complete", "discard"]);
const DEFAULT_DATABASE = Object.freeze({
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
});

function cleanText(value, maximumLength) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function normalizeFinalizationReconciliationRequest(body = {}) {
  const labOrderId = cleanText(body.labOrderId, 128);
  if (!validDocumentId(labOrderId)) {
    throw new HttpError(400, "Choose a valid laboratory finalization record.");
  }
  const operation = cleanText(body.operation, 20).toLowerCase();
  if (!OPERATIONS.has(operation)) {
    throw new HttpError(400, "Choose inspect, complete, or discard.");
  }
  const discardReasonCode = operation === "discard"
    ? normalizedDiscardReason(body.discardReasonCode)
    : "";
  return { labOrderId, operation, discardReasonCode };
}

function currentAdministrator(authenticatedAdmin, staffDocument) {
  if (
    !authenticatedAdmin
    || !validDocumentId(authenticatedAdmin.uid)
    || !staffDocument
    || staffDocument.data?.active !== true
    || staffDocument.data?.role !== "admin"
  ) {
    throw new HttpError(403, "Only an active clinic administrator can reconcile reports.");
  }
  return {
    uid: authenticatedAdmin.uid,
    role: "admin",
    displayName: cleanText(
      staffDocument.data.displayName
        || authenticatedAdmin.displayName
        || authenticatedAdmin.email
        || "Clinic administrator",
      100,
    ),
  };
}

function verifyMissingDocumentWrite(env, path) {
  return {
    verify: documentName(env, path),
    currentDocument: { exists: false },
  };
}

async function verifiedPermanentObject(env, intent, storage, { allowMissing = false } = {}) {
  let object;
  try {
    object = await storage.fetchImmutableReportObject(env, intent.destinationPath);
  } catch (error) {
    if (allowMissing && error instanceof HttpError && error.status === 404) {
      return { present: false, verified: false, generation: "" };
    }
    throw error;
  }
  const contentSha256 = await sha256Hex(object.bytes);
  if (
    object.contentType !== intent.contentType
    || object.size !== intent.size
    || contentSha256 !== intent.contentSha256
    || !/^\d+$/u.test(String(object.generation || ""))
  ) {
    throw new HttpError(
      409,
      "The permanent report object does not match its finalization record and was not changed.",
    );
  }
  return {
    present: true,
    verified: true,
    generation: String(object.generation),
  };
}

async function loadIntent(env, labOrderId, database) {
  const path = finalizationIntentPath(labOrderId);
  const document = await database.getDocument(env, path);
  if (!document) {
    throw new HttpError(404, "This report finalization record could not be found.");
  }
  return { path, document, intent: assertValidFinalizationIntent(document, labOrderId) };
}

async function loadAdmin(env, authenticatedAdmin, database) {
  const staffPath = `staff/${authenticatedAdmin?.uid || "invalid"}`;
  const staffDocument = validDocumentId(authenticatedAdmin?.uid)
    ? await database.getDocument(env, staffPath)
    : null;
  return {
    staffPath,
    staffDocument,
    actor: currentAdministrator(authenticatedAdmin, staffDocument),
  };
}

async function completePreparedIntent({
  env,
  database,
  storage,
  authenticatedAdmin,
  intentDocument,
  intent,
  now,
}) {
  if (intent.status === "completed") {
    const object = await verifiedPermanentObject(env, intent, storage);
    const orderDocument = await database.getDocument(env, `labOrders/${intent.labOrderId}`);
    const currentReport = await database.getDocument(
      env,
      labReportDocumentPath(intent.patientId, intent.labOrderId),
    );
    const legacyReport = await database.getDocument(
      env,
      legacyLabReportDocumentPath(intent.patientId, intent.labOrderId),
    );
    const reportDocument = currentReport || legacyReport;
    if (
      !orderDocument
      || orderDocument.data?.patientId !== intent.patientId
      || orderDocument.data?.reportStoragePath !== intent.destinationPath
      || orderDocument.data?.reportContentType !== intent.contentType
      || orderDocument.data?.reportSize !== intent.size
      || !reportDocument
      || reportDocument.data?.storagePath !== intent.destinationPath
      || reportDocument.data?.contentType !== intent.contentType
      || reportDocument.data?.size !== intent.size
      || String(intent.permanentGeneration || "") !== object.generation
    ) {
      throw new HttpError(
        409,
        "This completed report finalization needs administrator review.",
      );
    }
    return {
      finalized: true,
      alreadyFinalized: true,
      ...redactedIntentResponse(intent, { object }),
    };
  }
  if (!["prepared", "promoting", "promoted"].includes(intent.status)) {
    throw new HttpError(409, "Only an unfinished report finalization can be completed.");
  }

  const object = await verifiedPermanentObject(env, intent, storage);
  const { staffDocument, actor } = await loadAdmin(env, authenticatedAdmin, database);
  const orderPath = `labOrders/${intent.labOrderId}`;
  const orderDocument = await database.getDocument(env, orderPath);
  if (!orderDocument || orderDocument.data?.patientId !== intent.patientId) {
    throw new HttpError(409, "The laboratory order no longer matches this finalization record.");
  }
  assertUnattachedLabOrder(orderDocument.data);
  const patientPath = `patients/${intent.patientId}`;
  const patientDocument = assertActivePatientDocument(
    await database.getDocument(env, patientPath),
    {
      missingMessage: "The patient linked to this finalization record no longer exists.",
      archivedMessage: "Restore the patient before completing this report finalization.",
    },
  );
  const reportPath = labReportDocumentPath(intent.patientId, intent.labOrderId);
  const legacyReportPath = legacyLabReportDocumentPath(
    intent.patientId,
    intent.labOrderId,
  );
  if (
    await database.getDocument(env, reportPath)
    || await database.getDocument(env, legacyReportPath)
  ) {
    throw new HttpError(409, "A patient report already exists for this laboratory order.");
  }
  let externalLinkDocument = null;
  if (intent.sourceProvider === "ayuslab") {
    externalLinkDocument = assertCurrentAyusLink(
      await database.getDocument(env, `externalLabLinks/ayuslab_${intent.labOrderId}`),
      intent,
    );
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
    permanentGeneration: object.generation,
    now,
  });
  await database.commitWrites(env, completion.writes);

  let stagingCleaned = true;
  try {
    await storage.deleteStagedReportObject(
      env,
      intent.stagedStoragePath,
      intent.stagedGeneration,
    );
  } catch {
    stagingCleaned = false;
  }
  return {
    finalized: true,
    alreadyFinalized: false,
    stagingCleaned,
    ...redactedIntentResponse({
      ...intent,
      status: "completed",
      completedAt: now,
    }),
  };
}

function discardAudit({ actor, intent, generation, objectWasPresent, reasonCode, now }) {
  return {
    eventType: "lab_report.finalization_discarded",
    category: "lab_report",
    action: "discarded",
    labOrderId: intent.labOrderId,
    patientId: intent.patientId,
    finalizationIntentId: intent.labOrderId,
    finalizationAttemptNumber: Number(intent.attemptNumber || 1),
    sourceProvider: intent.sourceProvider,
    objectIdentity: intent.destinationPath.split("/").at(-1) || "",
    objectGeneration: generation,
    objectWasPresent,
    discardReasonCode: reasonCode,
    uploadedBy: intent.uploadedBy,
    preparedBy: intent.preparedBy,
    discardedBy: actor.uid,
    actorUid: actor.uid,
    actorName: actor.displayName,
    actorRole: actor.role,
    createdAt: now,
  };
}

async function discardPreparedIntent({
  env,
  database,
  storage,
  authenticatedAdmin,
  intentDocument,
  intent,
  discardReasonCode,
  now,
}) {
  const { staffPath, staffDocument, actor } = await loadAdmin(env, authenticatedAdmin, database);
  const orderPath = `labOrders/${intent.labOrderId}`;
  const reportPath = labReportDocumentPath(intent.patientId, intent.labOrderId);
  let claimedDocument = intentDocument;
  let claimedIntent = intent;

  if (["prepared", "promoting", "promoted"].includes(intent.status)) {
    const orderDocument = await database.getDocument(env, orderPath);
    if (orderDocument && [
      "reportStoragePath",
      "reportFileName",
      "reportContentType",
      "reportSize",
    ].some((field) => Object.hasOwn(orderDocument.data || {}, field))) {
      throw new HttpError(409, "The laboratory order already points to a report and cannot be discarded.");
    }
    const reportPaths = new Set([
      reportPath,
      legacyLabReportDocumentPath(intent.patientId, intent.labOrderId),
    ]);
    const orderPatientId = String(orderDocument?.data?.patientId || "").trim();
    if (validDocumentId(orderPatientId) && orderPatientId !== intent.patientId) {
      reportPaths.add(labReportDocumentPath(orderPatientId, intent.labOrderId));
      reportPaths.add(legacyLabReportDocumentPath(orderPatientId, intent.labOrderId));
    }
    for (const candidatePath of reportPaths) {
      if (await database.getDocument(env, candidatePath)) {
        throw new HttpError(
          409,
          "A patient report already exists, so this object cannot be discarded.",
        );
      }
    }
    const object = await verifiedPermanentObject(env, intent, storage, { allowMissing: true });
    if (intent.status === "promoted" && (
      !object.present
      || String(intent.permanentGeneration || "") !== object.generation
    )) {
      throw new HttpError(
        409,
        "The promoted report object or generation changed and cannot be discarded.",
      );
    }
    if (intent.status === "promoting" && !object.present) {
      const leaseValue = intent.promotionLeaseExpiresAt;
      const leaseExpiresAt = leaseValue instanceof Date
        ? leaseValue.getTime()
        : Date.parse(String(leaseValue || ""));
      if (!Number.isFinite(leaseExpiresAt) || now.getTime() < leaseExpiresAt) {
        throw new HttpError(
          409,
          "Report promotion is still settling. Inspect this record again after the recovery window.",
        );
      }
    }
    const claimWrites = [
      database.verifyDocumentWrite(env, staffPath, staffDocument.updateTime),
      orderDocument
        ? database.verifyDocumentWrite(env, orderPath, orderDocument.updateTime)
        : verifyMissingDocumentWrite(env, orderPath),
      ...Array.from(reportPaths, (candidatePath) => verifyMissingDocumentWrite(env, candidatePath)),
      database.updateDocumentWrite(
        env,
        finalizationIntentPath(intent.labOrderId),
        {
          status: "discarding",
          discardGeneration: object.generation,
          discardObjectWasPresent: object.present,
          discardReasonCode,
          discardRequestedBy: actor.uid,
          discardRequestedAt: now,
          updatedAt: now,
        },
        [
          "status",
          "discardGeneration",
          "discardObjectWasPresent",
          "discardReasonCode",
          "discardRequestedBy",
          "discardRequestedAt",
          "updatedAt",
        ],
        intentDocument.updateTime,
      ),
    ];
    await database.commitWrites(env, claimWrites);
    claimedDocument = await database.getDocument(
      env,
      finalizationIntentPath(intent.labOrderId),
    );
    claimedIntent = assertValidFinalizationIntent(claimedDocument, intent.labOrderId);
  } else if (intent.status === "discarding") {
    if (intent.discardReasonCode !== discardReasonCode) {
      throw new HttpError(409, "Use the original verified discard reason to resume cleanup.");
    }
  } else if (intent.status === "discarded") {
    return { discarded: true, alreadyDiscarded: true, ...redactedIntentResponse(intent) };
  } else {
    throw new HttpError(409, "A completed report finalization cannot be discarded.");
  }

  const generation = String(claimedIntent.discardGeneration || "");
  const objectWasPresent = claimedIntent.discardObjectWasPresent === true;
  if (objectWasPresent) {
    if (!/^\d+$/u.test(generation)) {
      throw new HttpError(409, "The verified discard generation is invalid.");
    }
    await storage.deleteImmutableReportObject(
      env,
      claimedIntent.destinationPath,
      generation,
      { allowMissing: true },
    );
  }

  const finishedAt = new Date();
  await database.commitWrites(env, [
    database.verifyDocumentWrite(env, staffPath, staffDocument.updateTime),
    database.updateDocumentWrite(
      env,
      finalizationIntentPath(claimedIntent.labOrderId),
      {
        status: "discarded",
        discardedBy: actor.uid,
        discardedAt: finishedAt,
        updatedAt: finishedAt,
      },
      ["status", "discardedBy", "discardedAt", "updatedAt"],
      claimedDocument.updateTime,
    ),
    database.createDocumentWrite(
      env,
      `auditLogs/${crypto.randomUUID()}`,
      discardAudit({
        actor,
        intent: claimedIntent,
        generation,
        objectWasPresent,
        reasonCode: claimedIntent.discardReasonCode,
        now: finishedAt,
      }),
    ),
  ]);

  try {
    await storage.deleteStagedReportObject(
      env,
      claimedIntent.stagedStoragePath,
      claimedIntent.stagedGeneration,
    );
  } catch {
    // The final intent and immutable discard audit are authoritative. The
    // pending-report lifecycle remains the bounded staging cleanup backstop.
  }
  return {
    discarded: true,
    alreadyDiscarded: false,
    ...redactedIntentResponse({
      ...claimedIntent,
      status: "discarded",
      discardedAt: finishedAt,
    }),
  };
}

export async function reconcileLabReportFinalization(
  env,
  body,
  authenticatedAdmin,
  {
    database = DEFAULT_DATABASE,
    storage = REPORT_RECONCILIATION_STORAGE,
    now = new Date(),
  } = {},
) {
  const input = normalizeFinalizationReconciliationRequest(body);
  await loadAdmin(env, authenticatedAdmin, database);
  const { document, intent } = await loadIntent(env, input.labOrderId, database);

  if (input.operation === "inspect") {
    const object = intent.status === "discarded"
      ? { present: false, verified: false, generation: "" }
      : await verifiedPermanentObject(env, intent, storage, { allowMissing: true });
    return { inspected: true, intent: redactedIntentResponse(intent, { object }) };
  }
  if (input.operation === "complete") {
    return completePreparedIntent({
      env,
      database,
      storage,
      authenticatedAdmin,
      intentDocument: document,
      intent,
      now,
    });
  }
  return discardPreparedIntent({
    env,
    database,
    storage,
    authenticatedAdmin,
    intentDocument: document,
    intent,
    discardReasonCode: input.discardReasonCode,
    now,
  });
}
