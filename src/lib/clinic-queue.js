const WAITING_STATUSES = new Set(["checked_in", "waiting"]);

function timestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function elapsedMinutes(start, end) {
  const startMillis = timestampMillis(start);
  const endMillis = timestampMillis(end);
  if (startMillis === null || endMillis === null || endMillis < startMillis) return null;
  return Math.floor((endMillis - startMillis) / 60_000);
}

/**
 * Produces privacy-safe operational queue metrics from appointment timestamps.
 * The result never includes patient identifiers or clinical information.
 */
export function clinicQueueHealth(appointments, options = {}) {
  const nowMillis = timestampMillis(options.now) ?? Date.now();
  const delayThresholdMinutes = Math.max(1, Number(options.delayThresholdMinutes) || 30);
  const records = Array.isArray(appointments) ? appointments : [];

  const waitingDurations = records
    .filter((appointment) => WAITING_STATUSES.has(appointment?.status))
    .map((appointment) => elapsedMinutes(
      appointment.waitingAt || appointment.checkedInAt || appointment.updatedAt || appointment.createdAt,
      nowMillis,
    ))
    .filter((minutes) => minutes !== null && minutes >= 0 && minutes <= 24 * 60);

  const completedDurations = records
    .filter((appointment) => appointment?.status === "completed")
    .map((appointment) => elapsedMinutes(appointment.consultationStartedAt, appointment.completedAt))
    .filter((minutes) => minutes !== null && minutes >= 0 && minutes <= 8 * 60);

  const average = (values) => values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;

  return {
    waiting: records.filter((appointment) => WAITING_STATUSES.has(appointment?.status)).length,
    waitingWithTimestamp: waitingDurations.length,
    consulting: records.filter((appointment) => appointment?.status === "in_consultation").length,
    delayed: waitingDurations.filter((minutes) => minutes >= delayThresholdMinutes).length,
    averageWaitMinutes: average(waitingDurations),
    longestWaitMinutes: waitingDurations.length ? Math.max(...waitingDurations) : 0,
    averageConsultationMinutes: average(completedDurations),
    completedWithDuration: completedDurations.length,
    delayThresholdMinutes,
  };
}

