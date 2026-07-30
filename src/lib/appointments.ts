export const CLINIC_TIME_ZONE = "Asia/Kolkata";

export const DOCTORS = [
  {
    id: "pediatrics",
    name: "Dr. Lt Col Shafi Ahamad",
    specialty: "Pediatrics",
    label: "Dr. Lt Col Shafi Ahamad — Pediatrics",
  },
  {
    id: "obg",
    name: "Dr. Shaik Reshma",
    specialty: "Obstetrics & Gynaecology",
    label: "Dr. Shaik Reshma — Obstetrics & Gynaecology",
  },
] as const;

export type DoctorId = (typeof DOCTORS)[number]["id"];

export type DoctorSchedule = {
  enabled: boolean;
  startTime: string;
  endTime: string;
  slotMinutes: number;
};

export type AppointmentSchedule = {
  timezone: string;
  enabledDays: number[];
  doctors: Record<DoctorId, DoctorSchedule>;
};

export const DEFAULT_APPOINTMENT_SCHEDULE: AppointmentSchedule = {
  timezone: CLINIC_TIME_ZONE,
  enabledDays: [1, 2, 3, 4, 5, 6],
  doctors: {
    pediatrics: {
      enabled: true,
      startTime: "17:00",
      endTime: "20:00",
      slotMinutes: 15,
    },
    obg: {
      enabled: true,
      startTime: "17:00",
      endTime: "20:00",
      slotMinutes: 15,
    },
  },
};

export const WEEK_DAYS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
] as const;

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/u;

function validTime(value: unknown, fallback: string) {
  return typeof value === "string" && timePattern.test(value) ? value : fallback;
}

function normalizeDoctorSchedule(value: unknown, fallback: DoctorSchedule): DoctorSchedule {
  if (!value || typeof value !== "object") return { ...fallback };
  const candidate = value as Partial<DoctorSchedule>;
  const slotMinutes = Number(candidate.slotMinutes);
  return {
    enabled: candidate.enabled !== false,
    startTime: validTime(candidate.startTime, fallback.startTime),
    endTime: validTime(candidate.endTime, fallback.endTime),
    slotMinutes: Number.isInteger(slotMinutes) && slotMinutes >= 5 && slotMinutes <= 120
      ? slotMinutes
      : fallback.slotMinutes,
  };
}

export function normalizeAppointmentSchedule(value: unknown): AppointmentSchedule {
  if (!value || typeof value !== "object") {
    return {
      ...DEFAULT_APPOINTMENT_SCHEDULE,
      enabledDays: [...DEFAULT_APPOINTMENT_SCHEDULE.enabledDays],
      doctors: {
        pediatrics: { ...DEFAULT_APPOINTMENT_SCHEDULE.doctors.pediatrics },
        obg: { ...DEFAULT_APPOINTMENT_SCHEDULE.doctors.obg },
      },
    };
  }

  const candidate = value as Partial<AppointmentSchedule>;
  const enabledDays = Array.isArray(candidate.enabledDays)
    ? [...new Set(candidate.enabledDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [...DEFAULT_APPOINTMENT_SCHEDULE.enabledDays];
  const doctors = candidate.doctors as Partial<Record<DoctorId, DoctorSchedule>> | undefined;

  return {
    timezone: CLINIC_TIME_ZONE,
    enabledDays: enabledDays.length > 0 ? enabledDays : [...DEFAULT_APPOINTMENT_SCHEDULE.enabledDays],
    doctors: {
      pediatrics: normalizeDoctorSchedule(
        doctors?.pediatrics,
        DEFAULT_APPOINTMENT_SCHEDULE.doctors.pediatrics,
      ),
      obg: normalizeDoctorSchedule(
        doctors?.obg,
        DEFAULT_APPOINTMENT_SCHEDULE.doctors.obg,
      ),
    },
  };
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function generateTimeSlots(schedule: DoctorSchedule) {
  if (!schedule.enabled) return [];
  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);
  if (end <= start || schedule.slotMinutes < 5) return [];

  const slots: string[] = [];
  for (let minute = start; minute < end && slots.length < 96; minute += schedule.slotMinutes) {
    const hours = Math.floor(minute / 60);
    const minutes = minute % 60;
    slots.push(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
  }
  return slots;
}

export function formatAppointmentTime(value: string) {
  if (!timePattern.test(value)) return value;
  const [hourValue, minute] = value.split(":").map(Number);
  const period = hourValue >= 12 ? "PM" : "AM";
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

export function clinicDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return [value("year"), value("month"), value("day")].join("-");
}

export function dayForDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return -1;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? -1 : parsed.getUTCDay();
}

export function dateIsEnabled(schedule: AppointmentSchedule, value: string) {
  return schedule.enabledDays.includes(dayForDate(value));
}

export function nextEnabledDate(schedule: AppointmentSchedule, fromDate = clinicDate()) {
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = new Date(cursor);
    candidate.setUTCDate(cursor.getUTCDate() + offset);
    const value = candidate.toISOString().slice(0, 10);
    if (dateIsEnabled(schedule, value)) return value;
  }
  return fromDate;
}

export function appointmentSlotId(doctorId: DoctorId, date: string, time: string) {
  return `${doctorId}_${date}_${time.replace(":", "")}`;
}

export function doctorName(doctorId: string) {
  return DOCTORS.find((doctor) => doctor.id === doctorId)?.name ?? doctorId;
}

export function scheduleSummary(schedule: AppointmentSchedule, doctorId: DoctorId) {
  const doctor = schedule.doctors[doctorId];
  if (!doctor.enabled) return "Appointments paused";
  return `${formatAppointmentTime(doctor.startTime)}–${formatAppointmentTime(doctor.endTime)}, ${doctor.slotMinutes}-minute slots`;
}
