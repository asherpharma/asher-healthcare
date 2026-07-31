"use client";

import { InstallAppButton } from "@/components/pwa/PwaRegister";
import {
  CalendarDays,
  FlaskConical,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  ReceiptIndianRupee,
  Settings2,
  Smartphone,
  Stethoscope,
  UserRoundCog,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type MobileNavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

function primaryNavigationFor(role: string): MobileNavigationItem[] {
  if (role === "doctor") {
    return [
      { href: "/admin/consultations", label: "Consult", icon: Stethoscope },
      { href: "/admin/appointments", label: "Bookings", icon: CalendarDays },
      { href: "/admin/patients", label: "Patients", icon: UsersRound },
    ];
  }

  if (role === "reception") {
    return [
      { href: "/admin/appointments", label: "Bookings", icon: CalendarDays },
      { href: "/admin/patients", label: "Patients", icon: UsersRound },
      { href: "/admin/billing", label: "Billing", icon: ReceiptIndianRupee },
    ];
  }

  return [
    { href: "/admin", label: "Home", icon: LayoutDashboard },
    { href: "/admin/appointments", label: "Bookings", icon: CalendarDays },
    { href: "/admin/patients", label: "Patients", icon: UsersRound },
  ];
}

export default function MobileStaffNav({ role, onLogout }: { role: string; onLogout: () => void }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryNavigation = primaryNavigationFor(role);

  return (
    <>
      <nav
        aria-label="Staff app navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 shadow-[0_-12px_35px_rgba(15,23,42,0.12)] backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid max-w-md grid-cols-4">
          {primaryNavigation.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                aria-current={active ? "page" : undefined}
                className={
                  "relative flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-bold transition active:scale-95 " +
                  (active ? "text-[#233A59]" : "text-slate-500")
                }
              >
                {active ? <span className="absolute top-1.5 h-1 w-7 rounded-full bg-[#A8864A]" /> : null}
                <Icon size={22} strokeWidth={active ? 2.6 : 2} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More staff app options"
            aria-expanded={moreOpen}
            className="flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-bold text-slate-500 transition active:scale-95 active:bg-slate-100"
          >
            <Menu size={22} />
            <span>More</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button type="button" aria-label="Close more menu" onClick={() => setMoreOpen(false)} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="More staff app options"
            className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-y-auto rounded-t-[30px] bg-white px-5 pb-7 pt-4 shadow-2xl"
            style={{ paddingBottom: "max(1.75rem, env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Asher Staff</p>
                <h2 className="mt-1 text-xl font-bold text-[#233A59]">App tools</h2>
              </div>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="Close more menu" className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-600">
                <X size={19} />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {role === "admin" ? (
                <Link href="/admin/staff" onClick={() => setMoreOpen(false)} className="flex min-h-24 flex-col justify-between rounded-2xl bg-amber-50 p-4 font-bold text-amber-900">
                  <UserRoundCog size={25} />
                  Staff access
                </Link>
              ) : null}
              {role !== "doctor" ? (
                <Link href="/admin/consultations" onClick={() => setMoreOpen(false)} className="flex min-h-24 flex-col justify-between rounded-2xl bg-cyan-50 p-4 font-bold text-cyan-900">
                  <Stethoscope size={25} />
                  Consultations
                </Link>
              ) : null}
              {role !== "reception" ? (
                <Link href="/admin/billing" onClick={() => setMoreOpen(false)} className="flex min-h-24 flex-col justify-between rounded-2xl bg-emerald-50 p-4 font-bold text-emerald-900">
                  <ReceiptIndianRupee size={25} />
                  Billing
                </Link>
              ) : null}
              <Link href="/admin/tasks" onClick={() => setMoreOpen(false)} className="flex min-h-24 flex-col justify-between rounded-2xl bg-blue-50 p-4 font-bold text-blue-900">
                <ListTodo size={25} />
                Tasks
              </Link>
              <Link href="/admin/lab" onClick={() => setMoreOpen(false)} className="flex min-h-24 flex-col justify-between rounded-2xl bg-violet-50 p-4 font-bold text-violet-900">
                <FlaskConical size={25} />
                Lab desk
              </Link>
              <Link href="/admin/app" onClick={() => setMoreOpen(false)} className="flex min-h-24 flex-col justify-between rounded-2xl bg-slate-100 p-4 font-bold text-[#233A59]">
                <Smartphone size={25} />
                Mobile app
              </Link>
              {role === "admin" ? (
                <Link href="/admin/settings" onClick={() => setMoreOpen(false)} className="flex min-h-24 flex-col justify-between rounded-2xl bg-orange-50 p-4 font-bold text-orange-900">
                  <Settings2 size={25} />
                  Settings
                </Link>
              ) : null}
            </div>

            <div className="mt-4"><InstallAppButton wide /></div>
            <button type="button" onClick={onLogout} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700">
              <LogOut size={18} />
              Sign out securely
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
