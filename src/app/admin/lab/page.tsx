"use client";

import AdminShell from "@/components/admin/AdminShell";
import { useStaff } from "@/components/admin/StaffGuard";
import { firestore, storage } from "@/firebase/config";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { getBlob, ref, uploadBytes } from "firebase/storage";
import {
  CheckCircle2,
  Download,
  FileUp,
  FlaskConical,
  LoaderCircle,
  Plus,
  Search,
  TestTube2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type Patient = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
};

type LabStatus = "ordered" | "collected" | "processing" | "completed" | "cancelled";

type LabOrder = {
  id: string;
  orderNumber: string;
  patientId: string;
  patientNumber: string;
  patientName: string;
  patientPhone: string;
  tests: string[];
  priority: "routine" | "urgent";
  clinician: string;
  notes: string;
  status: LabStatus;
  resultSummary?: string;
  reportFileName?: string;
  reportStoragePath?: string;
  reportContentType?: string;
  reportSize?: number;
  orderedAt?: Timestamp;
  updatedAt?: Timestamp;
};

const commonTests = [
  "Complete Blood Count (CBC)",
  "HbA1c",
  "Thyroid profile",
  "Liver function test",
  "Kidney function test",
  "Lipid profile",
  "Urine routine",
  "C-reactive protein (CRP)",
  "Vitamin D",
  "Beta hCG",
];

const statusOptions: Array<{ value: LabStatus; label: string }> = [
  { value: "ordered", label: "Ordered" },
  { value: "collected", label: "Sample collected" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const statusStyles: Record<LabStatus, string> = {
  ordered: "bg-blue-50 text-blue-700",
  collected: "bg-violet-50 text-violet-700",
  processing: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-600",
};

const cardClass = "rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm";
const fieldClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#A8864A] focus:ring-2 focus:ring-[#A8864A]/15";
const labelClass = "text-sm font-semibold text-slate-700";

function dateTime(value?: Timestamp) {
  if (!value?.toDate) return "—";
  return value.toDate().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function makeOrderNumber() {
  const date = new Date();
  const stamp = date.getFullYear().toString() + String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
  return "LAB-" + stamp + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
}

function LabDesk() {
  const { user } = useStaff();
  const db = firestore!;
  const files = storage!;
  const [patients, setPatients] = useState<Patient[]>([]);
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [resultOrder, setResultOrder] = useState<LabOrder | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LabStatus>("all");
  const [patientId, setPatientId] = useState("");
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [customTest, setCustomTest] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const patientQuery = query(collection(db, "patients"), orderBy("createdAt", "desc"), limit(300));
    const stopPatients = onSnapshot(patientQuery, (snapshot) => {
      setPatients(snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<Patient, "id">) })));
    });
    const ordersQuery = query(collection(db, "labOrders"), orderBy("orderedAt", "desc"), limit(300));
    const stopOrders = onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<LabOrder, "id">) })));
      setLoading(false);
    }, () => {
      setError("Unable to load laboratory orders.");
      setLoading(false);
    });
    return () => { stopPatients(); stopOrders(); };
  }, [db]);

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const haystack = [order.orderNumber, order.patientName, order.patientPhone, order.patientNumber, order.tests.join(" ")].join(" ").toLowerCase();
      return matchesStatus && (!term || haystack.includes(term));
    });
  }, [orders, search, statusFilter]);

  const stats = useMemo(() => ({
    active: orders.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
    urgent: orders.filter((item) => item.priority === "urgent" && item.status !== "completed" && item.status !== "cancelled").length,
    completed: orders.filter((item) => item.status === "completed").length,
  }), [orders]);

  function toggleTest(test: string) {
    setSelectedTests((current) => current.includes(test) ? current.filter((item) => item !== test) : [...current, test]);
  }

  function addCustomTest() {
    const value = customTest.trim();
    if (!value || selectedTests.includes(value)) return;
    setSelectedTests((current) => [...current, value]);
    setCustomTest("");
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedPatient = patients.find((item) => item.id === patientId);
    if (!selectedPatient || selectedTests.length === 0) {
      setError("Choose a registered patient and at least one test.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "labOrders"), {
        orderNumber: makeOrderNumber(),
        patientId: selectedPatient.id,
        patientNumber: selectedPatient.patientNumber ?? "",
        patientName: selectedPatient.fullName,
        patientPhone: selectedPatient.phone,
        tests: selectedTests,
        priority: String(form.get("priority") || "routine"),
        clinician: String(form.get("clinician") || "").trim(),
        notes: String(form.get("notes") || "").trim(),
        status: "ordered",
        createdBy: user.uid,
        orderedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setPatientId("");
      setSelectedTests([]);
      setShowCreate(false);
      setNotice("Laboratory order created.");
    } catch (createError) {
      console.error(createError);
      setError("The laboratory order could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(order: LabOrder, status: LabStatus) {
    setError("");
    try {
      const values: Record<string, unknown> = { status, updatedAt: serverTimestamp() };
      if (status === "collected") values.specimenCollectedAt = serverTimestamp();
      if (status === "completed") values.completedAt = serverTimestamp();
      await updateDoc(doc(db, "labOrders", order.id), values);
    } catch {
      setError("Unable to update the laboratory status.");
    }
  }

  async function saveResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resultOrder) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const summary = String(form.get("resultSummary") || "").trim();
    const reportFile = form.get("reportFile");
    if (!summary && (!(reportFile instanceof File) || reportFile.size === 0)) {
      setError("Add a result summary or upload the report file.");
      return;
    }
    if (reportFile instanceof File && reportFile.size > 0) {
      if (reportFile.type !== "application/pdf" && !reportFile.type.startsWith("image/")) {
        setError("Only PDF and image reports are allowed.");
        return;
      }
      if (reportFile.size >= 10 * 1024 * 1024) {
        setError("Reports must be smaller than 10 MB.");
        return;
      }
    }

    setUploading(true);
    setError("");
    try {
      const updateValues: Record<string, unknown> = {
        resultSummary: summary,
        status: "completed",
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (reportFile instanceof File && reportFile.size > 0) {
        const safeName = reportFile.name.replace(/[^a-zA-Z0-9._-]/g, "-") || "lab-report";
        const storagePath = "reports/" + resultOrder.patientId + "/" + Date.now() + "-" + safeName;
        await uploadBytes(ref(files, storagePath), reportFile, {
          contentType: reportFile.type,
          customMetadata: { patientId: resultOrder.patientId, uploadedBy: user.uid, labOrderId: resultOrder.id },
        });
        await addDoc(collection(db, "patients", resultOrder.patientId, "reports"), {
          fileName: reportFile.name,
          storagePath,
          contentType: reportFile.type,
          size: reportFile.size,
          category: "Lab report",
          reportDate: new Date().toISOString().slice(0, 10),
          notes: "Lab order " + resultOrder.orderNumber,
          labOrderId: resultOrder.id,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        updateValues.reportFileName = reportFile.name;
        updateValues.reportStoragePath = storagePath;
        updateValues.reportContentType = reportFile.type;
        updateValues.reportSize = reportFile.size;
      }
      await updateDoc(doc(db, "labOrders", resultOrder.id), updateValues);
      setResultOrder(null);
      setNotice("Lab result saved securely in the patient record.");
    } catch (resultError) {
      console.error(resultError);
      setError("The lab result could not be saved.");
    } finally {
      setUploading(false);
    }
  }

  async function openReport(order: LabOrder) {
    if (!order.reportStoragePath) return;
    setError("");
    try {
      const blob = await getBlob(ref(files, order.reportStoragePath));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("Unable to open this report.");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Laboratory workflow</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Lab orders & results</h1>
          <p className="mt-3 text-slate-600">Track samples, test status, results, and secure reports from one desk.</p>
        </div>
        <button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#233A59]/15">
          <Plus size={18} /> New lab order
        </button>
      </div>

      {notice && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</p>}
      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className={cardClass}><p className="text-sm font-semibold text-slate-500">Active orders</p><p className="mt-2 text-3xl font-bold text-[#233A59]">{stats.active}</p></div>
        <div className={cardClass}><p className="text-sm font-semibold text-slate-500">Urgent</p><p className="mt-2 text-3xl font-bold text-rose-600">{stats.urgent}</p></div>
        <div className={cardClass}><p className="text-sm font-semibold text-slate-500">Completed</p><p className="mt-2 text-3xl font-bold text-emerald-600">{stats.completed}</p></div>
      </div>

      <div className={cardClass + " mt-6"}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-3.5 text-slate-400" size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, patient, phone, or test" className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 text-sm outline-none focus:border-[#A8864A]" />
          </label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | LabStatus)} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
            <option value="all">All statuses</option>
            {statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {loading && <div className={cardClass + " flex items-center gap-3 text-slate-600"}><LoaderCircle className="animate-spin" size={20} /> Loading lab orders…</div>}
        {!loading && filteredOrders.length === 0 && <div className={cardClass + " py-12 text-center"}><FlaskConical className="mx-auto text-slate-300" size={42} /><p className="mt-4 font-semibold text-slate-600">No laboratory orders found.</p></div>}
        {filteredOrders.map((order) => (
          <article key={order.id} className={cardClass}>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-[#233A59]">{order.orderNumber}</span>
                  <span className={"rounded-full px-2.5 py-1 text-xs font-bold " + statusStyles[order.status]}>{statusOptions.find((item) => item.value === order.status)?.label}</span>
                  {order.priority === "urgent" && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">Urgent</span>}
                </div>
                <h2 className="mt-3 text-xl font-bold text-slate-900">{order.patientName}</h2>
                <p className="mt-1 text-sm text-slate-500">{order.patientNumber || "Patient"} · {order.patientPhone} · {dateTime(order.orderedAt)}</p>
                <div className="mt-4 flex flex-wrap gap-2">{order.tests.map((test) => <span key={test} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700">{test}</span>)}</div>
                {order.resultSummary && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-900"><strong>Result:</strong> {order.resultSummary}</p>}
              </div>
              <div className="flex min-w-52 flex-col gap-2">
                <select value={order.status} onChange={(event) => void changeStatus(order, event.target.value as LabStatus)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700">
                  {statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <button type="button" onClick={() => { setResultOrder(order); setError(""); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 py-2.5 text-sm font-bold text-white"><TestTube2 size={17} /> Add result</button>
                {order.reportStoragePath && <button type="button" onClick={() => void openReport(order)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-[#233A59]"><Download size={17} /> Open report</button>}
              </div>
            </div>
          </article>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <form onSubmit={createOrder} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-[#A8864A]">New request</p><h2 className="mt-1 text-2xl font-bold text-[#233A59]">Create lab order</h2></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close"><X size={22} /></button></div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className={labelClass + " sm:col-span-2"}>Registered patient<select required value={patientId} onChange={(event) => setPatientId(event.target.value)} className={fieldClass}><option value="">Select patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.fullName} · {patient.phone}</option>)}</select></label>
              <label className={labelClass}>Priority<select name="priority" className={fieldClass}><option value="routine">Routine</option><option value="urgent">Urgent</option></select></label>
              <label className={labelClass}>Ordering clinician<input name="clinician" placeholder="Doctor name" className={fieldClass} /></label>
              <fieldset className="sm:col-span-2"><legend className={labelClass}>Tests</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{commonTests.map((test) => <label key={test} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={selectedTests.includes(test)} onChange={() => toggleTest(test)} className="h-4 w-4 accent-[#233A59]" />{test}</label>)}</div></fieldset>
              <div className="flex gap-2 sm:col-span-2"><input value={customTest} onChange={(event) => setCustomTest(event.target.value)} placeholder="Add another test" className={fieldClass + " mt-0"} /><button type="button" onClick={addCustomTest} className="rounded-xl border border-slate-200 px-4 text-sm font-bold">Add</button></div>
              {selectedTests.length > 0 && <div className="flex flex-wrap gap-2 sm:col-span-2">{selectedTests.map((test) => <button type="button" key={test} onClick={() => toggleTest(test)} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">{test} ×</button>)}</div>}
              <label className={labelClass + " sm:col-span-2"}>Clinical notes<textarea name="notes" rows={3} className={fieldClass} /></label>
            </div>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={18} /> : <FlaskConical size={18} />} Create order</button></div>
          </form>
        </div>
      )}

      {resultOrder && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <form onSubmit={saveResult} className="w-full max-w-xl rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-[#A8864A]">{resultOrder.orderNumber}</p><h2 className="mt-1 text-2xl font-bold text-[#233A59]">Record lab result</h2><p className="mt-1 text-sm text-slate-500">{resultOrder.patientName}</p></div><button type="button" onClick={() => setResultOrder(null)} aria-label="Close"><X size={22} /></button></div>
            <label className={labelClass + " mt-6 block"}>Result summary<textarea name="resultSummary" defaultValue={resultOrder.resultSummary ?? ""} rows={5} placeholder="Key findings, values, or interpretation" className={fieldClass} /></label>
            <label className={labelClass + " mt-4 block"}>Report PDF or image<div className="mt-2 rounded-xl border border-dashed border-slate-300 p-4"><div className="flex items-center gap-3 text-sm text-slate-600"><FileUp size={20} /><input name="reportFile" type="file" accept="application/pdf,image/*" /></div><p className="mt-2 text-xs text-slate-500">Secure storage, maximum 10 MB.</p></div></label>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setResultOrder(null)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold">Cancel</button><button disabled={uploading} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{uploading ? <LoaderCircle className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} Save result</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function LabPage() {
  return <AdminShell><LabDesk /></AdminShell>;
}
