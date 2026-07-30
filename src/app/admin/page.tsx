"use client";

import AdminShell from "@/components/admin/AdminShell";
import { firestore } from "@/firebase/config";
import { collection, getCountFromServer, query, where } from "firebase/firestore";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ClipboardPlus,
  Clock3,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type DashboardStats = {
  appointments: number;
  today: number;
  patients: number;
  requested: number;
  confirmed: number;
  completed: number;
};

const emptyStats: DashboardStats = {
  appointments: 0,
  today: 0,
  patients: 0,
  requested: 0,
  confirmed: 0,
  completed: 0,
};

function clinicDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return [value("year"), value("month"), value("day")].join("-");
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  if (!firestore) {
    throw new Error("Firebase is not configured for this environment.");
  }

  const appointments = collection(firestore, "appointments");
  const [all, today, patients, requested, confirmed, completed] = await Promise.all([
    getCountFromServer(appointments),
    getCountFromServer(query(appointments, where("preferredDate", "==", clinicDate()))),
    getCountFromServer(collection(firestore, "patients")),
    getCountFromServer(query(appointments, where("status", "==", "requested"))),
    getCountFromServer(query(appointments, where("status", "==", "confirmed"))),
    getCountFromServer(query(appointments, where("status", "==", "completed"))),
  ]);

  return {
    appointments: all.data().count,
    today: today.data().count,
    patients: patients.data().count,
    requested: requested.data().count,
    confirmed: confirmed.data().count,
    completed: completed.data().count,
  };
}

function DashboardContent() {
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refreshStats() {
    setLoading(true);
    setError("");

    try {
      setStats(await fetchDashboardStats());
    } catch (loadError) {
      console.error(loadError);
      setError("The clinic summary could not be refreshed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    void fetchDashboardStats()
      .then((nextStats) => {
        if (active) setStats(nextStats);
      })
      .catch((loadError) => {
        console.error(loadError);
        if (active) setError("The clinic summary could not be refreshed. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const cards = [
    {
      label: "Visits today",
      value: stats.today,
      icon: Clock3,
      tone: "bg-amber-50 text-amber-700",
      hint: "Scheduled for today",
    },
    {
      label: "Needs review",
      value: stats.requested,
      icon: CalendarCheck2,
      tone: "bg-blue-50 text-blue-700",
      hint: "New appointment requests",
    },
    {
      label: "Confirmed",
      value: stats.confirmed,
      icon: UserRoundCheck,
      tone: "bg-violet-50 text-violet-700",
      hint: "Confirmed appointments",
    },
    {
      label: "Completed",
      value: stats.completed,
      icon: CheckCircle2,
      tone: "bg-emerald-50 text-emerald-700",
      hint: "Visits completed",
    },
    {
      label: "All requests",
      value: stats.appointments,
      icon: ClipboardPlus,
      tone: "bg-slate-100 text-slate-700",
      hint: "Complete booking history",
    },
    {
      label: "Patients",
      value: stats.patients,
      icon: UsersRound,
      tone: "bg-rose-50 text-rose-700",
      hint: "Registered patient records",
    },
  ];

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Clinic overview</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">
            Good care starts with a clear day.
          </h1>
          <p className="mt-3 text-slate-600">Your secure, live operational snapshot for Asher Healthcare.</p>
        </div>
        <button
          type="button"
          onClick={() => void refreshStats()}
          disabled={loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-[#233A59] shadow-sm transition hover:border-[#233A59]/30 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <LoaderCircle size={17} className="animate-spin" /> : <RefreshCw size={17} />}
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, icon: Icon, tone, hint }) => (
          <article key={label} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-start justify-between gap-4">
              <span className={"inline-flex rounded-xl p-3 " + tone}><Icon size={22} /></span>
              {loading ? <LoaderCircle size={18} className="mt-2 animate-spin text-slate-300" /> : null}
            </div>
            <p className="mt-6 text-3xl font-bold text-[#233A59]">{loading ? "—" : value}</p>
            <p className="mt-1 font-semibold text-slate-800">{label}</p>
            <p className="mt-1 text-sm text-slate-500">{hint}</p>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-3xl bg-[#233A59] p-6 text-white shadow-lg shadow-[#233A59]/10 sm:p-8">
          <CalendarCheck2 size={32} className="text-[#D4B678]" />
          <h2 className="mt-5 text-2xl font-bold">
            {stats.requested > 0 ? stats.requested + " appointment request" + (stats.requested === 1 ? " needs" : "s need") + " attention" : "Today’s appointment desk is ready"}
          </h2>
          <p className="mt-2 max-w-2xl leading-7 text-white/75">
            Search the schedule, filter by doctor or status, and confirm or complete visits from one focused workspace.
          </p>
          <Link href="/admin/appointments" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold transition hover:bg-[#F8F4EA]" style={{ color: "#233A59" }}>
            Open appointment desk <ArrowRight size={17} />
          </Link>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          <ShieldCheck size={31} className="text-emerald-600" />
          <h2 className="mt-5 text-xl font-bold text-[#233A59]">Patient records</h2>
          <p className="mt-2 leading-7 text-slate-600">
            Register patients and securely maintain visits, prescriptions, vaccinations, pregnancy follow-ups, and reports.
          </p>
          <Link href="/admin/patients" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#233A59] hover:text-[#A8864A]">
            Open patient register <ArrowRight size={16} />
          </Link>
        </section>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return <AdminShell><DashboardContent /></AdminShell>;
}
