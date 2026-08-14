export function patientSearchReady(value: string) {
  const cleaned = value.trim().slice(0, 100);
  if (!cleaned) return false;

  const patientNumber = cleaned
    .toLocaleUpperCase("en-IN")
    .replace(/[^A-Z0-9-]+/gu, "");
  const knownClinicNumber = /^(?:ASH|AHC)-[A-Z0-9-]{1,24}$/u.test(patientNumber);
  const otherNumberWithDigit = /^[A-Z]{2,8}-(?=[A-Z0-9-]*\d)[A-Z0-9-]{1,24}$/u.test(patientNumber);
  if (knownClinicNumber || otherNumberWithDigit) return true;

  const digits = cleaned.replace(/\D/gu, "");
  let national = digits;
  if (national.startsWith("0091")) national = national.slice(4);
  else if (national.length > 10 && national.startsWith("91")) national = national.slice(2);
  if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  if (/^[6-9]\d{5,9}$/u.test(national)) return true;

  const normalizedName = cleaned
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  return normalizedName.length >= 3;
}
