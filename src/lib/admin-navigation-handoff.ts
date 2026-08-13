export const ADMIN_NAVIGATION_HANDOFF_EVENT = "asher:admin-navigation-handoff";

const HANDOFF_TTL_MS = 2 * 60 * 1000;
const MAX_IDENTIFIER_LENGTH = 256;

export type AdminNavigationHandoff =
  | {
      destination: "/admin/patients";
      intent: "open-patient";
      patientId: string;
    }
  | {
      destination: "/admin/appointments";
      intent: "create-appointment";
      patientId: string;
    }
  | {
      destination: "/admin/consultations";
      intent: "open-patient-consultation";
      patientId: string;
    }
  | {
      destination: "/admin/consultations";
      intent: "open-appointment-consultation";
      appointmentId: string;
    }
  | {
      destination: "/admin/billing";
      intent: "create-invoice";
      patientId: string;
    }
  | {
      destination: "/admin/lab";
      intent: "create-lab-order";
      patientId: string;
    };

type HandoffEnvelope = {
  createdAt: number;
  payload: AdminNavigationHandoff;
};

let pendingHandoff: Readonly<HandoffEnvelope> | null = null;

function validIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validHandoff(payload: AdminNavigationHandoff) {
  if ("patientId" in payload && !validIdentifier(payload.patientId)) return false;
  if ("appointmentId" in payload && !validIdentifier(payload.appointmentId)) return false;

  switch (payload.intent) {
    case "open-patient":
      return payload.destination === "/admin/patients";
    case "create-appointment":
      return payload.destination === "/admin/appointments";
    case "open-patient-consultation":
    case "open-appointment-consultation":
      return payload.destination === "/admin/consultations";
    case "create-invoice":
      return payload.destination === "/admin/billing";
    case "create-lab-order":
      return payload.destination === "/admin/lab";
    default:
      return false;
  }
}

/**
 * Keeps one linked record identifier in memory for the next same-tab route.
 * Nothing is written to the URL, browser history, or persistent storage.
 */
export function stageAdminNavigationHandoff(
  payload: AdminNavigationHandoff,
  now = Date.now(),
) {
  if (!validHandoff(payload) || !Number.isFinite(now)) {
    throw new Error("Invalid clinic navigation handoff.");
  }

  pendingHandoff = Object.freeze({
    createdAt: now,
    payload: Object.freeze({ ...payload }) as AdminNavigationHandoff,
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ADMIN_NAVIGATION_HANDOFF_EVENT));
  }
}

/**
 * Returns and immediately clears a matching handoff. A handoff for another
 * route remains available until that route mounts or the short TTL expires.
 */
export function consumeAdminNavigationHandoff<
  Destination extends AdminNavigationHandoff["destination"],
>(destination: Destination, now = Date.now()) {
  const envelope = pendingHandoff;
  if (!envelope) return null;

  const age = now - envelope.createdAt;
  if (!Number.isFinite(age) || age < 0 || age > HANDOFF_TTL_MS) {
    pendingHandoff = null;
    return null;
  }

  if (envelope.payload.destination !== destination) return null;
  pendingHandoff = null;
  return { ...envelope.payload } as Extract<AdminNavigationHandoff, { destination: Destination }>;
}

export function clearAdminNavigationHandoff() {
  pendingHandoff = null;
}
