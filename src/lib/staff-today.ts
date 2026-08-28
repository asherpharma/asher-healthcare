import type { AppointmentStatus } from "@/lib/visit-workflow";

export const STAFF_TODAY_APPOINTMENT_LIMIT = 80;
export const STAFF_TODAY_TASK_LIMIT = 60;

export type StaffTodayRole = "doctor" | "reception";

export type StaffTodayAppointment = {
  id: string;
  patientId?: string;
  patientName: string;
  doctorId: string;
  preferredDate: string;
  preferredTime: string;
  status: AppointmentStatus;
  queueToken?: number;
};

export type StaffTodayTask = {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  dueDate: string;
  dueTime: string;
  patientName?: string;
};

export type StaffTodayLabOrder = {
  id: string;
  orderNumber: string;
  patientName: string;
  clinician: string;
  priority: string;
  status: string;
  tests?: string[];
};

const RECEPTION_STATUS_ORDER: Readonly<Record<AppointmentStatus, number>> = {
  requested: 0,
  confirmed: 1,
  checked_in: 2,
  waiting: 3,
  in_consultation: 4,
  completed: 5,
  no_show: 6,
  cancelled: 7,
};

const DOCTOR_STATUS_ORDER: Readonly<Record<AppointmentStatus, number>> = {
  in_consultation: 0,
  waiting: 1,
  checked_in: 2,
  confirmed: 3,
  requested: 4,
  completed: 5,
  no_show: 6,
  cancelled: 7,
};

const ACTIVE_STATUSES = new Set<AppointmentStatus>([
  "requested",
  "confirmed",
  "checked_in",
  "waiting",
  "in_consultation",
]);

const IN_CLINIC_STATUSES = new Set<AppointmentStatus>([
  "checked_in",
  "waiting",
  "in_consultation",
]);

const ACTIVE_LAB_STATUSES = new Set(["ordered", "collected", "processing"]);
const PRIORITY_ORDER: Readonly<Record<string, number>> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function staffDoctorId(doctorName?: string) {
  const normalized = String(doctorName || "").trim().toLocaleLowerCase("en-IN");
  if (normalized === "dr. lt col shafi ahamad" || normalized === "dr lt col shafi ahamad") {
    return "pediatrics";
  }
  if (normalized === "dr. shaik reshma" || normalized === "dr shaik reshma") {
    return "obg";
  }
  return null;
}

export function clinicDateInIndia(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value || ""
  );
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function operationalAppointments(
  appointments: readonly StaffTodayAppointment[],
  role: StaffTodayRole,
) {
  const statusOrder = role === "doctor" ? DOCTOR_STATUS_ORDER : RECEPTION_STATUS_ORDER;
  return appointments
    .filter((appointment) => ACTIVE_STATUSES.has(appointment.status))
    .slice()
    .sort((left, right) => {
      const statusDifference = statusOrder[left.status] - statusOrder[right.status];
      if (statusDifference !== 0) return statusDifference;
      if (role === "doctor") {
        const leftToken = Number.isInteger(left.queueToken) ? Number(left.queueToken) : Number.MAX_SAFE_INTEGER;
        const rightToken = Number.isInteger(right.queueToken) ? Number(right.queueToken) : Number.MAX_SAFE_INTEGER;
        if (leftToken !== rightToken) return leftToken - rightToken;
      }
      return left.preferredTime.localeCompare(right.preferredTime) || left.patientName.localeCompare(right.patientName);
    });
}

export function appointmentTodayCounts(appointments: readonly StaffTodayAppointment[]) {
  return {
    requested: appointments.filter((appointment) => appointment.status === "requested").length,
    expected: appointments.filter((appointment) => appointment.status === "confirmed").length,
    inClinic: appointments.filter((appointment) => IN_CLINIC_STATUSES.has(appointment.status)).length,
    waiting: appointments.filter((appointment) => appointment.status === "checked_in" || appointment.status === "waiting").length,
    consulting: appointments.filter((appointment) => appointment.status === "in_consultation").length,
    completed: appointments.filter((appointment) => appointment.status === "completed").length,
  };
}

export function dueStaffTasks(tasks: readonly StaffTodayTask[], today: string) {
  return tasks
    .filter((task) => task.status === "open" && task.dueDate <= today)
    .slice()
    .sort((left, right) => {
      const dateDifference = left.dueDate.localeCompare(right.dueDate);
      if (dateDifference !== 0) return dateDifference;
      const priorityDifference = (PRIORITY_ORDER[left.priority] ?? 9) - (PRIORITY_ORDER[right.priority] ?? 9);
      if (priorityDifference !== 0) return priorityDifference;
      return left.dueTime.localeCompare(right.dueTime);
    });
}

export function urgentDoctorLabs(
  orders: readonly StaffTodayLabOrder[],
  doctorName: string,
) {
  return orders.filter((order) => (
    order.priority === "urgent"
    && ACTIVE_LAB_STATUSES.has(order.status)
    && order.clinician === doctorName
  ));
}
