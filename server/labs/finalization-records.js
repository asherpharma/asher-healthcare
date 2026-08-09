import { clinicClock } from "../reception/workflow.js";
import { HttpError } from "../razorpay/http.js";
import { labReportDocumentPath } from "./report-identity.js";

export function assertUnattachedLabOrder(order) {
  if (!order || order.status === "cancelled") {
    throw new HttpError(409, "A report cannot be attached to this laboratory order.");
  }
  if ([
    "reportStoragePath",
    "reportFileName",
    "reportContentType",
    "reportSize",
  ].some((field) => Object.hasOwn(order, field))) {
    throw new HttpError(409, "A report is already attached to this laboratory order.");
  }
  return order;
}

export function assertCurrentAyusLink(linkDocument, intent) {
  const link = linkDocument?.data;
  if (
    !linkDocument
    || link.providerId !== "ayuslab"
    || link.labOrderId !== intent.labOrderId
    || link.patientId !== intent.patientId
    || link.status !== "linked"
    || Number(link.version) !== intent.externalLinkVersion
  ) {
    throw new HttpError(409, "The AyusLab link changed. Review the Lab No and try again.");
  }
  return linkDocument;
}

function finalizationAudit({ actor, intent, permanentGeneration, now }) {
  return {
    eventType: "lab_report.finalized",
    category: "lab_report",
    action: "finalized",
    labOrderId: intent.labOrderId,
    patientId: intent.patientId,
    finalizationIntentId: intent.labOrderId,
    finalizationAttemptNumber: Number(intent.attemptNumber || 1),
    sourceProvider: intent.sourceProvider,
    externalLinkVersion: intent.externalLinkVersion,
    contentType: intent.contentType,
    size: intent.size,
    objectIdentity: intent.destinationPath.split("/").at(-1) || "",
    objectGeneration: String(permanentGeneration),
    uploadedBy: intent.uploadedBy,
    finalizedBy: actor.uid,
    adminHandoff: intent.uploadedBy !== actor.uid,
    actorUid: actor.uid,
    actorName: actor.displayName,
    actorRole: actor.role,
    createdAt: now,
  };
}

export function completedFinalizationWrites({
  env,
  database,
  intentDocument,
  intent,
  actor,
  staffDocument,
  patientDocument,
  orderDocument,
  externalLinkDocument = null,
  permanentGeneration,
  now,
  auditId = crypto.randomUUID(),
}) {
  const reportPath = labReportDocumentPath(intent.patientId, intent.labOrderId);
  const report = {
    fileName: intent.fileName,
    storagePath: intent.destinationPath,
    contentType: intent.contentType,
    size: intent.size,
    category: "Lab report",
    reportDate: clinicClock(now).date,
    notes: "",
    labOrderId: intent.labOrderId,
    finalizationIntentId: intent.labOrderId,
    finalizationAttemptNumber: Number(intent.attemptNumber || 1),
    sourceProvider: intent.sourceProvider,
    externalLinkVersion: intent.externalLinkVersion,
    createdBy: actor.uid,
    createdAt: now,
    updatedAt: now,
  };
  const orderUpdate = {
    status: "completed",
    reportFileName: intent.fileName,
    reportStoragePath: intent.destinationPath,
    reportContentType: intent.contentType,
    reportSize: intent.size,
    reportSourceProvider: intent.sourceProvider,
    reportExternalLinkVersion: intent.externalLinkVersion,
    reportFinalizationIntentId: intent.labOrderId,
    reportFinalizationAttemptNumber: Number(intent.attemptNumber || 1),
    reportAttachedBy: actor.uid,
    reportAttachedAt: now,
    completedAt: now,
    updatedAt: now,
  };
  if (intent.resultSummary) orderUpdate.resultSummary = intent.resultSummary;

  const staffPath = `staff/${actor.uid}`;
  const patientPath = `patients/${intent.patientId}`;
  const orderPath = `labOrders/${intent.labOrderId}`;
  const intentPath = `labReportFinalizationIntents/${intent.labOrderId}`;
  const writes = [
    database.verifyDocumentWrite(env, staffPath, staffDocument.updateTime),
    database.verifyDocumentWrite(env, patientPath, patientDocument.updateTime),
  ];
  if (externalLinkDocument) {
    writes.push(database.verifyDocumentWrite(
      env,
      `externalLabLinks/ayuslab_${intent.labOrderId}`,
      externalLinkDocument.updateTime,
    ));
  }
  writes.push(
    database.createDocumentWrite(env, reportPath, report),
    database.updateDocumentWrite(
      env,
      orderPath,
      orderUpdate,
      Object.keys(orderUpdate),
      orderDocument.updateTime,
    ),
    database.updateDocumentWrite(
      env,
      intentPath,
      {
        status: "completed",
        permanentGeneration: String(permanentGeneration),
        completedBy: actor.uid,
        completedAt: now,
        updatedAt: now,
      },
      ["status", "permanentGeneration", "completedBy", "completedAt", "updatedAt"],
      intentDocument.updateTime,
    ),
    database.createDocumentWrite(
      env,
      `auditLogs/${auditId}`,
      finalizationAudit({ actor, intent, permanentGeneration, now }),
    ),
  );
  return { writes, reportPath, report, orderUpdate };
}
