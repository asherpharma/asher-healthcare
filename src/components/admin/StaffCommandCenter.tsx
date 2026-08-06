"use client";

import type { StaffRole } from "@/components/admin/StaffGuard";
import { firebaseAuth } from "@/firebase/config";
import { fetchPatientDirectory } from "@/lib/patient-directory";
import {
  ArrowRight,
  CalendarPlus,
  FlaskConical,
  LoaderCircle,
  ReceiptIndianRupee,
  Search,
  Stethoscope,
  UserPlus,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
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

type QuickAction = {
  label: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

function actionsFor(role: StaffRole): QuickAction[] {
  const shared: QuickAction[] = [
    {
      label: "Find patient",
      detail: "Open medical records",
      href: "/admin/patients",
      icon: UsersRound,
      tone: "bg-blue-50 text-blue-900",
    },
    {
      label: "New appointment",
      detail: "Book an available slot",
      href: "/admin/appointments?new=1",
      icon: CalendarPlus,
      tone: "bg-amber-50 text-amber-900",
    },
  ];

  if (role === "doctor") {
    return [
      {
        label: "Consultation queue",
        detail: "Open today’s clinical desk",
        href: "/admin/consultations",
        icon: Stethoscope,
        tone: "bg-cyan-50 text-cyan-900",
      },
      ...shared,
      {
        label: "Lab reports",
        detail: "Review orders and results",
        href: "/admin/lab",
        icon: FlaskConical,
        tone: "bg-violet-50 text-violet-900",
      },
    ];
  }

  return [
    {
      label: "Register patient",
      detail: "Express check-in, invoice and payment",
      href: "/admin/reception",
      icon: UserPlus,
      tone: "bg-emerald-50 text-emerald-900",
    },
    ...shared,
    {
      label: "Collect payment",
      detail: "Open billing and receipts",
      href: "/admin/billing",
      icon: ReceiptIndianRupee,
      tone: "bg-violet-50 text-violet-900",
    },
  ];
}

export default function StaffCommandCenter({ role }: { role: StaffRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientSearchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const actions = useMemo(() => actionsFor(role), [role]);

  const loadPatients = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const user = firebaseAuth?.currentUser;
      if (!user) throw new Error("Staff session missing");
      const directory = await fetchPatientDirectory(user);
      setPatients(directory as PatientSearchRecord[]);
      setLoaded(true);
    } catch (loadError) {
      console.error("Staff patient search could not be loaded", loadError);
      setError("Patient search could not be loaded. Check the connection and try again.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      // Opening the software keyboard immediately can collapse the usable
      // viewport on phones. Desktop keeps the fast keyboard-first workflow.
      if (window.innerWidth >= 1024) inputRef.current?.focus();
      if (!loaded) void loadPatients();
    }, 80);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, [loadPatients, loaded, open]);

  const visiblePatients = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = term
      ? patients.filter((patient) =>
          [patient.fullName, patient.phone, patient.patientNumber ?? ""]
            .some((value) => value.toLowerCase().includes(term)),
        )
      : patients;
    return matches.slice(0, 8);
  }, [patients, search]);

  function close() {
    setOpen(false);
    setSearch("");
  }

  function navigate(href: string) {
    if (href === "/admin/appointments?new=1" && pathname === "/admin/appointments") {
      window.dispatchEvent(new CustomEvent("asher:new-appointment"));
    }
    close();
    router.push(href);
  }

  function openPatient(patientId: string) {
    if (pathname === "/admin/patients") {
      window.dispatchEvent(new CustomEvent("asher:open-patient", { detail: { patientId } }));
    }
    close();
    router.push(`/admin/patients?patient=${encodeURIComponent(patientId)}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open clinic search and quick actions"
        className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-[#233A59] transition active:scale-95 lg:hidden"
      >
        <Search size={19} />
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-11 min-w-56 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-sm font-semibold text-slate-500 transition hover:border-slate-300 hover:bg-white lg:flex"
      >
        <Search size={18} />
        <span className="flex-1">Search patients or actions</span>
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-command-title"
            className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[30px] bg-white shadow-2xl lg:max-h-[84dvh] lg:rounded-[30px]"
          >
            <div className="border-b border-slate-200 px-4 pb-4 pt-3 lg:px-6 lg:pt-5">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200 lg:hidden" />
              <div className="flex items-center gap-3">
                <Search className="shrink-0 text-[#A8864A]" size={22} />
                <input
                  ref={inputRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Patient name, mobile or ID"
                  aria-label="Search patients and clinic actions"
                  className="h-12 min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 lg:text-lg"
                />
                <button type="button" onClick={close} aria-label="Close command centre" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600">
                  <X size={19} />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-4 py-5 lg:px-6">
              {!search.trim() ? (
                <section>
                  <p id="staff-command-title" className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">Quick actions</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {actions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <button key={action.href + action.label} type="button" onClick={() => navigate(action.href)} className={`flex min-h-28 flex-col items-start justify-between rounded-2xl p-4 text-left transition active:scale-[0.98] ${action.tone}`}>
                          <Icon size={23} />
                          <span><strong className="block text-sm">{action.label}</strong><span className="mt-1 block text-xs leading-5 opacity-70">{action.detail}</span></span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              <section className={search.trim() ? "" : "mt-7"}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8864A]">{search.trim() ? "Search results" : "Recent patients"}</p>
                  {loading ? <span className="flex items-center gap-2 text-xs font-semibold text-slate-500"><LoaderCircle className="animate-spin" size={15} />Loading</span> : null}
                </div>

                {error ? (
                  <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    <p>{error}</p>
                    <button type="button" onClick={() => void loadPatients()} className="mt-2 font-bold underline">Try again</button>
                  </div>
                ) : null}

                {!loading && !error && visiblePatients.length ? (
                  <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
                    {visiblePatients.map((patient) => (
                      <button key={patient.id} type="button" onClick={() => openPatient(patient.id)} className="flex w-full items-center gap-3 bg-white p-3 text-left transition hover:bg-slate-50 lg:p-4">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-[#233A59]"><UserRound size={20} /></span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm text-[#233A59]">{patient.fullName}</strong>
                          <span className="mt-1 block truncate text-xs text-slate-500">{patient.patientNumber ?? "Patient"} · {patient.phone}{patient.doctorName ? ` · ${patient.doctorName}` : ""}</span>
                        </span>
                        <ArrowRight className="shrink-0 text-slate-300" size={17} />
                      </button>
                    ))}
                  </div>
                ) : null}

                {!loading && !error && loaded && visiblePatients.length === 0 ? (
                  <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-8 text-center">
                    <UsersRound className="mx-auto text-slate-300" size={30} />
                    <p className="mt-3 font-bold text-slate-700">No patient found</p>
                    <p className="mt-1 text-sm text-slate-500">Try another name, mobile number or patient ID.</p>
                  </div>
                ) : null}
              </section>
            </div>
          </section>
        </div>
      ), document.body) : null}
    </>
  );
}
