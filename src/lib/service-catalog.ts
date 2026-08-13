export type ConsultationServiceId = "general" | "pediatrics" | "obg";

export type ConsultationService = {
  label: string;
  fee: number;
  active: boolean;
};

export type ServiceCatalog = {
  schemaVersion: 1;
  services: Record<ConsultationServiceId, ConsultationService>;
};

export type ServiceCatalogRevision = string | null;

export type ServiceCatalogSnapshot = {
  catalog: ServiceCatalog;
  revision: ServiceCatalogRevision;
};

export type ServiceCatalogSaveResult = ServiceCatalogSnapshot & {
  changed: boolean;
};

export const SERVICE_IDS: ConsultationServiceId[] = ["general", "pediatrics", "obg"];

export const DEFAULT_SERVICE_CATALOG: ServiceCatalog = {
  schemaVersion: 1,
  services: {
    general: { label: "General consultation", fee: 250, active: true },
    pediatrics: { label: "Pediatric consultation", fee: 500, active: true },
    obg: { label: "Obstetrics & Gynaecology consultation", fee: 500, active: true },
  },
};

function normalizeService(value: unknown, fallback: ConsultationService): ConsultationService {
  const candidate = value && typeof value === "object"
    ? value as Partial<ConsultationService>
    : {};
  const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
  const fee = Number(candidate.fee);
  return {
    label: label.length >= 2 && label.length <= 80 ? label : fallback.label,
    fee: Number.isInteger(fee) && fee >= 1 && fee <= 100_000 ? fee : fallback.fee,
    active: typeof candidate.active === "boolean" ? candidate.active : fallback.active,
  };
}

export function normalizeServiceCatalog(value: unknown): ServiceCatalog {
  const candidate = value && typeof value === "object" ? value as { services?: unknown } : {};
  const services = candidate.services && typeof candidate.services === "object"
    ? candidate.services as Partial<Record<ConsultationServiceId, unknown>>
    : {};
  return {
    schemaVersion: 1,
    services: {
      general: normalizeService(services.general, DEFAULT_SERVICE_CATALOG.services.general),
      pediatrics: normalizeService(services.pediatrics, DEFAULT_SERVICE_CATALOG.services.pediatrics),
      obg: normalizeService(services.obg, DEFAULT_SERVICE_CATALOG.services.obg),
    },
  };
}

export function cloneServiceCatalog(value: unknown): ServiceCatalog {
  const catalog = normalizeServiceCatalog(value);
  return {
    schemaVersion: 1,
    services: {
      general: { ...catalog.services.general },
      pediatrics: { ...catalog.services.pediatrics },
      obg: { ...catalog.services.obg },
    },
  };
}
