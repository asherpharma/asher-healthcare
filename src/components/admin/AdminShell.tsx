"use client";

import StaffGuard, { useStaff } from "@/components/admin/StaffGuard";
import MobileStaffNav from "@/components/admin/MobileStaffNav";
import { InstallAppButton, NetworkStatus } from "@/components/pwa/PwaRegister";
import { firebaseAuth } from "@/firebase/config";
import { CalendarDays, FlaskConical, LayoutDashboard, ListTodo, LogOut, ReceiptIndianRupee, Settings2, Stethoscope, UsersRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, adminOnly: true },
  { href: "/admin/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/admin/patients", label: "Patients", icon: UsersRound },
  { href: "/admin/tasks", label: "Tasks & follow-ups", icon: ListTodo },
  { href: "/admin/billing", label: "Billing", icon: ReceiptIndianRupee },
  { href: "/admin/lab", label: "Lab", icon: FlaskConical },
  { href: "/admin/settings", label: "Settings", icon: Settings2, adminOnly: true },
];

function StaffChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useStaff();

  async function logOut() {
    if (firebaseAuth) await firebaseAuth.signOut();
    router.replace("/admin/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-8 lg:py-4">
          <Link href="/admin" className="flex items-center gap-3">
            <Image src="/images/logo.png" alt="Asher Healthcare" width={44} height={44} className="h-10 w-10 rounded-xl object-contain sm:h-11 sm:w-11" />
            <div><p className="font-bold text-[#233A59]"><span className="sm:hidden">Asher Staff</span><span className="hidden sm:inline">Asher Healthcare</span></p><p className="hidden text-xs text-slate-500 sm:block">Secure clinic workspace</p></div>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <NetworkStatus />
            <InstallAppButton compact />
            <div className="hidden text-right sm:block"><p className="text-sm font-bold text-[#233A59]">{profile.displayName}</p><p className="text-xs capitalize text-slate-500">{profile.role}</p></div>
            <button onClick={logOut} className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 lg:inline-flex"><LogOut size={16} />Sign out</button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] gap-6 px-4 py-5 pb-28 sm:px-5 lg:grid-cols-[230px_1fr] lg:px-8 lg:py-8">
        <aside className="hidden rounded-2xl bg-[#233A59] p-3 text-white lg:block lg:min-h-[calc(100vh-8.5rem)]">
          <div className="flex items-center gap-2 px-3 py-3 text-xs font-bold uppercase tracking-[0.16em] text-white/60"><Stethoscope size={15} />Staff menu</div>
          <nav className="grid grid-cols-1 gap-2">
            {navigation.filter((item) => !item.adminOnly || profile.role === "admin").map((item) => {
              const Icon = item.icon;
              const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
              return <Link key={item.href} href={item.href} style={active ? { color: "#233A59" } : undefined} className={"flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition " + (active ? "bg-white" : "text-white/80 hover:bg-white/10 hover:text-white")}><Icon size={18} />{item.label}</Link>;
            })}
          </nav>
        </aside>
        <main id="main-content">{children}</main>
      </div>
      <MobileStaffNav role={profile.role} onLogout={() => void logOut()} />
    </div>
  );
}

export default function AdminShell({ children }: { children: ReactNode }) {
  return <StaffGuard><StaffChrome>{children}</StaffChrome></StaffGuard>;
}
