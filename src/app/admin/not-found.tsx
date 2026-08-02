import { ArrowLeft, CalendarDays, Home, UsersRound } from "lucide-react";
import Link from "next/link";

export default function StaffNotFound() {
  return (
    <section className="mx-auto grid min-h-[65dvh] max-w-2xl place-items-center px-2 py-8">
      <div className="w-full rounded-[28px] border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Page not found</p>
        <h1 className="mt-2 text-2xl font-bold text-[#233A59] sm:text-3xl">That staff screen is not available.</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">
          Use one of the clinic shortcuts below. No patient or payment information was changed.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link href="/admin" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#233A59] px-4 font-bold text-white"><Home aria-hidden="true" size={18} /> Home</Link>
          <Link href="/admin/appointments" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold text-[#233A59]"><CalendarDays aria-hidden="true" size={18} /> Bookings</Link>
          <Link href="/admin/patients" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold text-[#233A59]"><UsersRound aria-hidden="true" size={18} /> Patients</Link>
        </div>
        <Link href="/admin" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft aria-hidden="true" size={16} /> Return to staff home</Link>
      </div>
    </section>
  );
}
