import {
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
} from "../razorpay/firebase.js";
import { HttpError } from "../razorpay/http.js";
import { validDocumentId } from "../razorpay/payments.js";
import {
  DEFAULT_RECEPTION_SERVICE_CATALOG,
  normalizeReceptionServiceCatalog,
} from "./service-catalog.js";

const CATALOG_PATH = "clinicSettings/serviceCatalog";
const SERVICE_IDS = Object.freeze(["general", "pediatrics", "obg"]);
const MAX_SERVICE_FEE = 100_000;
const UPDATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

const DEFAULT_DATABASE = Object.freeze({
  commitWrites,
  createDocumentWrite,
  getDocument,
  updateDocumentWrite,
  verifyDocumentWrite,
});

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function validUpdateTime(value) {
  return typeof value === "string"
    && UPDATE_TIME_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validateService(service, serviceId) {
  if (!hasExactKeys(service, ["label", "fee", "active"])) {
    throw new HttpError(400, `${serviceId} must include only label, fee, and active status.`);
  }
  if (
    typeof service.label !== "string"
    || service.label !== service.label.trim()
    || service.label.length < 2
    || service.label.length > 80
    || /[\u0000-\u001f\u007f]/u.test(service.label)
  ) {
    throw new HttpError(400, `${serviceId} needs a label between 2 and 80 characters.`);
  }
  if (!Number.isInteger(service.fee) || service.fee < 1 || service.fee > MAX_SERVICE_FEE) {
    throw new HttpError(400, `${serviceId} needs a whole-number fee from ₹1 to ₹1,00,000.`);
  }
  if (typeof service.active !== "boolean") {
    throw new HttpError(400, `${serviceId} needs a valid active status.`);
  }
  return {
    label: service.label,
    fee: service.fee,
    active: service.active,
  };
}

export function validateCompleteServiceCatalog(value) {
  if (!hasExactKeys(value, ["schemaVersion", "services"])) {
    throw new HttpError(400, "Submit the complete consultation service catalogue.");
  }
  if (value.schemaVersion !== 1 || !hasExactKeys(value.services, SERVICE_IDS)) {
    throw new HttpError(400, "The consultation service catalogue format is invalid.");
  }

  const services = Object.fromEntries(SERVICE_IDS.map((serviceId) => [
    serviceId,
    validateService(value.services[serviceId], serviceId),
  ]));
  if (!SERVICE_IDS.some((serviceId) => services[serviceId].active)) {
    throw new HttpError(400, "Keep at least one consultation service active.");
  }
  return { schemaVersion: 1, services };
}

export function validateServiceCatalogMutation(value) {
  if (!hasExactKeys(value, ["catalog", "expectedUpdateTime"])) {
    throw new HttpError(400, "Submit the complete catalogue and its current revision.");
  }
  if (value.expectedUpdateTime !== null && !validUpdateTime(value.expectedUpdateTime)) {
    throw new HttpError(400, "Refresh the consultation service catalogue before saving.");
  }
  return {
    catalog: validateCompleteServiceCatalog(value.catalog),
    expectedUpdateTime: value.expectedUpdateTime,
  };
}

function currentAdministrator(authenticatedAdministrator, administratorDocument) {
  if (
    !validDocumentId(authenticatedAdministrator?.uid)
    || !administratorDocument
    || administratorDocument.data.active !== true
    || administratorDocument.data.role !== "admin"
  ) {
    throw new HttpError(403, "This administrator account is no longer active.");
  }
  return {
    uid: authenticatedAdministrator.uid,
    displayName: String(
      administratorDocument.data.displayName
      || authenticatedAdministrator.displayName
      || "Clinic administrator",
    ).trim().slice(0, 100),
  };
}

function storedCompleteCatalog(document) {
  if (!document) return null;
  try {
    return validateCompleteServiceCatalog({
      schemaVersion: document.data.schemaVersion,
      services: document.data.services,
    });
  } catch {
    return null;
  }
}

function catalogEquals(left, right) {
  return SERVICE_IDS.every((serviceId) => (
    left.services[serviceId].label === right.services[serviceId].label
    && left.services[serviceId].fee === right.services[serviceId].fee
    && left.services[serviceId].active === right.services[serviceId].active
  ));
}

function changedServiceIds(previous, next) {
  if (!previous) return [...SERVICE_IDS];
  return SERVICE_IDS.filter((serviceId) => (
    previous.services[serviceId].label !== next.services[serviceId].label
    || previous.services[serviceId].fee !== next.services[serviceId].fee
    || previous.services[serviceId].active !== next.services[serviceId].active
  ));
}

async function loadCurrentAdministratorAndCatalog(
  env,
  authenticatedAdministrator,
  database,
) {
  if (!validDocumentId(authenticatedAdministrator?.uid)) {
    throw new HttpError(403, "Only a clinic administrator can manage consultation fees.");
  }
  const administratorPath = `staff/${authenticatedAdministrator.uid}`;
  const [administratorDocument, catalogDocument] = await Promise.all([
    database.getDocument(env, administratorPath),
    database.getDocument(env, CATALOG_PATH),
  ]);
  return {
    actor: currentAdministrator(authenticatedAdministrator, administratorDocument),
    administratorDocument,
    administratorPath,
    catalogDocument,
  };
}

export async function getServiceCatalogForAdministrator(
  env,
  authenticatedAdministrator,
  database = DEFAULT_DATABASE,
) {
  const { catalogDocument } = await loadCurrentAdministratorAndCatalog(
    env,
    authenticatedAdministrator,
    database,
  );
  return {
    catalog: normalizeReceptionServiceCatalog(catalogDocument?.data || DEFAULT_RECEPTION_SERVICE_CATALOG),
    revision: catalogDocument?.updateTime || null,
  };
}

export async function setServiceCatalogForAdministrator(
  env,
  body,
  authenticatedAdministrator,
  database = DEFAULT_DATABASE,
) {
  const input = validateServiceCatalogMutation(body);
  const {
    actor,
    administratorDocument,
    administratorPath,
    catalogDocument,
  } = await loadCurrentAdministratorAndCatalog(env, authenticatedAdministrator, database);

  const currentRevision = catalogDocument?.updateTime || null;
  const previous = storedCompleteCatalog(catalogDocument);
  if (previous && catalogEquals(previous, input.catalog)) {
    return { catalog: previous, revision: currentRevision, changed: false };
  }
  if (input.expectedUpdateTime !== currentRevision) {
    throw new HttpError(409, "Consultation fees changed in another session. Refresh the current catalogue before saving.");
  }

  const now = new Date();
  const catalogData = {
    ...input.catalog,
    updatedBy: actor.uid,
    updatedAt: now,
  };
  const catalogWrite = catalogDocument
    ? database.updateDocumentWrite(
        env,
        CATALOG_PATH,
        catalogData,
        ["schemaVersion", "services", "updatedBy", "updatedAt"],
        catalogDocument.updateTime,
      )
    : database.createDocumentWrite(env, CATALOG_PATH, catalogData);
  const auditId = crypto.randomUUID();
  await database.commitWrites(env, [
    database.verifyDocumentWrite(
      env,
      administratorPath,
      administratorDocument.updateTime,
    ),
    catalogWrite,
    database.createDocumentWrite(env, `auditLogs/${auditId}`, {
      eventType: catalogDocument
        ? "clinic.service_catalog_updated"
        : "clinic.service_catalog_created",
      category: "clinic_settings",
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: "admin",
      changedServiceIds: changedServiceIds(previous, input.catalog),
      previousServices: previous?.services || null,
      nextServices: input.catalog.services,
      previousRevision: currentRevision || "",
      createdAt: now,
    }),
  ]);

  const committedCatalog = await database.getDocument(env, CATALOG_PATH);
  const committedCatalogValue = storedCompleteCatalog(committedCatalog);
  if (!committedCatalog || !committedCatalogValue || !catalogEquals(committedCatalogValue, input.catalog)) {
    throw new HttpError(503, "The catalogue was saved, but its new revision could not be confirmed. Refresh before editing again.");
  }

  return {
    catalog: input.catalog,
    revision: committedCatalog.updateTime,
    changed: true,
  };
}
