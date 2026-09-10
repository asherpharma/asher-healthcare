"use client";

import { CARE_SELECTION_EVENT } from "@/lib/public-clinic-content";
import { publicBookingHref } from "@/lib/public-booking";
import type { DoctorId } from "@/lib/appointments";
import type { MouseEvent, ReactNode } from "react";

type PublicBookingLinkProps = {
  children: ReactNode;
  className?: string;
  doctorId: DoctorId;
};

export default function PublicBookingLink({
  children,
  className,
  doctorId,
}: PublicBookingLinkProps) {
  const href = publicBookingHref(doctorId);

  function chooseSpecialist(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || window.location.pathname !== "/"
    ) return;

    const appointment = document.getElementById("appointment");
    if (!appointment) return;

    event.preventDefault();
    window.history.replaceState(null, "", href);
    window.dispatchEvent(
      new CustomEvent(CARE_SELECTION_EVENT, { detail: { doctorId } }),
    );
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    appointment.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    appointment.querySelector<HTMLFormElement>("form")?.focus({ preventScroll: true });
  }

  return (
    <a className={className} href={href} onClick={chooseSpecialist}>
      {children}
    </a>
  );
}
