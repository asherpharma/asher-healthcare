export const STAFF_EMAIL_LINK_STORAGE_KEY = "asher:staff-email-link";
export const STAFF_ROLES = new Set(["admin", "doctor", "reception"]);

export function normalizeIndianStaffPhone(value) {
  const digits = String(value || "").replace(/\D/gu, "");
  const nationalNumber = digits.startsWith("91") && digits.length === 12
    ? digits.slice(2)
    : digits;

  if (!/^[6-9]\d{9}$/u.test(nationalNumber)) return "";
  return `+91${nationalNumber}`;
}

export function maskIndianStaffPhone(value) {
  const phone = normalizeIndianStaffPhone(value);
  return phone ? `+91 •••••• ${phone.slice(-4)}` : "";
}

export function isApprovedStaffProfile(data) {
  return Boolean(data && data.active === true && STAFF_ROLES.has(data.role));
}

export function isFreshAuthAccount(metadata, now = Date.now()) {
  const createdAt = Date.parse(metadata?.creationTime || "");
  const lastSignInAt = Date.parse(metadata?.lastSignInTime || "");
  if (!Number.isFinite(createdAt) || !Number.isFinite(lastSignInAt)) return false;

  const accountAge = now - createdAt;
  const creationAndSignInDifference = Math.abs(lastSignInAt - createdAt);
  return accountAge >= -60_000
    && accountAge <= 5 * 60_000
    && creationAndSignInDifference <= 2 * 60_000;
}
