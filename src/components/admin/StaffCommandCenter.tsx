"use client";

import type { StaffRole } from "@/components/admin/StaffGuard";
import {
  PATIENT_ACTION_TONES,
  STAFF_TOOL_GROUP_TONES,
  STAFF_TOOL_ICONS,
} from "@/components/admin/staff-tool-ui";
import { firebaseAuth } from "@/firebase/config";
import {
  stageAdminNavigationHandoff,
  type AdminNavigationHandoff,
} from "@/lib/admin-navigation-handoff";
import { searchPatientDirectory } from "@/lib/patient-directory";
import { patientSearchReady } from "@/lib/patient-search-readiness";
import {
  patientLauncherActionsForRole,
  quickStaffToolsForRole,
  recentStaffToolsForRole,
  searchStaffToolsForRole,
  staffToolForPath,
  updateRecentStaffToolIds,
  type PatientLauncherAction,
} from "@/lib/staff-navigation";
import {
  LoaderCircle,
  Search,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type PatientSearchRecord = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  doctorName?: string;
};

const RECENT_TOOLS_STORAGE_PREFIX = "asher:staff-recent-tools:";

function readRecentToolIds(role: StaffRole) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(RECENT_TOOLS_STORAGE_PREFIX + role) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function handoffForPatientAction(
  action: PatientLauncherAction,
  patientId: string,
): AdminNavigationHandoff {
  switch (action.id) {
    case "book":
      return { destination: "/admin/appointments", intent: "create-appointment", patientId };
    case "consult":
      return { destination: "/admin/consultations", intent: "open-patient-consultation", patientId };
    case "bill":
      return { destination: "/admin/billing", intent: "create-invoice", patientId };
    case "lab":
      return { destination: "/admin/lab", intent: "create-lab-order", patientId };
    case "open":
    default:
      return { destination: "/admin/patients", intent: "open-patient", patientId };
  }
}

export default function StaffCommandCenter({ role }: { role: StaffRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const searchSequenceRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientSearchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [recentToolIds, setRecentToolIds] = useState<string[]>([]);
  const quickTools = useMemo(() => quickStaffToolsForRole(role), [role]);
  const patientActions = useMemo(() => patientLauncherActionsForRole(role), [role]);
  const toolMatches = useMemo(
    () => searchStaffToolsForRole(role, search, 4),
    [role, search],
  );
  const currentTool = useMemo(() => staffToolForPath(pathname), [pathname]);
  const recentTools = useMemo(
    () => recentStaffToolsForRole(role, recentToolIds, 4)
      .filter((tool) => tool.id !== currentTool?.id),
    [currentTool?.id, recentToolIds, role],
  );

  const runPatientSearch = useCallback(async (term: string, sequence: number) => {
    try {
      const user = firebaseAuth?.currentUser;
      if (!user) throw new Error("Staff session missing");
      const result = await searchPatientDirectory(user, term, { pageSize: 6 });
      if (sequence !== searchSequenceRef.current) return;
      setPatients(result.patients as PatientSearchRecord[]);
      setSearched(true);
    } catch {
      if (sequence !== searchSequenceRef.current) return;
      console.error("Staff patient search could not be loaded");
      setError("Patient search could not be loaded. Check the connection and try again.");
    } finally {
      if (sequence === searchSequenceRef.current) setLoading(false);
    }
  }, []);

  const schedulePatientSearch = useCallback((value: string) => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    const sequence = ++searchSequenceRef.current;
    setSearch(value);
    setPatients([]);
    setSearched(false);
    setError("");
    if (!patientSearchReady(value)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    searchTimerRef.current = window.setTimeout(() => {
      void runPatientSearch(value.trim(), sequence);
    }, 280);
  }, [runPatientSearch]);

  const close = useCallback(() => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchSequenceRef.current += 1;
    setOpen(false);
    setSearch("");
    setPatients([]);
    setSearched(false);
    setLoading(false);
    setError("");
  }, []);

  const openCommandCenter = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    const visited = staffToolForPath(pathname);
    if (!visited) return;
    const updated = updateRecentStaffToolIds(readRecentToolIds(role), visited.id);
    sessionStorage.setItem(RECENT_TOOLS_STORAGE_PREFIX + role, JSON.stringify(updated));
    const stateTimer = window.setTimeout(() => setRecentToolIds(updated), 0);
    return () => window.clearTimeout(stateTimer);
  }, [pathname, role]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandCenter();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [openCommandCenter]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const background = document.querySelector<HTMLElement>(".staff-app-shell");
    const previousInert = background?.inert ?? false;
    const previousAriaHidden = background?.getAttribute("aria-hidden") ?? null;
    const returnFocusTarget = returnFocusRef.current;
    document.body.style.overflow = "hidden";
    (inputRef.current ?? closeButtonRef.current)?.focus();
    if (background) {
      background.inert = true;
      background.setAttribute("aria-hidden", "true");
    }

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown);
      document.body.style.overflow = previousOverflow;
      if (background) {
        background.inert = previousInert;
        if (previousAriaHidden === null) background.removeAttribute("aria-hidden");
        else background.setAttribute("aria-hidden", previousAriaHidden);
      }
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
    };
  }, [close, open]);

  useEffect(() => () => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchSequenceRef.current += 1;
  }, []);

  function navigate(href: string) {
    if (href === "/admin/appointments?new=1" && pathname === "/admin/appointments") {
      window.dispatchEvent(new CustomEvent("asher:new-appointment"));
    }
    close();
    router.push(href);
  }

  function launchPatientAction(action: PatientLauncherAction, patientId: string) {
    const handoff = handoffForPatientAction(action, patientId);
    stageAdminNavigationHandoff(handoff);
    close();
    router.push(handoff.destination);
  }

  const statusMessage = loading
    ? "Searching patient records."
    : error
      ? error
      : searched
        ? patients.length + " patient result" + (patients.length === 1 ? "" : "s") + " found."
        : "";

  return (
    <>
      <button
        type="button"
        onClick={openCommandCenter}
        aria-label="Open clinic search and quick actions"
        aria-expanded={open}
        aria-controls="staff-command-dialog"
        className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-[#233A59] transition active:scale-95 lg:hidden"
      >
        <Search aria-hidden="true" size={19} />
      </button>
      <button
        type="button"
        onClick={openCommandCenter}
        aria-expanded={open}
        aria-controls="staff-command-dialog"
        className="hidden h-11 min-w-56 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-sm font-semibold text-slate-500 transition hover:border-slate-300 hover:bg-white lg:flex"
      >
        <Search aria-hidden="true" size={18} />
        <span className="flex-1">Patient or clinic action</span>
        <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400">Ctrl K</kbd>
      </button>

      {open ? createPortal((
        <div className="fixed inset-0 z-[90] flex items-end justify-center lg:items-start lg:overflow-y-auto lg:px-6 lg:py-[8vh]">
          <button
            type="button"
            aria-label="Close command centre"
            onClick={close}
            className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
          />
          <section
            id="staff-command-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-command-title"
            tabIndex={-1}
            className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[30px] bg-white shadow-2xl lg:max-h-[84dvh] lg:rounded-[30px]"
          >
            <h2 id="staff-command-title" className="sr-only">Clinic search and quick actions</h2>
            <p className="sr-only" aria-live="polite">{statusMessage}</p>
            <div className="border-b border-slate-200 px-4 pb-4 pt-3 lg:px-6 lg:pt-5">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200 lg:hidden" />
              <div className="flex items-center gap-3">
                <Search className="shrink-0 text-[#A8864A]" size={22} />
                <input
                  ref={inputRef}
                  value={search}
                  onChange={(event) => schedulePatientSearch(event.target.value)}
                  placeholder="Patient name, ID, billing, lab or task"
                  aria-label="Search patients and clinic actions"
                  className="h-12 min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 lg:text-lg"
                />
                <button ref={closeButtonRef} type="button" onClick={close} aria-label="Close command centre" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600">
                  <X aria-hidden="true" size={19} />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-4 py-5 lg:px-6">
              {!search.trim() ? (
                <>
                  {recentTools.length ? (
                    <section aria-labelledby="recent-tools-title">
                      <p id="recent-tools-title" className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Continue working</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {recentTools.map((tool) => {
                          const Icon = STAFF_TOOL_ICONS[tool.icon];
                          return (
                            <button key={tool.id} type="button" onClick={() => navigate(tool.href)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-[#A8864A] hover:text-[#233A59]">
                              <Icon aria-hidden="true" size={17} />
                              {tool.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  <section className={recentTools.length ? "mt-7" : ""} aria-labelledby="quick-actions-title">
                    <p id="quick-actions-title" className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Quick actions</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                      {quickTools.map((tool) => {
                        const Icon = STAFF_TOOL_ICONS[tool.icon];
                        return (
                          <button key={tool.id} type="button" onClick={() => navigate(tool.href)} className={"flex min-h-28 flex-col items-start justify-between rounded-2xl p-4 text-left transition active:scale-[0.98] " + STAFF_TOOL_GROUP_TONES[tool.group]}>
                            <Icon aria-hidden="true" size={23} />
                            <span><strong className="block text-sm">{tool.label}</strong><span className="mt-1 block text-xs leading-5 opacity-70">{tool.detail}</span></span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </>
              ) : (
                <>
                  {toolMatches.length ? (
                    <section aria-labelledby="matching-tools-title">
                      <p id="matching-tools-title" className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Tools and actions</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {toolMatches.map((tool) => {
                          const Icon = STAFF_TOOL_ICONS[tool.icon];
                          return (
                            <button key={tool.id} type="button" onClick={() => navigate(tool.href)} className="flex min-h-16 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-[#A8864A] hover:bg-amber-50/30">
                              <span className={"grid h-10 w-10 shrink-0 place-items-center rounded-xl " + STAFF_TOOL_GROUP_TONES[tool.group]}><Icon aria-hidden="true" size={19} /></span>
                              <span className="min-w-0"><strong className="block text-sm text-[#233A59]">{tool.label}</strong><span className="mt-0.5 block truncate text-xs text-slate-500">{tool.detail}</span></span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  <section className={toolMatches.length ? "mt-6" : ""} aria-labelledby="patient-results-title">
                    <div className="flex items-center justify-between gap-3">
                      <p id="patient-results-title" className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Patients</p>
                      {loading ? <span className="flex items-center gap-2 text-xs font-semibold text-slate-500"><LoaderCircle className="animate-spin" size={15} />Searching</span> : null}
                    </div>

                    {error ? (
                      <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        <p>{error}</p>
                        <button type="button" onClick={() => schedulePatientSearch(search)} className="mt-2 font-bold underline">Try again</button>
                      </div>
                    ) : null}

                    {!loading && !error && patients.length ? (
                      <div className="mt-3 space-y-2">
                        {patients.map((patient) => (
                          <article key={patient.id} className="rounded-2xl border border-slate-200 bg-white p-3 lg:p-4">
                            <div className="flex items-center gap-3">
                              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-[#233A59]"><UserRound aria-hidden="true" size={20} /></span>
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate text-sm text-[#233A59]">{patient.fullName}</strong>
                                <span className="mt-1 block truncate text-xs text-slate-500">{patient.patientNumber ?? "Patient"} · {patient.phone}{patient.doctorName ? " · " + patient.doctorName : ""}</span>
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2" aria-label={"Actions for " + patient.fullName}>
                              {patientActions.map((action) => {
                                const Icon = STAFF_TOOL_ICONS[action.icon];
                                return (
                                  <button
                                    key={action.id}
                                    type="button"
                                    onClick={() => launchPatientAction(action, patient.id)}
                                    title={action.detail}
                                    className={"inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold transition active:scale-[0.98] sm:flex-none " + PATIENT_ACTION_TONES[action.id]}
                                  >
                                    <Icon aria-hidden="true" size={16} />
                                    {action.label}
                                  </button>
                                );
                              })}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}

                    {!loading && !error && searched && patients.length === 0 ? (
                      <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-8 text-center">
                        <UsersRound className="mx-auto text-slate-300" size={30} />
                        <p className="mt-3 font-bold text-slate-700">No patient found</p>
                        <p className="mt-1 text-sm text-slate-500">Try another name, mobile number or patient ID.</p>
                      </div>
                    ) : null}

                    {!loading && !error && !searched && !patientSearchReady(search) ? (
                      <p className="mt-3 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-900">
                        For patient search, enter 3 letters of a name, 6 mobile digits, or a complete patient ID. Clinic tools appear immediately above.
                      </p>
                    ) : null}
                  </section>
                </>
              )}
            </div>
          </section>
        </div>
      ), document.body) : null}
    </>
  );
}
