export const PATIENT_PORTAL_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

export function patientPortalActivityTimestamp(value: string | null, now = Date.now()) {
  const timestamp = Number(value);
  if (
    !Number.isFinite(timestamp)
    || timestamp <= 0
    || !Number.isFinite(now)
    || timestamp > now
    || now - timestamp >= PATIENT_PORTAL_IDLE_TIMEOUT_MS
  ) {
    return null;
  }
  return timestamp;
}
