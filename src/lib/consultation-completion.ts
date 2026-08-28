export type ConsultationCompletionQueueEntry = {
  appointmentId?: string;
  patientId?: string;
  status: string;
};

export type CurrentConsultationSelection = {
  appointmentId?: string;
  patientId?: string;
};

const ACTIONABLE_CONSULTATION_STATUSES = new Set([
  "in_consultation",
  "waiting",
  "checked_in",
  "registered",
]);

export function nextActionableConsultationEntry<
  Entry extends ConsultationCompletionQueueEntry,
>(
  sortedEntries: readonly Entry[],
  current: CurrentConsultationSelection,
): Entry | null {
  const currentAppointmentId = String(current.appointmentId || "").trim();
  const currentPatientId = String(current.patientId || "").trim();
  const currentIsWalkIn = !currentAppointmentId;

  return sortedEntries.find((entry) => {
    if (!ACTIONABLE_CONSULTATION_STATUSES.has(entry.status)) return false;
    if (currentAppointmentId && entry.appointmentId === currentAppointmentId) return false;
    if (currentIsWalkIn && currentPatientId && entry.patientId === currentPatientId) return false;
    return true;
  }) ?? null;
}
