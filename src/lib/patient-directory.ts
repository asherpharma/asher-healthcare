export type PatientDirectoryEntry = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  doctorId?: string;
  doctorName?: string;
  caseType?: string;
  specialty?: string;
  consultationFee?: number;
  address: string;
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
};

export type PatientSearchResult = Omit<
  PatientDirectoryEntry,
  "address" | "archived" | "archivedAt" | "archivedBy" | "archiveReason"
>;

type TokenUser = {
  getIdToken: () => Promise<string>;
};

type DirectoryOptions = {
  includeArchived?: boolean;
};

type DirectoryResponse = {
  patients?: PatientDirectoryEntry[];
  error?: string;
};

type PatientSearchResponse = {
  patients?: PatientSearchResult[];
  nextCursor?: string;
  error?: string;
};

export async function fetchPatientDirectory(
  user: TokenUser,
  options: DirectoryOptions = {},
): Promise<PatientDirectoryEntry[]> {
  const token = await user.getIdToken();
  const query = options.includeArchived ? "?includeArchived=1" : "";
  const response = await fetch(`/api/staff/patients/directory${query}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const result = await response.json() as DirectoryResponse;
  if (!response.ok) {
    throw new Error(result.error || "The secure patient directory could not be loaded.");
  }
  if (!Array.isArray(result.patients)) {
    throw new Error("The secure patient directory returned an invalid response.");
  }
  return result.patients;
}

export async function searchPatientDirectory(
  user: TokenUser,
  search: string,
  options: { cursor?: string; pageSize?: number } = {},
): Promise<{ patients: PatientSearchResult[]; nextCursor: string }> {
  const token = await user.getIdToken();
  const response = await fetch("/api/staff/patients/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      search: search.trim(),
      cursor: options.cursor || "",
      pageSize: Math.min(25, Math.max(1, Math.trunc(options.pageSize ?? 10))),
    }),
    cache: "no-store",
  });
  const result = await response.json() as PatientSearchResponse;
  if (!response.ok) {
    throw new Error(result.error || "Patient search could not be completed.");
  }
  if (!Array.isArray(result.patients)) {
    throw new Error("Patient search returned an invalid response.");
  }
  return {
    patients: result.patients,
    nextCursor: String(result.nextCursor || ""),
  };
}
