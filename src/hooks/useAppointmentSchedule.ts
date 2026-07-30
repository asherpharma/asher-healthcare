"use client";

import { firestore } from "@/firebase/config";
import {
  DEFAULT_APPOINTMENT_SCHEDULE,
  normalizeAppointmentSchedule,
  type AppointmentSchedule,
} from "@/lib/appointments";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";

export function useAppointmentSchedule() {
  const [schedule, setSchedule] = useState<AppointmentSchedule>(() =>
    normalizeAppointmentSchedule(DEFAULT_APPOINTMENT_SCHEDULE)
  );
  const [loading, setLoading] = useState(Boolean(firestore));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firestore) return;

    return onSnapshot(
      doc(firestore, "clinicSettings", "appointmentSchedule"),
      (snapshot) => {
        setSchedule(normalizeAppointmentSchedule(snapshot.data()));
        setLoading(false);
        setError("");
      },
      () => {
        setLoading(false);
        setError("Live appointment timings could not be refreshed.");
      },
    );
  }, []);

  return { schedule, loading, error };
}
