/**
 * Deterministic patient identity helpers.
 *
 * These functions are intentionally dependency-free so they can be reused by
 * browser forms, Cloudflare Functions, migration scripts, and tests. Duplicate
 * assessments are decision support only: medical records must never be merged
 * automatically from a fuzzy match.
 */

export type PatientIdentityInput = {
  id?: string | null;
  patientNumber?: string | null;
  fullName?: string | null;
  name?: string | null;
  phone?: string | null;
  dateOfBirth?: string | Date | null;
  dob?: string | Date | null;
};

export type PatientSearchTokenOptions = {
  minimumNamePrefix?: number;
  minimumPhonePrefix?: number;
  maximumPrefixLength?: number;
  maximumTokens?: number;
};

export type PatientNameMatch = "none" | "strong" | "exact";
export type DuplicateConfidence = "none" | "possible" | "probable" | "high";
export type DuplicateReason =
  | "patient-number"
  | "phone"
  | "date-of-birth"
  | "name-exact"
  | "name-strong";

export type NormalizedPatientIdentity = {
  patientNumber: string | null;
  fullName: string;
  phone: string | null;
  dateOfBirth: string | null;
};

export type DuplicateAssessment = {
  confidence: DuplicateConfidence;
  score: number;
  reasons: DuplicateReason[];
  conflicts: Array<"phone" | "date-of-birth" | "name">;
  requiresReview: boolean;
  /** Always false by design. A human must approve any medical-record merge. */
  safeToAutoMerge: false;
  candidate: NormalizedPatientIdentity;
  existing: NormalizedPatientIdentity;
};

export type PatientDuplicateCandidate<T extends PatientIdentityInput> = {
  patient: T;
  assessment: DuplicateAssessment;
};

const NAME_TITLES = new Set(["dr", "mr", "mrs", "ms", "miss", "smt", "shri"]);
const CONFIDENCE_RANK: Record<DuplicateConfidence, number> = {
  none: 0,
  possible: 1,
  probable: 2,
  high: 3,
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Normalizes an Indian patient mobile number to E.164 (`+91XXXXXXXXXX`).
 * Invalid, partial, landline, and non-Indian values return `null` so they do
 * not create false duplicate matches.
 */
export function normalizeIndianPhone(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;

  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** Normalized searchable form of a patient name, preserving non-Latin letters. */
export function normalizePatientName(value: unknown): string {
  const words = text(value)
    .normalize("NFKD")
    // Strip Latin accent marks without deleting vowel signs from scripts such
    // as Devanagari, Kannada, Tamil, or Telugu.
    .replace(/[\u0300-\u036f]+/g, "")
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  while (words.length > 1 && NAME_TITLES.has(words[0])) words.shift();
  return words.join(" ").slice(0, 120);
}

/** Normalized patient/registration number without display punctuation. */
export function normalizePatientNumber(value: unknown): string | null {
  const normalized = text(value)
    .normalize("NFKC")
    .toLocaleUpperCase("en-IN")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 64);
  return normalized || null;
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Returns an unambiguous `YYYY-MM-DD` DOB. Accepted strings are ISO dates and
 * Indian `DD/MM/YYYY`/`DD-MM-YYYY`; ambiguous US-style dates are not guessed.
 */
export function normalizeDateOfBirth(value: unknown, asOf = new Date()): string | null {
  let year: number;
  let month: number;
  let day: number;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    year = value.getFullYear();
    month = value.getMonth() + 1;
    day = value.getDate();
  } else {
    const raw = text(value);
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(raw);
    const indian = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
    if (iso) {
      year = Number(iso[1]);
      month = Number(iso[2]);
      day = Number(iso[3]);
    } else if (indian) {
      day = Number(indian[1]);
      month = Number(indian[2]);
      year = Number(indian[3]);
    } else {
      return null;
    }
  }

  if (year < 1900 || !validCalendarDate(year, month, day)) return null;

  const normalized = formatDate(year, month, day);
  const today = formatDate(asOf.getFullYear(), asOf.getMonth() + 1, asOf.getDate());
  return normalized <= today ? normalized : null;
}

/** Builds bounded, Unicode-safe prefixes for a normalized value. */
export function buildSearchPrefixes(
  value: string,
  minimumLength = 2,
  maximumLength = 48,
): string[] {
  const characters = Array.from(value.trim());
  const start = Math.max(1, Math.floor(minimumLength));
  const end = Math.min(characters.length, Math.max(start, Math.floor(maximumLength)));
  const prefixes: string[] = [];
  for (let length = start; length <= end; length += 1) {
    prefixes.push(characters.slice(0, length).join(""));
  }
  return prefixes;
}

export function normalizePatientIdentity(input: PatientIdentityInput): NormalizedPatientIdentity {
  return {
    patientNumber: normalizePatientNumber(input.patientNumber ?? input.id),
    fullName: normalizePatientName(input.fullName ?? input.name),
    phone: normalizeIndianPhone(input.phone),
    dateOfBirth: normalizeDateOfBirth(input.dateOfBirth ?? input.dob),
  };
}

/**
 * Creates namespaced tokens suitable for a Firestore array field. Tokens are
 * deterministic and bounded to avoid uncontrolled document growth.
 */
export function buildPatientSearchTokens(
  input: PatientIdentityInput,
  options: PatientSearchTokenOptions = {},
): string[] {
  const {
    minimumNamePrefix = 2,
    minimumPhonePrefix = 3,
    maximumPrefixLength = 48,
    maximumTokens = 96,
  } = options;
  const identity = normalizePatientIdentity(input);
  const exactTokens = new Set<string>();
  const prefixTokens = new Set<string>();

  if (identity.fullName) {
    exactTokens.add(`name-exact:${identity.fullName}`);
    const nameValues = new Set([identity.fullName, ...identity.fullName.split(" ")]);
    for (const nameValue of nameValues) {
      for (const prefix of buildSearchPrefixes(nameValue, minimumNamePrefix, maximumPrefixLength)) {
        prefixTokens.add(`name:${prefix}`);
      }
    }
  }

  if (identity.phone) {
    const nationalNumber = identity.phone.slice(3);
    exactTokens.add(`phone-exact:${identity.phone}`);
    for (const prefix of buildSearchPrefixes(nationalNumber, minimumPhonePrefix, 10)) {
      prefixTokens.add(`phone:${prefix}`);
    }
  }

  if (identity.patientNumber) {
    exactTokens.add(`patient-exact:${identity.patientNumber}`);
    for (const prefix of buildSearchPrefixes(identity.patientNumber, 2, maximumPrefixLength)) {
      prefixTokens.add(`patient:${prefix}`);
    }
  }

  if (identity.dateOfBirth) exactTokens.add(`dob:${identity.dateOfBirth}`);
  // Exact identifiers are placed first so a long name can never crowd out the
  // phone, DOB, or registration number when the token cap is reached.
  return [...uniqueSorted(exactTokens), ...uniqueSorted(prefixTokens)].slice(
    0,
    Math.max(1, Math.floor(maximumTokens)),
  );
}

/**
 * Produces candidate array-contains tokens for a staff search box. Callers may
 * try the returned tokens in order and combine/deduplicate the query results.
 */
export function buildPatientSearchQueryTokens(query: unknown): string[] {
  const raw = text(query);
  if (!raw) return [];

  const tokens = new Set<string>();
  const phone = normalizeIndianPhone(raw);
  const digits = raw.replace(/\D/g, "");
  let partialPhone = digits;
  if (partialPhone.startsWith("0091")) partialPhone = partialPhone.slice(4);
  else if (partialPhone.length > 10 && partialPhone.startsWith("91")) partialPhone = partialPhone.slice(2);
  else if (partialPhone.length > 10 && partialPhone.startsWith("0")) partialPhone = partialPhone.slice(1);

  if (phone) {
    tokens.add(`phone-exact:${phone}`);
    tokens.add(`phone:${phone.slice(3)}`);
  } else if (/^\d{3,10}$/.test(partialPhone)) {
    tokens.add(`phone:${partialPhone}`);
  }

  const dateOfBirth = normalizeDateOfBirth(raw);
  if (dateOfBirth) tokens.add(`dob:${dateOfBirth}`);

  const name = normalizePatientName(raw);
  if (name && Array.from(name).length >= 2 && /\p{L}/u.test(name)) {
    tokens.add(`name:${name}`);
    tokens.add(`name-exact:${name}`);
  }

  const patientNumber = normalizePatientNumber(raw);
  if (patientNumber && Array.from(patientNumber).length >= 2) {
    tokens.add(`patient:${patientNumber}`);
    tokens.add(`patient-exact:${patientNumber}`);
  }

  return [...tokens];
}

function levenshteinDistance(left: string, right: string, stopAfter = 3): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > stopAfter) return stopAfter + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
      rowMinimum = Math.min(rowMinimum, current[rightIndex]);
    }
    if (rowMinimum > stopAfter) return stopAfter + 1;
    previous = current;
  }
  return previous[right.length];
}

export function comparePatientNames(left: unknown, right: unknown): {
  match: PatientNameMatch;
  similarity: number;
} {
  const normalizedLeft = normalizePatientName(left);
  const normalizedRight = normalizePatientName(right);
  if (!normalizedLeft || !normalizedRight) return { match: "none", similarity: 0 };
  if (normalizedLeft === normalizedRight) return { match: "exact", similarity: 1 };

  const leftWords = normalizedLeft.split(" ").sort().join(" ");
  const rightWords = normalizedRight.split(" ").sort().join(" ");
  if (leftWords === rightWords) return { match: "strong", similarity: 0.99 };

  const maximumLength = Math.max(normalizedLeft.length, normalizedRight.length);
  const allowedDistance = maximumLength >= 12 ? 2 : maximumLength >= 5 ? 1 : 0;
  const distance = allowedDistance
    ? levenshteinDistance(normalizedLeft, normalizedRight, allowedDistance)
    : maximumLength;
  const similarity = Math.max(0, 1 - distance / maximumLength);
  // Same-length substitutions can turn one valid short Indian name into
  // another (for example Ravi/Rani), so only insertion/deletion variants are
  // treated as strong fuzzy matches. Exact and reordered-token matches were
  // already handled above.
  const lengthDifference = Math.abs(normalizedLeft.length - normalizedRight.length);
  return lengthDifference > 0 && distance <= allowedDistance
    ? { match: "strong", similarity }
    : { match: "none", similarity };
}

/**
 * Conservatively assesses whether two records may represent one patient.
 * `safeToAutoMerge` is always false; probable/high results must be reviewed.
 */
export function assessPatientDuplicate(
  candidateInput: PatientIdentityInput,
  existingInput: PatientIdentityInput,
): DuplicateAssessment {
  const candidate = normalizePatientIdentity(candidateInput);
  const existing = normalizePatientIdentity(existingInput);
  const reasons: DuplicateReason[] = [];
  const conflicts: Array<"phone" | "date-of-birth" | "name"> = [];

  const patientNumberMatches = Boolean(
    candidate.patientNumber &&
      existing.patientNumber &&
      candidate.patientNumber === existing.patientNumber,
  );
  const phoneMatches = Boolean(candidate.phone && existing.phone && candidate.phone === existing.phone);
  const dobMatches = Boolean(
    candidate.dateOfBirth &&
      existing.dateOfBirth &&
      candidate.dateOfBirth === existing.dateOfBirth,
  );
  const nameComparison = comparePatientNames(candidate.fullName, existing.fullName);
  const nameMatches = nameComparison.match !== "none";

  if (patientNumberMatches) reasons.push("patient-number");
  if (phoneMatches) reasons.push("phone");
  if (dobMatches) reasons.push("date-of-birth");
  if (nameComparison.match === "exact") reasons.push("name-exact");
  else if (nameComparison.match === "strong") reasons.push("name-strong");

  if (candidate.phone && existing.phone && !phoneMatches) conflicts.push("phone");
  if (candidate.dateOfBirth && existing.dateOfBirth && !dobMatches) conflicts.push("date-of-birth");
  if (candidate.fullName && existing.fullName && !nameMatches) conflicts.push("name");

  let confidence: DuplicateConfidence = "none";
  if (patientNumberMatches || (phoneMatches && dobMatches && nameMatches)) {
    confidence = "high";
  } else if (
    (phoneMatches && dobMatches) ||
    (dobMatches && nameMatches) ||
    (phoneMatches && nameMatches && !conflicts.includes("date-of-birth"))
  ) {
    confidence = "probable";
  } else if (phoneMatches || nameComparison.match === "exact") {
    confidence = "possible";
  }

  const score = Math.min(
    100,
    (patientNumberMatches ? 100 : 0) +
      (phoneMatches ? 45 : 0) +
      (dobMatches ? 25 : 0) +
      (nameComparison.match === "exact" ? 30 : nameComparison.match === "strong" ? 20 : 0),
  );

  return {
    confidence,
    score,
    reasons,
    conflicts,
    requiresReview: confidence !== "none",
    safeToAutoMerge: false,
    candidate,
    existing,
  };
}

export function findPotentialPatientDuplicates<T extends PatientIdentityInput>(
  candidate: PatientIdentityInput,
  patients: readonly T[],
  minimumConfidence: Exclude<DuplicateConfidence, "none"> = "possible",
): PatientDuplicateCandidate<T>[] {
  const minimumRank = CONFIDENCE_RANK[minimumConfidence];
  return patients
    .map((patient) => ({ patient, assessment: assessPatientDuplicate(candidate, patient) }))
    .filter(({ assessment }) => CONFIDENCE_RANK[assessment.confidence] >= minimumRank)
    .sort((left, right) => right.assessment.score - left.assessment.score);
}
