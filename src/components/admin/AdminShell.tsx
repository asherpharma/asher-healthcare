"use client";

import StaffGuard, { useStaff } from "@/components/admin/StaffGuard";
import MobileStaffNav from "@/components/admin/MobileStaffNav";
import StaffCommandCenter from "@/components/admin/StaffCommandCenter";
import StaffSessionProtection, { type StaffLockReason } from "@/components/admin/StaffSessionProtection";
import { STAFF_TOOL_GROUP_LABELS, STAFF_TOOL_ICONS } from "@/components/admin/staff-tool-ui";
import { InstallAppButton, NetworkStatus } from "@/components/pwa/PwaRegister";
import { firebaseAuth } from "@/firebase/config";
import {
  STAFF_TOOL_GROUPS,
  groupedStaffToolsForRole,
  primaryStaffToolsForRole,
} from "@/lib/staff-navigation";
import { LockKeyhole, Stethoscope } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

function StaffChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useStaff();
  const groupedNavigation = useMemo(
    () => groupedStaffToolsForRole(profile.role),
    [profile.role],
  );

  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }).connection;
    if (connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return;

    const priorityRoutes = primaryStaffToolsForRole(profile.role)
      .slice(0, 2)
      .map((tool) => tool.href);
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let timeout: number | undefined;
    let idleHandle: number | undefined;
    const prefetch = () => {
      for (const route of priorityRoutes) router.prefetch(route);
    };

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
    <div data-app-version="ease-v3" className="staff-app-shell min-h-dvh bg-slate-50 text-slate-950">
      <header className="staff-app-header sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
        <div className="staff-app-header-inner mx-auto flex max-w-[1440px] items-center justify-between gap-2 px-3 py-2.5 xl:gap-3 xl:px-8 xl:py-4">
          <Link href="/admin" className="flex min-w-0 items-center gap-2.5 xl:gap-3">
            <Image src="/images/logo.png" alt="Asher Healthcare" width={44} height={44} className="h-10 w-10 shrink-0 rounded-xl object-contain xl:h-11 xl:w-11" />
            <div className="min-w-0"><p className="truncate font-bold text-[#233A59]"><span className="xl:hidden">Asher Staff</span><span className="hidden xl:inline">Asher Healthcare</span></p><p className="hidden text-xs text-slate-500 xl:block">Secure clinic workspace</p></div>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 xl:gap-3">
            <StaffCommandCenter
              key={`${profile.uid}:${profile.role}:${profile.doctorName || "unassigned"}`}
              role={profile.role}
            />
            <NetworkStatus />
            <span className="staff-role-chip rounded-full bg-[#233A59] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white xl:hidden">{profile.role}</span>
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
          <nav className="space-y-3" aria-label="Staff workspace">
            {STAFF_TOOL_GROUPS.map((group) => {
              const tools = groupedNavigation[group];
              if (!tools.length) return null;
              return (
                <section key={group} aria-labelledby={`staff-nav-${group}`}>
                  <p id={`staff-nav-${group}`} className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                    {STAFF_TOOL_GROUP_LABELS[group]}
                  </p>
                  <div className="grid gap-1">
                    {tools.map((tool) => {
                      const Icon = STAFF_TOOL_ICONS[tool.icon];
                      const active = tool.href === "/admin" ? pathname === tool.href : pathname.startsWith(tool.href);
                      return (
                        <Link
                          key={tool.id}
                          href={tool.href}
                          prefetch={false}
                          aria-current={active ? "page" : undefined}
                          style={active ? { color: "#233A59" } : undefined}
                          className={"flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition " + (active ? "bg-white" : "text-white/80 hover:bg-white/10 hover:text-white")}
                        >
                          <Icon aria-hidden="true" size={18} />
                          {tool.label}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
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
