"use client";

import AdminShell from "@/components/admin/AdminShell";
import { firestore } from "@/firebase/config";
import { collection, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, doc, type Timestamp } from "firebase/firestore";
import { CalendarDays, LoaderCircle, Phone } from "lucide-react";
import { useEffect, useState } from "react";

type Appointment = {
  id: string;
  patientName: string;
  phone: string;
  doctorId: string;
  preferredDate: string;
  preferredTime: string;
  reason: string;
  status: "requested" | "confirmed" | "completed" | "cancelled";
  createdAt?: Timestamp;
};

const doctorNames: Record<string, string> = { pediatrics: "Dr. Lt Col Shafi Ahamad", obg: "Dr. Shaik Reshma" };

function AppointmentList() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firestore) return;
    const appointmentsQuery = query(collection(firestore, "appointments"), orderBy("createdAt", "desc"), limit(100));
    return onSnapshot(appointmentsQuery, (snapshot) => {
      setItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Appointment)));
      setLoading(false);
    }, () => { setError("Appointments could not be loaded."); setLoading(false); });
  }, []);

  async function changeStatus(id: string, status: Appointment["status"]) {
    if (!firestore) return;
    await updateDoc(doc(firestore, "appointments", id), { status, updatedAt: serverTimestamp() });
  }

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Appointment desk</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59]">Appointment requests</h1>
      <p className="mt-3 text-slate-600">Confirm patient requests and keep the visit status current.</p>
      {loading && <div className="mt-10 flex items-center gap-3 text-slate-600"><LoaderCircle className="animate-spin" />Loading secure appointments…</div>}
      {error && <p className="mt-8 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
      {!loading && !error && items.length === 0 && <div className="mt-8 rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200"><CalendarDays className="mx-auto text-[#A8864A]" size={36} /><h2 className="mt-4 text-xl font-bold text-[#233A59]">No requests yet</h2><p className="mt-2 text-slate-600">New website appointment requests will appear here.</p></div>}
      <div className="mt-8 space-y-4">{items.map((item) => <article key={item.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><div className="grid gap-5 lg:grid-cols-[1fr_1fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-[#233A59]">{item.patientName}</h2><span className={"rounded-full px-2.5 py-1 text-xs font-bold capitalize " + (item.status === "confirmed" ? "bg-blue-50 text-blue-700" : item.status === "completed" ? "bg-emerald-50 text-emerald-700" : item.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>{item.status}</span></div><a href={"tel:" + item.phone} className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-[#233A59]"><Phone size={14} />{item.phone}</a><p className="mt-2 text-sm text-slate-500">{doctorNames[item.doctorId] || item.doctorId}</p></div><div className="text-sm text-slate-600"><p className="font-bold text-[#233A59]">{item.preferredDate} · {item.preferredTime}</p><p className="mt-2 line-clamp-2">{item.reason || "No reason provided"}</p></div><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Status<select value={item.status} onChange={(event) => void changeStatus(item.id, event.target.value as Appointment["status"])} className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold normal-case text-slate-700"><option value="requested">Requested</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label></div></article>)}</div>
    </div>
  );
}

export default function AppointmentsPage() { return <AdminShell><AppointmentList /></AdminShell>; }
