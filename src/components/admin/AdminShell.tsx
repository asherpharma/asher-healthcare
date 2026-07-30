"use client";

import StaffGuard, { useStaff } from "@/components/admin/StaffGuard";
import { InstallAppButton } from "@/components/pwa/PwaRegister";
import { firebaseAuth } from "@/firebase/config";
import { CalendarDays, FlaskConical, LayoutDashboard, LogOut, ReceiptIndianRupee, Settings2, Stethoscope, UsersRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/admin/patients", label: "Patients", icon: UsersRound },
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
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <Link href="/admin" className="flex items-center gap-3">
            <Image src="/images/logo.png" alt="Asher Healthcare" width={44} height={44} className="h-11 w-11 rounded-xl object-contain" />
            <div><p className="font-bold text-[#233A59]">Asher Healthcare</p><p className="text-xs text-slate-500">Secure clinic workspace</p></div>
          </Link>
          <div className="flex items-center gap-3">
            <InstallAppButton />
            <div className="hidden text-right sm:block"><p className="text-sm font-bold text-[#233A59]">{profile.displayName}</p><p className="text-xs capitalize text-slate-500">{profile.role}</p></div>
            <button onClick={logOut} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"><LogOut size={16} />Sign out</button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] gap-6 px-5 py-6 lg:grid-cols-[230px_1fr] lg:px-8 lg:py-8">
        <aside className="rounded-2xl bg-[#233A59] p-3 text-white lg:min-h-[calc(100vh-8.5rem)]">
          <div className="flex items-center gap-2 px-3 py-3 text-xs font-bold uppercase tracking-[0.16em] text-white/60"><Stethoscope size={15} />Staff menu</div>
          <nav className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-1 lg:overflow-visible lg:pb-0">
            {navigation.filter((item) => !item.adminOnly || profile.role === "admin").map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return <Link key={item.href} href={item.href} style={active ? { color: "#233A59" } : undefined} className={"flex min-w-[130px] items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition lg:min-w-0 lg:justify-start " + (active ? "bg-white" : "text-white/80 hover:bg-white/10 hover:text-white")}><Icon size={18} />{item.label}</Link>;
            })}
          </nav>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

export default function AdminShell({ children }: { children: ReactNode }) {
  return <StaffGuard><StaffChrome>{children}</StaffChrome></StaffGuard>;
}
