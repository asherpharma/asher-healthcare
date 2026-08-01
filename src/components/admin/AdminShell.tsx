"use client";

import StaffGuard, { type StaffRole, useStaff } from "@/components/admin/StaffGuard";
import MobileStaffNav from "@/components/admin/MobileStaffNav";
import StaffCommandCenter from "@/components/admin/StaffCommandCenter";
import StaffSessionProtection, { type StaffLockReason } from "@/components/admin/StaffSessionProtection";
import { InstallAppButton, NetworkStatus } from "@/components/pwa/PwaRegister";
import { firebaseAuth } from "@/firebase/config";
import { CalendarDays, FlaskConical, LayoutDashboard, ListTodo, LockKeyhole, ReceiptIndianRupee, Settings2, Smartphone, Stethoscope, UserRoundCog, UsersRound, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  roles?: StaffRole[];
};

const navigation: NavigationItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, adminOnly: true },
  { href: "/admin/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/admin/consultations", label: "Consultations", icon: Stethoscope, roles: ["admin", "doctor"] },
  { href: "/admin/patients", label: "Patients", icon: UsersRound },
  { href: "/admin/tasks", label: "Tasks & follow-ups", icon: ListTodo },
  { href: "/admin/billing", label: "Billing", icon: ReceiptIndianRupee },
  { href: "/admin/lab", label: "Lab", icon: FlaskConical },
  { href: "/admin/staff", label: "Staff access", icon: UserRoundCog, adminOnly: true },
  { href: "/admin/app", label: "Mobile app", icon: Smartphone },
  { href: "/admin/settings", label: "Settings", icon: Settings2, adminOnly: true },
];

function StaffChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useStaff();

  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }).connection;
    if (connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return;

    const priorityRoute = profile.role === "doctor"
      ? "/admin/consultations"
      : "/admin/appointments";
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let timeout: number | undefined;
    let idleHandle: number | undefined;
    const prefetch = () => router.prefetch(priorityRoute);

    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(prefetch, { timeout: 2500 });
    } else {
      timeout = window.setTimeout(prefetch, 1600);
    }

    return () => {
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [profile.role, router]);

  const lockApp = useCallback(async (reason: StaffLockReason = "manual") => {
    try {
      if (firebaseAuth) await firebaseAuth.signOut();
    } catch {
      // The login redirect still protects the UI if Firebase is temporarily unavailable.
    } finally {
      const loginReason = reason === "inactivity" ? "inactivity" : "locked";
      router.replace(`/admin/login?reason=${loginReason}`);
    }
  }, [router]);

  return (
    <div data-app-version="mobile-v2" className="staff-app-shell min-h-dvh bg-slate-50 text-slate-950">
      <header className="staff-app-header sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
        <div className="staff-app-header-inner mx-auto flex max-w-[1440px] items-center justify-between gap-2 px-3 py-2.5 xl:gap-3 xl:px-8 xl:py-4">
          <Link href="/admin" className="flex min-w-0 items-center gap-2.5 xl:gap-3">
            <Image src="/images/logo.png" alt="Asher Healthcare" width={44} height={44} className="h-10 w-10 shrink-0 rounded-xl object-contain xl:h-11 xl:w-11" />
            <div className="min-w-0"><p className="truncate font-bold text-[#233A59]"><span className="xl:hidden">Asher Staff</span><span className="hidden xl:inline">Asher Healthcare</span></p><p className="hidden text-xs text-slate-500 xl:block">Secure clinic workspace</p></div>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 xl:gap-3">
            <StaffCommandCenter role={profile.role} />
            <NetworkStatus />
            <span className="staff-role-chip rounded-full bg-[#233A59] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white xl:hidden">V2 {profile.role}</span>
            <div className="hidden xl:block"><InstallAppButton compact /></div>
            <div className="hidden text-right xl:block"><p className="text-sm font-bold text-[#233A59]">{profile.displayName}</p><p className="text-xs capitalize text-slate-500">{profile.role}</p></div>
            <button onClick={() => void lockApp("manual")} className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59] xl:inline-flex"><LockKeyhole aria-hidden="true" size={16} />Lock app</button>
          </div>
        </div>
      </header>
      <NavigationFeedback />
      <div className="staff-app-layout mx-auto grid w-full max-w-[1440px] gap-5 px-3 py-4 pb-28 sm:px-5 xl:grid-cols-[230px_minmax(0,1fr)] xl:gap-6 xl:px-8 xl:py-8 xl:pb-8">
        <aside className="staff-desktop-sidebar hidden rounded-2xl bg-[#233A59] p-3 text-white xl:block xl:min-h-[calc(100vh-8.5rem)]">
          <div className="flex items-center gap-2 px-3 py-3 text-xs font-bold uppercase tracking-[0.16em] text-white/60"><Stethoscope size={15} />Staff menu</div>
          <nav className="grid grid-cols-1 gap-2">
            {navigation.filter((item) =>
              (!item.adminOnly || profile.role === "admin")
              && (!item.roles || item.roles.includes(profile.role)),
            ).map((item) => {
              const Icon = item.icon;
              const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
              return <Link key={item.href} href={item.href} style={active ? { color: "#233A59" } : undefined} className={"flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition " + (active ? "bg-white" : "text-white/80 hover:bg-white/10 hover:text-white")}><Icon size={18} />{item.label}</Link>;
            })}
          </nav>
        </aside>
        <main id="main-content" className="staff-app-content min-w-0">{children}</main>
      </div>
      <StaffSessionProtection onLock={lockApp} />
      <MobileStaffNav role={profile.role} onLock={() => void lockApp("manual")} />
    </div>
  );
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") return children;
  return <StaffGuard><StaffChrome>{children}</StaffChrome></StaffGuard>;
}

function NavigationFeedback() {
  const pathname = usePathname();
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const moving = Boolean(targetPath && targetPath !== pathname);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[href^="/admin"]');
      if (!link || link.target === "_blank" || link.pathname === window.location.pathname) return;
      setTargetPath(link.pathname);
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!targetPath) return;
    const timeout = window.setTimeout(() => setTargetPath(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [targetPath]);

  return (
    <div
      aria-hidden="true"
      className={"pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden transition-opacity " + (moving ? "opacity-100" : "opacity-0")}
    >
      <span className="block h-full w-1/2 animate-[staff-route-progress_1s_ease-in-out_infinite] rounded-full bg-[#D4A75F] shadow-[0_0_14px_rgba(212,167,95,0.8)]" />
    </div>
  );
}
