"use client";

import {
  STAFF_TOOL_GROUP_LABELS,
  STAFF_TOOL_GROUP_TONES,
  STAFF_TOOL_ICONS,
} from "@/components/admin/staff-tool-ui";
import { InstallAppButton } from "@/components/pwa/PwaRegister";
import {
  STAFF_TOOL_GROUPS,
  groupedStaffToolsForRole,
  primaryStaffToolsForRole,
  type StaffRole,
} from "@/lib/staff-navigation";
import { LockKeyhole, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

function toolIsActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname.startsWith(href);
}

export default function MobileStaffNav({ role, onLock }: { role: StaffRole; onLock: () => void }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const primaryNavigation = useMemo(() => primaryStaffToolsForRole(role), [role]);
  const groupedNavigation = useMemo(() => groupedStaffToolsForRole(role), [role]);
  const primaryIds = useMemo(
    () => new Set(primaryNavigation.map((tool) => tool.id)),
    [primaryNavigation],
  );

  useEffect(() => {
    if (!moreOpen) return;

    const previousOverflow = document.body.style.overflow;
    const returnFocusTarget = moreButtonRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMoreOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusTarget?.focus();
    };
  }, [moreOpen]);

  return (
    <>
      <nav
        aria-label="Staff app navigation"
        className="staff-mobile-nav fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 shadow-[0_-12px_35px_rgba(15,23,42,0.12)] backdrop-blur-xl xl:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid w-full grid-cols-4">
          {primaryNavigation.map((tool) => {
            const Icon = STAFF_TOOL_ICONS[tool.icon];
            const active = toolIsActive(pathname, tool.href);
            return (
              <Link
                key={tool.id}
                href={tool.href}
                prefetch={false}
                onClick={() => setMoreOpen(false)}
                aria-current={active ? "page" : undefined}
                className={
                  "relative flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-bold transition active:scale-95 " +
                  (active ? "text-[#233A59]" : "text-slate-500")
                }
              >
                {active ? <span className="absolute top-1.5 h-1 w-7 rounded-full bg-[#A8864A]" /> : null}
                <Icon aria-hidden="true" size={22} strokeWidth={active ? 2.6 : 2} />
                <span>{tool.shortLabel}</span>
              </Link>
            );
          })}
          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More staff app options"
            aria-expanded={moreOpen}
            aria-controls="staff-more-menu"
            className="flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-bold text-slate-500 transition active:scale-95 active:bg-slate-100"
          >
            <Menu aria-hidden="true" size={22} />
            <span>More</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="staff-mobile-nav fixed inset-0 z-[70] xl:hidden">
          <button type="button" aria-label="Close more menu" onClick={() => setMoreOpen(false)} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
          <section
            id="staff-more-menu"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="More staff app options"
            className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-y-auto rounded-t-[30px] bg-white px-4 pb-7 pt-4 shadow-2xl sm:px-5"
            style={{ paddingBottom: "max(1.75rem, env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">{role} workspace</p>
                <h2 className="mt-1 text-xl font-bold text-[#233A59]">All your tools</h2>
                <p className="mt-1 text-xs text-slate-500">Only tools approved for your role are shown.</p>
              </div>
              <button ref={closeButtonRef} type="button" onClick={() => setMoreOpen(false)} aria-label="Close more menu" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600">
                <X aria-hidden="true" size={19} />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              {STAFF_TOOL_GROUPS.map((group) => {
                const tools = groupedNavigation[group].filter((tool) => !primaryIds.has(tool.id));
                if (!tools.length) return null;
                return (
                  <section key={group} aria-labelledby={"mobile-tool-group-" + group}>
                    <p id={"mobile-tool-group-" + group} className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                      {STAFF_TOOL_GROUP_LABELS[group]}
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {tools.map((tool) => {
                        const Icon = STAFF_TOOL_ICONS[tool.icon];
                        const active = toolIsActive(pathname, tool.href);
                        return (
                          <Link
                            key={tool.id}
                            href={tool.href}
                            prefetch={false}
                            onClick={() => setMoreOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={
                              "flex min-h-20 flex-col justify-between rounded-2xl p-3.5 font-bold ring-1 transition active:scale-[0.98] " +
                              STAFF_TOOL_GROUP_TONES[group] +
                              (active ? " ring-[#A8864A]" : " ring-black/5")
                            }
                          >
                            <Icon aria-hidden="true" size={22} />
                            <span className="mt-3 text-sm leading-5">{tool.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="mt-5"><InstallAppButton wide /></div>
            <button type="button" onClick={onLock} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700">
              <LockKeyhole aria-hidden="true" size={18} />
              Lock app securely
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
