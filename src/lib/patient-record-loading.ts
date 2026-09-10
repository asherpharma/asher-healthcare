export const patientRecordSections = [
  "visits",
  "prescriptions",
  "growthRecords",
  "vaccinations",
  "pregnancyRecords",
  "reports",
  "invoices",
  "labOrders",
] as const;

export type PatientRecordSection = (typeof patientRecordSections)[number];
export type PatientRecordTab =
  | "overview"
  | "timeline"
  | "visits"
  | "prescriptions"
  | "growth"
  | "vaccinations"
  | "pregnancy"
  | "reports";
export type PatientRecordLoadPhase = "idle" | "loading" | "ready" | "error";
export type PatientRecordSectionState = {
  phase: PatientRecordLoadPhase;
  error: string;
};
export type PatientRecordLoadState = Record<PatientRecordSection, PatientRecordSectionState>;

export const patientRecordSectionLabels: Record<PatientRecordSection, string> = {
  visits: "visits",
  prescriptions: "prescriptions",
  growthRecords: "growth records",
  vaccinations: "vaccinations",
  pregnancyRecords: "pregnancy records",
  reports: "medical reports",
  invoices: "invoices",
  labOrders: "lab orders",
};

const clinicalSections: PatientRecordSection[] = [
  "visits",
  "prescriptions",
  "growthRecords",
  "vaccinations",
  "pregnancyRecords",
  "reports",
];

const sectionForTab: Partial<Record<PatientRecordTab, PatientRecordSection>> = {
  visits: "visits",
  prescriptions: "prescriptions",
  growth: "growthRecords",
  vaccinations: "vaccinations",
  pregnancy: "pregnancyRecords",
  reports: "reports",
};

export function createPatientRecordLoadState(): PatientRecordLoadState {
  return Object.fromEntries(
    patientRecordSections.map((section) => [section, { phase: "idle", error: "" }]),
  ) as PatientRecordLoadState;
}

export function patientRecordSectionsForTab(
  tab: PatientRecordTab,
  access: { canViewClinical: boolean; canViewInvoices: boolean },
): PatientRecordSection[] {
  if (tab === "overview") return [];
  if (tab === "timeline") {
    return [
      ...(access.canViewClinical ? clinicalSections : []),
      "labOrders",
      ...(access.canViewInvoices ? ["invoices" as const] : []),
    ];
  }

  const section = sectionForTab[tab];
  return section && access.canViewClinical ? [section] : [];
}

export function preparePatientRecordSections(
  sections: PatientRecordSection[],
): PatientRecordLoadState {
  const next = createPatientRecordLoadState();
  for (const section of sections) next[section] = { phase: "loading", error: "" };
  return next;
}

export function markPatientRecordSectionReady(
  state: PatientRecordLoadState,
  section: PatientRecordSection,
): PatientRecordLoadState {
  return { ...state, [section]: { phase: "ready", error: "" } };
}

export function markPatientRecordSectionError(
  state: PatientRecordLoadState,
  section: PatientRecordSection,
  error: string,
): PatientRecordLoadState {
  return { ...state, [section]: { phase: "error", error } };
}

export function patientRecordSectionsAreReady(
  state: PatientRecordLoadState,
  sections: PatientRecordSection[],
) {
  return sections.every((section) => state[section].phase === "ready");
}

export function patientRecordSectionCount(
  state: PatientRecordLoadState,
  section: PatientRecordSection,
  count: number,
) {
  return state[section].phase === "ready" ? count : undefined;
}
