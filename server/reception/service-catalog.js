import { HttpError } from "../razorpay/http.js";

const MAX_SERVICE_FEE = 100_000;
const SERVICE_KEYS = Object.freeze(["general", "pediatrics", "obg"]);

export const DEFAULT_RECEPTION_SERVICE_CATALOG = Object.freeze({
  schemaVersion: 1,
  services: Object.freeze({
    general: Object.freeze({
      label: "General consultation",
      fee: 250,
      active: true,
    }),
    pediatrics: Object.freeze({
      label: "Pediatric consultation",
      fee: 500,
      active: true,
    }),
    obg: Object.freeze({
      label: "Obstetrics & Gynaecology consultation",
      fee: 500,
      active: true,
    }),
  }),
});

function normalizeService(value, fallback) {
  const candidate = value && typeof value === "object" ? value : {};
  const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
  const fee = Number(candidate.fee);
  return {
    label: label.length >= 2 && label.length <= 80 ? label : fallback.label,
    fee: Number.isInteger(fee) && fee >= 1 && fee <= MAX_SERVICE_FEE
      ? fee
      : fallback.fee,
    active: typeof candidate.active === "boolean" ? candidate.active : fallback.active,
  };
}

export function normalizeReceptionServiceCatalog(value) {
  const services = value && typeof value === "object" && value.services && typeof value.services === "object"
    ? value.services
    : {};
  return {
    schemaVersion: 1,
    services: Object.fromEntries(SERVICE_KEYS.map((key) => [
      key,
      normalizeService(services[key], DEFAULT_RECEPTION_SERVICE_CATALOG.services[key]),
    ])),
  };
}

export function serviceIdForReceptionSelection(caseType, specialty) {
  if (caseType === "general") return "general";
  return specialty === "pediatrics" || specialty === "obg" ? specialty : "";
}

export function receptionServiceForSelection(catalog, caseType, specialty) {
  const serviceId = serviceIdForReceptionSelection(caseType, specialty);
  const service = serviceId ? catalog.services[serviceId] : null;
  if (!service) throw new HttpError(400, "Choose a valid consultation service.");
  if (!service.active) {
    throw new HttpError(409, "This consultation service is currently unavailable. Choose another service.");
  }
  return { serviceId, ...service };
}
