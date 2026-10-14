// Booking opens a separate untracked document.
import type { ReactNode } from "react";
import type { DoctorId } from "@/lib/appointments";

export default function CareBookingLink({ doctorId, children, className }: {
  doctorId: DoctorId;
  children: ReactNode;
  className?: string;
}) {
  // The fragment selects the specialist on the separate booking document and
  // keeps that choice out of request URLs and referrers.
  return <a href={`/book#appointment-${doctorId}`} className={className}>{children}</a>;
}
