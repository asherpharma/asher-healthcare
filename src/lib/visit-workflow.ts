export const APPOINTMENT_STATUSES = [
  "requested",
  "confirmed",
  "checked_in",
  "waiting",
  "in_consultation",
  "completed",
  "no_show",
  "cancelled",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type QueueStatus = AppointmentStatus | "registered";

export const APPOINTMENT_STATUS_OPTIONS: ReadonlyArray<{
  value: AppointmentStatus;
  label: string;
}> = [
  { value: "requested", label: "Requested" },
  { value: "confirmed", label: "Confirmed" },
  { value: "checked_in", label: "Checked in" },
  { value: "waiting", label: "Waiting" },
  { value: "in_consultation", label: "In consultation" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No-show" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_LABELS: Record<QueueStatus, string> = {
  requested: "Needs confirmation",
  confirmed: "Expected",
  checked_in: "Checked in",
  waiting: "Waiting",
  in_consultation: "In consultation",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
  registered: "Walk-in registered",
};

const STATUS_TONES: Record<QueueStatus, string> = {
  requested: "bg-amber-50 text-amber-800 ring-amber-200",
  confirmed: "bg-blue-50 text-blue-800 ring-blue-200",
  checked_in: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  waiting: "bg-violet-50 text-violet-800 ring-violet-200",
  in_consultation: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  no_show: "bg-orange-50 text-orange-800 ring-orange-200",
  cancelled: "bg-red-50 text-red-800 ring-red-200",
  registered: "bg-slate-100 text-slate-700 ring-slate-200",
};

const NEXT_STATUSES: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "no_show", "cancelled"],
  checked_in: ["waiting", "no_show"],
  waiting: ["in_consultation", "no_show"],
  in_consultation: ["completed", "waiting"],
  completed: [],
  no_show: ["checked_in", "cancelled"],
  cancelled: [],
};

const QUEUE_STAGE: Record<QueueStatus, number> = {
  in_consultation: 0,
  waiting: 1,
  checked_in: 2,
  registered: 3,
  confirmed: 4,
  requested: 5,
  no_show: 6,
  completed: 7,
  cancelled: 8,
};

export function appointmentStatusLabel(status: QueueStatus) {
  return STATUS_LABELS[status];
}

export function appointmentStatusTone(status: QueueStatus) {
  return STATUS_TONES[status];
}

export function appointmentTransitionOptions(status: AppointmentStatus) {
  return NEXT_STATUSES[status];
}

export function appointmentStatusTimestampField(status: AppointmentStatus) {
  if (status === "checked_in") return "checkedInAt";
  if (status === "waiting") return "waitingAt";
  if (status === "in_consultation") return "consultationStartedAt";
  if (status === "completed") return "completedAt";
  if (status === "no_show") return "noShowAt";
  return null;
}

export function queueStage(status: QueueStatus) {
  return QUEUE_STAGE[status];
}

export function isWaitingStatus(status: QueueStatus) {
  return status === "checked_in" || status === "waiting" || status === "registered";
}

export function isLiveQueueStatus(status: QueueStatus) {
  return status !== "cancelled" && status !== "no_show";
}

export function queueTokenLabel(token: number | undefined, doctorId?: string) {
  if (!token || token < 1) return "";
  const prefix = doctorId === "obg" ? "G" : "P";
  return `${prefix}-${String(token).padStart(2, "0")}`;
}

type QueueTokenRecord = {
  id: string;
  doctorId: string;
  preferredDate: string;
  queueToken?: number;
};

export function nextQueueToken(
  appointments: readonly QueueTokenRecord[],
  target: Pick<QueueTokenRecord, "id" | "doctorId" | "preferredDate">,
) {
  const used = new Set(
    appointments
      .filter((appointment) => appointment.id !== target.id)
      .filter((appointment) => appointment.doctorId === target.doctorId)
      .filter((appointment) => appointment.preferredDate === target.preferredDate)
      .map((appointment) => appointment.queueToken)
      .filter((token): token is number => Number.isInteger(token) && Number(token) > 0),
  );
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}
