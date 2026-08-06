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
