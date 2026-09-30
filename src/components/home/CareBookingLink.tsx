"use client";

import type { MouseEvent, ReactNode } from "react";
import type { DoctorId } from "@/lib/appointments";
import { CARE_SELECTION_EVENT } from "@/lib/public-clinic-content";

export default function CareBookingLink({ doctorId, children, className }: {
  doctorId: DoctorId;
  children: ReactNode;
  className?: string;
}) {
  function selectDoctor(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const appointment = document.getElementById("appointment");
    if (!appointment) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent(CARE_SELECTION_EVENT, { detail: { doctorId } }));
    appointment.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    appointment.querySelector<HTMLSelectElement>('select[name="doctor"]')?.focus({ preventScroll: true });
  }

  // Fragments preserve the specialist when opened in a new tab without sending
  // the care choice in a query string, referrer or homepage measurement event.
  return <a href={`#appointment-${doctorId}`} className={className} onClick={selectDoctor}>{children}</a>;
}
