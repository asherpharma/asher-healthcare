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
  archived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
};

export type PatientSearchResult = PatientDirectoryEntry;

type TokenUser = {
  getIdToken: () => Promise<string>;
};

type DirectoryOptions = {
  includeArchived?: boolean;
  archivedOnly?: boolean;
  cursor?: string;
  pageSize?: number;
};

type DirectoryResponse = {
  patients?: PatientDirectoryEntry[];
  nextCursor?: string;
  hasMore?: boolean;
  error?: string;
};

type PatientSearchResponse = {
  patients?: PatientSearchResult[];
  nextCursor?: string;
  hasMore?: boolean;
  error?: string;
};

export type PatientDirectoryPage = {
  patients: PatientDirectoryEntry[];
  nextCursor: string;
  hasMore: boolean;
};

export type PatientDirectoryResolution = {
  patients: PatientDirectoryEntry[];
  unavailableIds: string[];
};

export type PatientProfileEntry = PatientDirectoryEntry & {
  address: string;
  allergies?: string;
  medicalHistory?: string;
};

export async function fetchPatientDirectoryPage(
  user: TokenUser,
  options: DirectoryOptions = {},
): Promise<PatientDirectoryPage> {
  const token = await user.getIdToken();
  const query = new URLSearchParams();
  if (options.includeArchived) query.set("includeArchived", "1");
  if (options.archivedOnly) query.set("archivedOnly", "1");
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.pageSize !== undefined) {
    query.set("pageSize", String(Math.min(50, Math.max(1, Math.trunc(options.pageSize)))));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetch(`/api/staff/patients/directory${suffix}`, {
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
  const nextCursor = String(result.nextCursor || "");
  return {
    patients: result.patients,
    nextCursor,
    hasMore: result.hasMore === true || Boolean(nextCursor),
  };
}

/** Compatibility helper: returns only the first bounded page. New screens
 * should use fetchPatientDirectoryPage or searchPatientDirectory.
 */
export async function fetchPatientDirectory(
  user: TokenUser,
  options: DirectoryOptions = {},
): Promise<PatientDirectoryEntry[]> {
  return (await fetchPatientDirectoryPage(user, {
    ...options,
    pageSize: options.pageSize ?? 50,
  })).patients;
}

export async function resolvePatientDirectoryEntries(
  user: TokenUser,
  patientIds: string | readonly string[],
  options: { includeArchived?: boolean } = {},
): Promise<PatientDirectoryResolution> {
  const ids = typeof patientIds === "string" ? [patientIds] : [...patientIds];
  if (ids.length < 1 || ids.length > 50) {
    throw new Error("Select between 1 and 50 patients to continue.");
  }
  const token = await user.getIdToken();
  const response = await fetch("/api/staff/patients/directory", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ patientIds: ids, includeArchived: options.includeArchived === true }),
    cache: "no-store",
  });
  const result = await response.json() as Partial<PatientDirectoryResolution> & { error?: string };
  if (!response.ok) {
    throw new Error(result.error || "The selected patient records could not be checked.");
  }
  if (!Array.isArray(result.patients) || !Array.isArray(result.unavailableIds)) {
    throw new Error("The selected patient lookup returned an invalid response.");
  }
  return { patients: result.patients, unavailableIds: result.unavailableIds };
}

export async function fetchPatientProfile(
  user: TokenUser,
  patientId: string,
): Promise<PatientProfileEntry> {
  const id = patientId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) {
    throw new Error("Choose a valid patient record.");
  }
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/staff/patients/profile?patientId=${encodeURIComponent(id)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  const result = await response.json() as { patient?: PatientProfileEntry; error?: string };
  if (!response.ok) {
    throw new Error(result.error || "This patient record could not be opened.");
  }
  if (!result.patient || result.patient.id !== id || typeof result.patient.address !== "string") {
    throw new Error("The patient profile returned an invalid response.");
  }
  return result.patient;
}

export async function searchPatientDirectory(
  user: TokenUser,
  search: string,
  options: { cursor?: string; pageSize?: number; archivedOnly?: boolean } = {},
): Promise<{ patients: PatientSearchResult[]; nextCursor: string; hasMore: boolean }> {
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
      archivedOnly: options.archivedOnly === true,
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
    hasMore: result.hasMore === true || Boolean(result.nextCursor),
  };
}
