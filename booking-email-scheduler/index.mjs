const SWEEP_URL = "https://asherhealthcare.in/api/internal/booking-email-sweep";
const SWEEP_REQUEST_TIMEOUT_MS = 25_000;

export async function requestBookingEmailSweep(env, {
  fetchRequest = fetch,
  createSignal = () => AbortSignal.timeout(SWEEP_REQUEST_TIMEOUT_MS),
} = {}) {
  const secret = env?.BOOKING_ALERT_EMAIL_SWEEP_SECRET;
  if (typeof secret !== "string" || secret.length !== 43 || !/^[A-Za-z0-9_-]+$/u.test(secret)) {
    throw new Error("Booking email scheduler is not configured.");
  }
  try {
    const signal = createSignal();
    signal.throwIfAborted();
    const response = await fetchRequest(SWEEP_URL, {
      method: "POST",
      redirect: "manual",
      headers: { Authorization: `Bearer ${secret}` },
      signal,
    });
    if (response.status !== 204) throw new Error();
  } catch {
    // Cron Events can report failures without retaining the request or provider response.
    throw new Error("Booking email sweep request failed.");
  }
}

const bookingEmailScheduler = {
  async scheduled(_controller, env) {
    await requestBookingEmailSweep(env);
  },
};

export default bookingEmailScheduler;
