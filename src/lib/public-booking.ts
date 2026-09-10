import type { AppointmentSchedule, DoctorId } from "./appointments";

const PUBLIC_BOOKING_DOCTORS = new Set<DoctorId>(["pediatrics", "obg"]);

export const PUBLIC_BOOKING_WHATSAPP_URL =
  "https://wa.me/919019263709?text=Hello%20Asher%20Healthcare%2C%20I%20submitted%20an%20online%20appointment%20request%20and%20would%20like%20help%20with%20confirmation.";

export function publicBookingHref(doctorId?: DoctorId | null) {
  return doctorId ? `/?care=${doctorId}#appointment` : "/#appointment";
}

export function publicBookingDoctor(value: unknown): DoctorId | null {
  return typeof value === "string" && PUBLIC_BOOKING_DOCTORS.has(value as DoctorId)
    ? value as DoctorId
    : null;
}

export function nextPublicBookingDate(
  schedule: Pick<AppointmentSchedule, "enabledDays">,
  fromDate: string,
  maxDays = 14,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(fromDate)) return "";
  const start = new Date(`${fromDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== fromDate) return "";

  const requestedDays = Number.isFinite(maxDays) ? Math.trunc(maxDays) : 14;
  const searchDays = Math.min(14, Math.max(1, requestedDays));
  for (let offset = 1; offset <= searchDays; offset += 1) {
    const candidate = new Date(start);
    candidate.setUTCDate(start.getUTCDate() + offset);
    if (schedule.enabledDays.includes(candidate.getUTCDay())) {
      return candidate.toISOString().slice(0, 10);
    }
  }
  return "";
}
