"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { firestore, storage } from "@/firebase/config";
import { fetchPatientDirectory } from "@/lib/patient-directory";
import {
  MAX_REPORT_FILE_BYTES,
  REPORT_FILE_ACCEPT,
  createReportStoragePath,
  inspectReportFile,
  openPendingReportWindow,
  reportStorageErrorMessage,
  type AcceptedReport,
} from "@/lib/report-files";
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
  where,
  writeBatch,
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
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Patient = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  archived?: boolean;
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
  completedAt?: Timestamp;
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

function localDateValue(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function LabDesk() {
  const { user, profile } = useStaff();
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
  const [priorityFilter, setPriorityFilter] = useState<"all" | LabOrder["priority"]>("all");
  const [patientSearch, setPatientSearch] = useState("");
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const [patientDirectoryScope, setPatientDirectoryScope] = useState("");
  const [patientId, setPatientId] = useState("");
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [customTest, setCustomTest] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const deepLinkedPatientHandled = useRef(false);
  const directoryScope = `${profile.role}:${profile.doctorName ?? ""}`;
  const patientDirectoryAvailable = patientsLoaded && patientDirectoryScope === directoryScope;

  useEffect(() => {
    const requestedPriority = new URLSearchParams(window.location.search).get("priority");
    if (requestedPriority !== "routine" && requestedPriority !== "urgent") return;
    const timer = window.setTimeout(() => setPriorityFilter(requestedPriority), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPatientDirectory(user)
      .then((directory) => {
        if (!active) return;
        setPatients(directory.map((patient) => ({
          id: patient.id,
          patientNumber: patient.patientNumber,
          fullName: patient.fullName,
          phone: patient.phone,
          archived: patient.archived,
        })));
        setPatientDirectoryScope(directoryScope);
      })
      .catch((directoryError) => {
        console.error("Unable to load the secure patient directory.", directoryError);
        if (active) {
          setPatients([]);
          setShowCreate(false);
          setResultOrder(null);
          setPatientDirectoryScope("");
          setError("Unable to load the active patient directory. Laboratory actions are unavailable until it is refreshed.");
        }
      })
      .finally(() => {
        if (active) setPatientsLoaded(true);
      });
    return () => { active = false; };
  }, [directoryScope, user]);

  useEffect(() => {
    if (profile.role === "doctor" && !profile.doctorName?.trim()) {
      const timer = window.setTimeout(() => {
        setOrders([]);
        setError("This doctor login is not linked to a clinic doctor. Laboratory orders are unavailable.");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const ordersQuery = profile.role === "doctor"
      ? query(collection(db, "labOrders"), where("clinician", "==", profile.doctorName), limit(300))
      : query(collection(db, "labOrders"), orderBy("orderedAt", "desc"), limit(300));
    const stopOrders = onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs
        .map((entry) => ({ id: entry.id, ...(entry.data() as Omit<LabOrder, "id">) }))
        .sort((left, right) => (right.orderedAt?.toMillis?.() ?? 0) - (left.orderedAt?.toMillis?.() ?? 0)));
      setLoading(false);
    }, () => {
      setError("Unable to load laboratory orders.");
      setLoading(false);
    });
    return stopOrders;
  }, [db, profile.doctorName, profile.role]);

  useEffect(() => {
    if (!patientDirectoryAvailable || deepLinkedPatientHandled.current) return;

    const params = new URLSearchParams(window.location.search);
    const requestedPatientId = params.get("patient")?.trim();
    if (params.get("new") !== "1" || !requestedPatientId) return;
    const deepLinkedPatientExists = patients.some((patient) => patient.id === requestedPatientId);
    const timer = window.setTimeout(() => {
      deepLinkedPatientHandled.current = true;
      if (!deepLinkedPatientExists) return;
      setPatientId(requestedPatientId);
      setShowCreate(true);
      setError("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [patientDirectoryAvailable, patients]);

  const filteredOrders = useMemo(() => {
    if (!patientsLoaded || !patientDirectoryAvailable) return [];
    const activePatientIds = new Set(patients.map((patient) => patient.id));
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (!activePatientIds.has(order.patientId)) return false;
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || order.priority === priorityFilter;
      const haystack = [order.orderNumber, order.patientName, order.patientPhone, order.patientNumber, order.tests.join(" ")].join(" ").toLowerCase();
      return matchesStatus && matchesPriority && (!term || haystack.includes(term));
    });
  }, [orders, patientDirectoryAvailable, patients, patientsLoaded, priorityFilter, search, statusFilter]);

  const accessibleOrders = useMemo(() => {
    if (!patientsLoaded || !patientDirectoryAvailable) return [];
    const activePatientIds = new Set(patients.map((patient) => patient.id));
    return orders.filter((order) => activePatientIds.has(order.patientId));
  }, [orders, patientDirectoryAvailable, patients, patientsLoaded]);

  const selectedOrderPatient = useMemo(
    () => patients.find((patient) => patient.id === patientId) ?? null,
    [patientId, patients],
  );

  const patientMatches = useMemo(() => {
    const term = patientSearch.trim().toLowerCase();
    if (!term) return patients.slice(0, 8);
    return patients.filter((patient) => [patient.fullName, patient.phone, patient.patientNumber ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(term)).slice(0, 12);
  }, [patientSearch, patients]);

  const stats = useMemo(() => ({
    active: accessibleOrders.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
    urgent: accessibleOrders.filter((item) => item.priority === "urgent" && item.status !== "completed" && item.status !== "cancelled").length,
    completed: accessibleOrders.filter((item) => item.status === "completed").length,
  }), [accessibleOrders]);

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
    if (!patientDirectoryAvailable) {
      setError("The active patient directory is unavailable. Refresh before creating a laboratory order.");
      return;
    }
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
      setPatientSearch("");
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
    if (!patientDirectoryAvailable || !patients.some((patient) => patient.id === order.patientId)) {
      setError("This laboratory order is no longer linked to an available active patient.");
      return;
    }
    setError("");
    try {
      const values: Record<string, unknown> = { status, updatedAt: serverTimestamp() };
      if (status === "collected") values.specimenCollectedAt = serverTimestamp();
      if (status === "completed" && !order.completedAt) values.completedAt = serverTimestamp();
      await updateDoc(doc(db, "labOrders", order.id), values);
    } catch {
      setError("Unable to update the laboratory status.");
    }
  }

  async function saveResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resultOrder) return;
    if (!patientDirectoryAvailable || !patients.some((patient) => patient.id === resultOrder.patientId)) {
      setResultOrder(null);
      setError("This laboratory order is no longer linked to an available active patient.");
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const summary = String(form.get("resultSummary") || "").trim();
    const reportFile = form.get("reportFile");
    if (!summary && (!(reportFile instanceof File) || reportFile.size === 0)) {
      setError("Add a result summary or upload the report file.");
      return;
    }
    let acceptedReport: AcceptedReport | null = null;
    if (reportFile instanceof File && reportFile.size > 0) {
      if (reportFile.size >= MAX_REPORT_FILE_BYTES) {
        setError("Reports must be smaller than 10 MB.");
        return;
      }
      try {
        acceptedReport = await inspectReportFile(reportFile);
      } catch {
        setError("The selected report could not be checked. Please choose it again.");
        return;
      }
      if (!acceptedReport) {
        setError("Only genuine PDF, JPEG, PNG, or WebP reports are allowed.");
        return;
      }
    }

    setUploading(true);
    setError("");
    let uploadedStoragePath = "";
    try {
      const updateValues: Record<string, unknown> = {
        resultSummary: summary,
        status: "completed",
        updatedAt: serverTimestamp(),
      };
      if (!resultOrder.completedAt) updateValues.completedAt = serverTimestamp();
      const batch = writeBatch(db);
      if (reportFile instanceof File && reportFile.size > 0 && acceptedReport) {
        const { fileName: safeName, storagePath } = createReportStoragePath(
          resultOrder.patientId,
          reportFile.name,
          acceptedReport.extension,
        );
        await uploadBytes(ref(files, storagePath), reportFile, {
          contentType: acceptedReport.contentType,
          customMetadata: { patientId: resultOrder.patientId, uploadedBy: user.uid, labOrderId: resultOrder.id },
        });
        uploadedStoragePath = storagePath;
        const patientReportRef = doc(collection(db, "patients", resultOrder.patientId, "reports"));
        batch.set(patientReportRef, {
          fileName: safeName,
          storagePath,
          contentType: acceptedReport.contentType,
          size: reportFile.size,
          category: "Lab report",
          reportDate: localDateValue(),
          notes: "Lab order " + resultOrder.orderNumber,
          labOrderId: resultOrder.id,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        updateValues.reportFileName = safeName;
        updateValues.reportStoragePath = storagePath;
        updateValues.reportContentType = acceptedReport.contentType;
        updateValues.reportSize = reportFile.size;
      }
      batch.update(doc(db, "labOrders", resultOrder.id), updateValues);
      await batch.commit();
      setResultOrder(null);
      setNotice("Lab result saved securely in the patient record.");
    } catch (resultError) {
      console.error(resultError);
      if (uploadedStoragePath) {
        setError("The confirmation was interrupted after the report upload. The file has been retained securely; refresh the laboratory desk before retrying so it can be reconciled without creating a duplicate.");
      } else {
        setError(reportStorageErrorMessage(resultError, "upload"));
      }
    } finally {
      setUploading(false);
    }
  }

  async function openReport(order: LabOrder) {
    if (!order.reportStoragePath) return;
    if (!patientDirectoryAvailable || !patients.some((patient) => patient.id === order.patientId)) {
      setError("This report is no longer linked to an available active patient.");
      return;
    }
    const preview = openPendingReportWindow();
    if (!preview) {
      setError("Your browser blocked the secure preview. Allow pop-ups for Asher Healthcare or use the patient record download option.");
      return;
    }
    setError("");
    try {
      const blob = await getBlob(ref(files, order.reportStoragePath));
      const url = URL.createObjectURL(blob);
      preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reportError) {
      preview.close();
      setError(reportStorageErrorMessage(reportError, "open"));
    }
  }

  return (
    <div>
      <div className="staff-page-heading flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Laboratory workflow</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Lab orders & results</h1>
          <p className="mt-3 text-slate-600">Track samples, test status, results, and secure reports from one desk.</p>
        </div>
        <button type="button" disabled={!patientDirectoryAvailable} onClick={() => { setError(""); setShowCreate(true); }} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#233A59]/15 disabled:cursor-not-allowed disabled:opacity-50">
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
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "all" | LabOrder["priority"])} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
            <option value="all">All priorities</option>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      <div className="performance-list mt-5 space-y-4">
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
                <button type="button" onClick={() => { setResultOrder(order); setError(""); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 py-2.5 text-sm font-bold text-white"><TestTube2 size={17} /> {order.status === "completed" ? "Edit result" : "Add result"}</button>
                {order.reportStoragePath && profile.role !== "reception" && <button type="button" onClick={() => void openReport(order)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-[#233A59]"><Download size={17} /> Open report</button>}
              </div>
            </div>
          </article>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form onSubmit={createOrder} className="max-h-[100dvh] w-full max-w-3xl overflow-y-auto rounded-t-[2rem] bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[92vh] sm:rounded-[2rem] sm:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-[#A8864A]">New request</p><h2 className="mt-1 text-2xl font-bold text-[#233A59]">Create lab order</h2></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close"><X size={22} /></button></div>
            {error && <p aria-live="assertive" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="lab-patient-search">Registered patient</label>
                {selectedOrderPatient ? (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <div className="min-w-0"><p className="truncate text-sm font-bold text-emerald-950">{selectedOrderPatient.fullName}</p><p className="mt-0.5 text-xs text-emerald-800">{selectedOrderPatient.patientNumber || "Patient"} · {selectedOrderPatient.phone}</p></div>
                    <button type="button" onClick={() => { setPatientId(""); setPatientSearch(""); }} className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-bold text-emerald-900 ring-1 ring-emerald-200">Change</button>
                  </div>
                ) : (
                  <>
                    <input id="lab-patient-search" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} autoComplete="off" placeholder="Search name, phone, or patient ID" className={fieldClass} />
                    <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1">
                      {patientMatches.map((patient) => <button type="button" key={patient.id} onClick={() => { setPatientId(patient.id); setPatientSearch(""); }} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50 focus:bg-slate-50"><span className="min-w-0"><span className="block truncate text-sm font-bold text-slate-800">{patient.fullName}</span><span className="block text-xs text-slate-500">{patient.patientNumber || "Patient"} · {patient.phone}</span></span><span className="text-xs font-bold text-[#A8864A]">Select</span></button>)}
                      {patientMatches.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-500">No active patient found.</p>}
                    </div>
                  </>
                )}
              </div>
              <label className={labelClass}>Priority<select name="priority" className={fieldClass}><option value="routine">Routine</option><option value="urgent">Urgent</option></select></label>
              <label className={labelClass}>Ordering clinician{profile.role === "doctor" ? <input name="clinician" value={profile.doctorName ?? ""} readOnly required className={fieldClass + " cursor-not-allowed bg-slate-100 text-slate-700"} /> : <input name="clinician" placeholder="Doctor name" className={fieldClass} />}</label>
              <fieldset className="sm:col-span-2"><legend className={labelClass}>Tests</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{commonTests.map((test) => <label key={test} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={selectedTests.includes(test)} onChange={() => toggleTest(test)} className="h-4 w-4 accent-[#233A59]" />{test}</label>)}</div></fieldset>
              <div className="flex gap-2 sm:col-span-2"><input value={customTest} onChange={(event) => setCustomTest(event.target.value)} placeholder="Add another test" className={fieldClass + " mt-0"} /><button type="button" onClick={addCustomTest} className="rounded-xl border border-slate-200 px-4 text-sm font-bold">Add</button></div>
              {selectedTests.length > 0 && <div className="flex flex-wrap gap-2 sm:col-span-2">{selectedTests.map((test) => <button type="button" key={test} onClick={() => toggleTest(test)} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">{test} ×</button>)}</div>}
              <label className={labelClass + " sm:col-span-2"}>Clinical notes<textarea name="notes" rows={3} className={fieldClass} /></label>
            </div>
            <div className="sticky bottom-0 -mx-6 mt-6 flex justify-end gap-3 border-t border-slate-100 bg-white/95 px-6 pb-[env(safe-area-inset-bottom)] pt-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0"><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={18} /> : <FlaskConical size={18} />} Create order</button></div>
          </form>
        </div>
      )}

      {resultOrder && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form onSubmit={saveResult} className="max-h-[100dvh] w-full max-w-xl overflow-y-auto rounded-t-[2rem] bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[92vh] sm:rounded-[2rem] sm:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-[#A8864A]">{resultOrder.orderNumber}</p><h2 className="mt-1 text-2xl font-bold text-[#233A59]">Record lab result</h2><p className="mt-1 text-sm text-slate-500">{resultOrder.patientName}</p></div><button type="button" onClick={() => setResultOrder(null)} aria-label="Close"><X size={22} /></button></div>
            {error && <p aria-live="assertive" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
            <label className={labelClass + " mt-6 block"}>Result summary<textarea name="resultSummary" defaultValue={resultOrder.resultSummary ?? ""} rows={5} maxLength={5000} placeholder="Key findings, values, or interpretation" className={fieldClass} /></label>
            {resultOrder.reportStoragePath ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                <p className="font-bold">Secure report already attached</p>
                <p className="mt-1">The stored file is immutable. You can update the result summary without replacing the original report.</p>
              </div>
            ) : (
              <label className={labelClass + " mt-4 block"}>Report PDF or image<div className="mt-2 rounded-xl border border-dashed border-slate-300 p-4"><div className="flex items-center gap-3 text-sm text-slate-600"><FileUp size={20} /><input name="reportFile" type="file" accept={REPORT_FILE_ACCEPT} /></div><p className="mt-2 text-xs text-slate-500">PDF, JPEG, PNG, or WebP only. Secure storage, maximum 10 MB.</p></div></label>
            )}
            <div className="sticky bottom-0 -mx-6 mt-6 flex justify-end gap-3 border-t border-slate-100 bg-white/95 px-6 pb-[env(safe-area-inset-bottom)] pt-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0"><button type="button" onClick={() => setResultOrder(null)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold">Cancel</button><button disabled={uploading} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{uploading ? <LoaderCircle className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} Save result</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function LabPage() {
  return <LabDesk />;
}
