export const DEFAULT_SCHEDULE = {
  timezone: "Asia/Kolkata",
  enabledDays: [1, 2, 3, 4, 5, 6],
  doctors: {
    pediatrics: { enabled: true, startTime: "17:00", endTime: "20:00", slotMinutes: 15 },
    obg: { enabled: true, startTime: "17:00", endTime: "20:00", slotMinutes: 15 },
  },
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;

function validDoctorSchedule(candidate, fallback) {
  const slotMinutes = Number(candidate?.slotMinutes);
  return {
    enabled: candidate?.enabled !== false,
    startTime: TIME_PATTERN.test(candidate?.startTime || "") ? candidate.startTime : fallback.startTime,
    endTime: TIME_PATTERN.test(candidate?.endTime || "") ? candidate.endTime : fallback.endTime,
    slotMinutes: Number.isInteger(slotMinutes) && slotMinutes >= 5 && slotMinutes <= 120
      ? slotMinutes
      : fallback.slotMinutes,
  };
}

export function normalizeSchedule(value) {
  const days = Array.isArray(value?.enabledDays)
    ? [...new Set(value.enabledDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [...DEFAULT_SCHEDULE.enabledDays];
  return {
    timezone: "Asia/Kolkata",
    enabledDays: days.length ? days : [...DEFAULT_SCHEDULE.enabledDays],
    doctors: {
      pediatrics: validDoctorSchedule(value?.doctors?.pediatrics, DEFAULT_SCHEDULE.doctors.pediatrics),
      obg: validDoctorSchedule(value?.doctors?.obg, DEFAULT_SCHEDULE.doctors.obg),
    },
  };
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function timeSlots(doctorSchedule) {
  if (!doctorSchedule.enabled) return [];
  const start = timeToMinutes(doctorSchedule.startTime);
  const end = timeToMinutes(doctorSchedule.endTime);
  if (end <= start) return [];
  const values = [];
  for (let minute = start; minute < end && values.length < 96; minute += doctorSchedule.slotMinutes) {
    values.push(
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
    );
  }
  return values;
}

export function dateDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return -1;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? -1 : parsed.getUTCDay();
}

export function clinicDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}
