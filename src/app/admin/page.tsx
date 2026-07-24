"use client";

import AdminShell from "@/components/admin/AdminShell";
import { firestore } from "@/firebase/config";
import { collection, getCountFromServer, query, where } from "firebase/firestore";
import { CalendarCheck2, ClipboardPlus, Clock3, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function DashboardContent() {
  const [stats, setStats] = useState({ appointments: "—", today: "—", patients: "—" });

  useEffect(() => {
    if (!firestore) return;
    void Promise.all([
      getCountFromServer(collection(firestore, "appointments")),
      getCountFromServer(query(collection(firestore, "appointments"), where("preferredDate", "==", localDate()))),
      getCountFromServer(collection(firestore, "patients")),
    ]).then(([appointments, today, patients]) => setStats({ appointments: String(appointments.data().count), today: String(today.data().count), patients: String(patients.data().count) }));
  }, []);

  const cards = [
    { label: "All appointment requests", value: stats.appointments, icon: CalendarCheck2, tone: "bg-blue-50 text-blue-700" },
    { label: "Appointments today", value: stats.today, icon: Clock3, tone: "bg-amber-50 text-amber-700" },
    { label: "Registered patients", value: stats.patients, icon: UsersRound, tone: "bg-emerald-50 text-emerald-700" },
  ];

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Clinic overview</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Good care starts with a clear day.</h1>
      <p className="mt-3 text-slate-600">A secure snapshot of appointments and patient registrations.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">{cards.map(({ label, value, icon: Icon, tone }) => <article key={label} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><span className={"inline-flex rounded-xl p-3 " + tone}><Icon size={22} /></span><p className="mt-6 text-3xl font-bold text-[#233A59]">{value}</p><p className="mt-1 text-sm text-slate-600">{label}</p></article>)}</div>
      <section className="mt-8 rounded-3xl bg-[#233A59] p-6 text-white sm:p-8"><ClipboardPlus size={30} className="text-[#D4B678]" /><h2 className="mt-5 text-2xl font-bold">Start with today’s work</h2><p className="mt-2 max-w-2xl leading-7 text-white/75">Review new appointment requests, confirm visits, or register a patient after identity details have been checked at reception.</p><div className="mt-6 flex flex-wrap gap-3"><Link href="/admin/appointments" className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#233A59]">Review appointments</Link><Link href="/admin/patients" className="rounded-xl border border-white/25 px-5 py-3 text-sm font-bold text-white">Open patient register</Link></div></section>
    </div>
  );
}

export default function AdminPage() { return <AdminShell><DashboardContent /></AdminShell>; }
