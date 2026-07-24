"use client";

import AdminShell from "@/components/admin/AdminShell";
import { useStaff } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import { addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp, type Timestamp } from "firebase/firestore";
import { LoaderCircle, Plus, Search, UserRound } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Patient = {
  id: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: "female" | "male" | "other";
  address: string;
  allergies: string;
  medicalHistory: string;
  createdAt?: Timestamp;
};

function PatientRegister() {
  const { profile } = useStaff();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!firestore) return;
    const patientsQuery = query(collection(firestore, "patients"), orderBy("createdAt", "desc"), limit(100));
    return onSnapshot(patientsQuery, (snapshot) => setPatients(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Patient))));
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? patients.filter((patient) => patient.fullName.toLowerCase().includes(term) || patient.phone.includes(term)) : patients;
  }, [patients, search]);

  async function addPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firestore) return;
    setSaving(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await addDoc(collection(firestore, "patients"), {
        fullName: String(data.get("fullName")).trim(),
        phone: String(data.get("phone")).trim(),
        dateOfBirth: String(data.get("dateOfBirth")),
        gender: String(data.get("gender")),
        address: String(data.get("address")).trim(),
        allergies: String(data.get("allergies") || "").trim(),
        medicalHistory: String(data.get("medicalHistory") || "").trim(),
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      form.reset();
      setShowForm(false);
      setMessage("Patient registered securely.");
    } catch {
      setMessage("Patient registration failed. Please check access and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Patient register</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59]">Patient records</h1><p className="mt-3 text-slate-600">Search by patient name or mobile number.</p></div><button onClick={() => setShowForm((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white"><Plus size={18} />Register patient</button></div>
      {message && <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</p>}
      {showForm && <form onSubmit={addPatient} className="mt-6 grid gap-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2"><h2 className="text-xl font-bold text-[#233A59] sm:col-span-2">New patient</h2><label className="text-sm font-bold text-slate-700">Full name<input name="fullName" required minLength={2} maxLength={100} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label><label className="text-sm font-bold text-slate-700">Mobile number<input name="phone" type="tel" required minLength={10} maxLength={20} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label><label className="text-sm font-bold text-slate-700">Date of birth<input name="dateOfBirth" type="date" required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label><label className="text-sm font-bold text-slate-700">Gender<select name="gender" required defaultValue="" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal"><option value="" disabled>Select</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label><label className="text-sm font-bold text-slate-700 sm:col-span-2">Address<textarea name="address" rows={2} required maxLength={300} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label><label className="text-sm font-bold text-slate-700">Known allergies<textarea name="allergies" rows={3} maxLength={500} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label><label className="text-sm font-bold text-slate-700">Medical history<textarea name="medicalHistory" rows={3} maxLength={1000} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label><div className="flex gap-3 sm:col-span-2"><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{saving && <LoaderCircle className="animate-spin" size={17} />}Save securely</button><button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700">Cancel</button></div></form>}
      <label className="relative mt-7 block"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or mobile number" className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 outline-none focus:border-[#233A59]" /></label>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((patient) => <article key={patient.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><span className="inline-flex rounded-xl bg-blue-50 p-3 text-blue-700"><UserRound size={20} /></span><h2 className="mt-4 font-bold text-[#233A59]">{patient.fullName}</h2><p className="mt-1 text-sm text-slate-600">{patient.phone}</p><div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500"><p>DOB: {patient.dateOfBirth}</p><p className="mt-1 capitalize">Gender: {patient.gender}</p></div></article>)}</div>
      {filtered.length === 0 && <div className="mt-6 rounded-3xl bg-white p-10 text-center ring-1 ring-slate-200"><UserRound className="mx-auto text-[#A8864A]" size={34} /><p className="mt-4 font-bold text-[#233A59]">No matching patients</p></div>}
    </div>
  );
}

export default function PatientsPage() { return <AdminShell><PatientRegister /></AdminShell>; }
