"use client";

import AdminShell from "@/components/admin/AdminShell";
import { useStaff } from "@/components/admin/StaffGuard";
import { firestore } from "@/firebase/config";
import { downloadReceiptPdf, type ReceiptInvoice } from "@/lib/receipt-pdf";
import Script from "next/script";
import {
  collection,
  collectionGroup,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Download,
  FilePlus2,
  IndianRupee,
  LoaderCircle,
  Plus,
  ReceiptIndianRupee,
  Search,
  ShieldCheck,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type Patient = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
};

type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type PaymentStatus = "unpaid" | "partial" | "paid";
type PaymentMethod = "cash" | "upi" | "card" | "bank_transfer" | "online";

type Invoice = ReceiptInvoice & {
  id: string;
  patientId: string;
  patientNumber: string;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | "not_recorded";
  createdBy: string;
  updatedAt?: Timestamp;
  createdAt?: Timestamp;
};

type PaymentEntry = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  source: "manual" | "gateway";
  status: "received";
  createdAt?: Timestamp;
};

type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayFailure = {
  error?: {
    description?: string;
  };
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  image: string;
  order_id: string;
  prefill: {
    name: string;
    contact: string;
  };
  theme: { color: string };
  retry: { enabled: boolean };
  modal: {
    confirm_close: boolean;
    ondismiss: () => void;
  };
  handler: (response: RazorpaySuccess) => void | Promise<void>;
};

type RazorpayCheckout = {
  open: () => void;
  on: (event: "payment.failed", handler: (response: RazorpayFailure) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayCheckout;
  }
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10";
const labelClass = "text-sm font-bold text-slate-700";

function money(value: number) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayKey() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function invoiceNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return "ASH-" + date + "-" + suffix;
}

function createdDate(value?: Timestamp) {
  return value ? value.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Just now";
}

function methodLabel(value: string) {
  const labels: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", online: "Online gateway", not_recorded: "Not recorded" };
  return labels[value] ?? value;
}

function BillingWorkspace() {
  const { user } = useStaff();
  const db = firestore!;
  const [patients, setPatients] = useState<Patient[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ id: crypto.randomUUID(), description: "Consultation fee", quantity: 1, unitPrice: 0, amount: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [initialPayment, setInitialPayment] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [notes, setNotes] = useState("");
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [followupMethod, setFollowupMethod] = useState<PaymentMethod>("cash");
  const [followupReference, setFollowupReference] = useState("");
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [razorpayReady, setRazorpayReady] = useState(false);
  const [gatewayPayment, setGatewayPayment] = useState(false);

  useEffect(() => {
    const unsubscribePatients = onSnapshot(
      query(collection(db, "patients"), orderBy("createdAt", "desc"), limit(250)),
      (snapshot) => setPatients(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Patient)),
      () => setError("Patient records could not be loaded."),
    );
    const unsubscribeInvoices = onSnapshot(
      query(collection(db, "invoices"), orderBy("createdAt", "desc"), limit(250)),
      (snapshot) => {
        setInvoices(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Invoice));
        setLoading(false);
      },
      () => {
        setError("Billing records could not be loaded. Please check staff access.");
        setLoading(false);
      },
    );
    const unsubscribePayments = onSnapshot(
      query(collectionGroup(db, "payments"), orderBy("createdAt", "desc"), limit(500)),
      (snapshot) => setPayments(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PaymentEntry)),
      () => setError("Payment audit entries could not be loaded."),
    );
    return () => {
      unsubscribePatients();
      unsubscribeInvoices();
      unsubscribePayments();
    };
  }, [db]);

  const selectedPatient = useMemo(() => patients.find((patient) => patient.id === selectedPatientId) ?? null, [patients, selectedPatientId]);
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + Math.max(0, item.quantity) * Math.max(0, item.unitPrice), 0), [items]);
  const total = Math.max(0, subtotal - Math.max(0, discount));

  const stats = useMemo(() => {
    const today = todayKey();
    const collectedToday = payments.filter((payment) => payment.createdAt?.toDate().toISOString().slice(0, 10) === today && payment.status === "received").reduce((sum, payment) => sum + payment.amount, 0);
    const outstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0);
    return { collectedToday, outstanding, payments: payments.length, invoices: invoices.length };
  }, [invoices, payments]);

  const filteredInvoices = useMemo(() => {
    const term = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const matchesSearch = !term || [invoice.invoiceNumber, invoice.patientName, invoice.patientPhone, invoice.patientNumber].some((value) => String(value ?? "").toLowerCase().includes(term));
      return matchesSearch && (statusFilter === "all" || invoice.paymentStatus === statusFilter);
    });
  }, [invoices, search, statusFilter]);

  function resetInvoiceForm() {
    setSelectedPatientId("");
    setItems([{ id: crypto.randomUUID(), description: "Consultation fee", quantity: 1, unitPrice: 0, amount: 0 }]);
    setDiscount(0);
    setInitialPayment(0);
    setPaymentMethod("cash");
    setPaymentReference("");
    setNotes("");
  }

  function updateItem(id: string, patch: Partial<LineItem>) {
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      return { ...next, amount: Math.max(0, Number(next.quantity || 0)) * Math.max(0, Number(next.unitPrice || 0)) };
    }));
  }

  function addItem() {
    setItems((current) => [...current, { id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0, amount: 0 }]);
  }

  function removeItem(id: string) {
    setItems((current) => current.length === 1 ? current : current.filter((item) => item.id !== id));
  }

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!selectedPatient) {
      setError("Select a registered patient before creating the invoice.");
      return;
    }
    const cleanItems = items.map((item) => ({ description: item.description.trim(), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), amount: Number(item.quantity) * Number(item.unitPrice) })).filter((item) => item.description && item.quantity > 0 && item.unitPrice >= 0);
    if (cleanItems.length === 0 || total <= 0) {
      setError("Add at least one valid charge and ensure the invoice total is greater than zero.");
      return;
    }
    const received = Math.max(0, Number(initialPayment || 0));
    if (received > total) {
      setError("Amount received cannot be greater than the invoice total.");
      return;
    }

    setSaving(true);
    try {
      const invoiceRef = doc(collection(db, "invoices"));
      const number = invoiceNumber();
      const balance = total - received;
      const paymentStatus: PaymentStatus = received === 0 ? "unpaid" : balance === 0 ? "paid" : "partial";
      const invoiceData = {
        invoiceNumber: number,
        patientId: selectedPatient.id,
        patientNumber: selectedPatient.patientNumber ?? "",
        patientName: selectedPatient.fullName,
        patientPhone: selectedPatient.phone,
        items: cleanItems,
        subtotal,
        discount: Math.max(0, Number(discount || 0)),
        total,
        amountPaid: received,
        balance,
        paymentStatus,
        paymentMethod: received > 0 ? paymentMethod : "not_recorded",
        paymentReference: received > 0 ? paymentReference.trim() : "",
        notes: notes.trim(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        paidAt: balance === 0 ? serverTimestamp() : null,
      };
      const batch = writeBatch(db);
      batch.set(invoiceRef, invoiceData);
      if (received > 0) {
        const paymentRef = doc(collection(invoiceRef, "payments"));
        batch.set(paymentRef, {
          invoiceId: invoiceRef.id,
          invoiceNumber: number,
          patientId: selectedPatient.id,
          patientName: selectedPatient.fullName,
          amount: received,
          method: paymentMethod,
          reference: paymentReference.trim(),
          source: "manual",
          status: "received",
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      resetInvoiceForm();
      setShowCreate(false);
      setNotice("Invoice " + number + " created successfully.");
    } catch (createError) {
      console.error(createError);
      setError("The invoice could not be created. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function beginPayment(invoice: Invoice) {
    setPayingInvoice(invoice);
    setPaymentAmount(invoice.balance);
    setFollowupMethod("cash");
    setFollowupReference("");
    setError("");
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payingInvoice) return;
    const received = Math.max(0, Number(paymentAmount || 0));
    if (received <= 0 || received > payingInvoice.balance) {
      setError("Enter an amount greater than zero and not more than the outstanding balance.");
      return;
    }

    setRecordingPayment(true);
    setError("");
    setNotice("");
    try {
      const invoiceRef = doc(db, "invoices", payingInvoice.id);
      const paymentRef = doc(collection(invoiceRef, "payments"));
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(invoiceRef);
        if (!snapshot.exists()) throw new Error("Invoice not found");
        const current = snapshot.data() as Invoice;
        const currentBalance = Number(current.balance || 0);
        if (received > currentBalance) throw new Error("Payment exceeds current balance");
        const amountPaid = Number(current.amountPaid || 0) + received;
        const balance = Math.max(0, Number(current.total || 0) - amountPaid);
        transaction.update(invoiceRef, {
          amountPaid,
          balance,
          paymentStatus: balance === 0 ? "paid" : "partial",
          paymentMethod: followupMethod,
          paymentReference: followupReference.trim(),
          updatedAt: serverTimestamp(),
          paidAt: balance === 0 ? serverTimestamp() : null,
        });
        transaction.set(paymentRef, {
          invoiceId: payingInvoice.id,
          invoiceNumber: payingInvoice.invoiceNumber,
          patientId: payingInvoice.patientId,
          patientName: payingInvoice.patientName,
          amount: received,
          method: followupMethod,
          reference: followupReference.trim(),
          source: "manual",
          status: "received",
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      });
      setNotice("Payment of " + money(received) + " recorded for " + payingInvoice.invoiceNumber + ".");
      setPayingInvoice(null);
    } catch (paymentError) {
      console.error(paymentError);
      setError("The payment could not be recorded. Refresh and try again.");
    } finally {
      setRecordingPayment(false);
    }
  }

  async function startRazorpayPayment() {
    if (!payingInvoice) return;
    const invoice = payingInvoice;
    const received = Math.max(0, Number(paymentAmount || 0));
    if (received <= 0 || received > invoice.balance) {
      setError("Enter an amount greater than zero and not more than the outstanding balance.");
      return;
    }
    if (!razorpayReady || !window.Razorpay) {
      setError("Secure Razorpay Checkout is still loading. Please wait a moment and try again.");
      return;
    }

    setGatewayPayment(true);
    setError("");
    setNotice("");
    try {
      const token = await user.getIdToken();
      const orderResponse = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invoiceId: invoice.id, amount: received }),
      });
      const order = await orderResponse.json() as {
        error?: string;
        keyId?: string;
        orderId?: string;
        amount?: number;
        currency?: string;
      };
      if (!orderResponse.ok || !order.keyId || !order.orderId || !order.amount || !order.currency) {
        throw new Error(order.error || "The secure payment order could not be created.");
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Asher Women & Child Healthcare",
        description: `Payment for ${invoice.invoiceNumber}`,
        image: "/images/logo.png",
        order_id: order.orderId,
        prefill: {
          name: invoice.patientName,
          contact: invoice.patientPhone,
        },
        theme: { color: "#233A59" },
        retry: { enabled: true },
        modal: {
          confirm_close: true,
          ondismiss: () => setGatewayPayment(false),
        },
        handler: async (confirmation) => {
          setGatewayPayment(true);
          try {
            const freshToken = await user.getIdToken();
            const verificationResponse = await fetch("/api/razorpay/verify-payment", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${freshToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(confirmation),
            });
            const verification = await verificationResponse.json() as {
              error?: string;
              verified?: boolean;
              amount?: number;
              overpaymentAmount?: number;
            };
            if (!verificationResponse.ok || !verification.verified) {
              throw new Error(verification.error || "Razorpay payment verification failed.");
            }

            const overpayment = Number(verification.overpaymentAmount || 0);
            setNotice(
              overpayment > 0
                ? `Payment received. ${money(overpayment)} requires overpayment reconciliation.`
                : `Secure payment of ${money(Number(verification.amount || received))} received for ${invoice.invoiceNumber}.`,
            );
            setPayingInvoice(null);
          } catch (verificationError) {
            console.error(verificationError);
            setError(
              verificationError instanceof Error
                ? verificationError.message
                : "Payment was made but verification must be retried.",
            );
          } finally {
            setGatewayPayment(false);
          }
        },
      });
      checkout.on("payment.failed", (failure) => {
        setGatewayPayment(false);
        setError(failure.error?.description || "Razorpay could not complete this payment.");
      });
      checkout.open();
    } catch (gatewayError) {
      console.error(gatewayError);
      setGatewayPayment(false);
      setError(
        gatewayError instanceof Error
          ? gatewayError.message
          : "The Razorpay checkout could not be opened.",
      );
    }
  }

  return (
    <div>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => setRazorpayReady(true)}
        onError={() => setError("Secure Razorpay Checkout could not be loaded. Check the internet connection.")}
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#A8864A]">Billing & receipts</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#233A59] sm:text-4xl">Clinic revenue desk</h1>
          <p className="mt-3 text-slate-600">Create invoices, record partial or full payments, track balances, and issue receipts.</p>
        </div>
        <button type="button" onClick={() => { setShowCreate((open) => !open); setError(""); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white hover:bg-[#1b2e47]"><FilePlus2 size={18} /> {showCreate ? "Close invoice" : "New invoice"}</button>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Collected today", value: money(stats.collectedToday), icon: Banknote, tone: "bg-emerald-50 text-emerald-700" },
          { label: "Outstanding", value: money(stats.outstanding), icon: WalletCards, tone: "bg-amber-50 text-amber-700" },
          { label: "Payment entries", value: String(stats.payments), icon: CreditCard, tone: "bg-blue-50 text-blue-700" },
          { label: "Invoices", value: String(stats.invoices), icon: ReceiptIndianRupee, tone: "bg-violet-50 text-violet-700" },
        ].map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><span className={"rounded-xl p-3 " + tone}><Icon size={21} /></span><div><p className="text-xl font-bold text-[#233A59]">{value}</p><p className="text-sm text-slate-600">{label}</p></div></article>
        ))}
      </div>

      {showCreate && (
        <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex items-start justify-between gap-4"><div><h2 className="text-2xl font-bold text-[#233A59]">Create patient invoice</h2><p className="mt-1 text-sm text-slate-600">Every payment creates an immutable audit entry.</p></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close invoice form" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={19} /></button></div>
          <form onSubmit={createInvoice} className="mt-6 space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className={labelClass}>Registered patient<select required value={selectedPatientId} onChange={(event) => setSelectedPatientId(event.target.value)} className={inputClass}><option value="">Select patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.patientNumber ? patient.patientNumber + " · " : ""}{patient.fullName} · {patient.phone}</option>)}</select></label>
              <label className={labelClass}>Notes<input value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} placeholder="Optional billing note" className={inputClass} /></label>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-[#233A59]">Charges</h3><button type="button" onClick={addItem} className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800"><Plus size={15} /> Add item</button></div>
              <div className="mt-3 space-y-3">
                {items.map((item, index) => (
                  <div key={item.id} className="grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-[1fr_100px_150px_140px_auto] md:items-end">
                    <label className={labelClass}>Description<input required value={item.description} maxLength={120} onChange={(event) => updateItem(item.id, { description: event.target.value })} placeholder="Consultation, vaccination, lab test…" className={inputClass} /></label>
                    <label className={labelClass}>Qty<input required type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} className={inputClass} /></label>
                    <label className={labelClass}>Rate<input required type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(item.id, { unitPrice: Number(event.target.value) })} className={inputClass} /></label>
                    <div><p className={labelClass}>Amount</p><p className="mt-2 flex h-[46px] items-center rounded-xl bg-white px-4 font-bold text-[#233A59] ring-1 ring-slate-200">{money(item.quantity * item.unitPrice)}</p></div>
                    <button type="button" disabled={items.length === 1} onClick={() => removeItem(item.id)} aria-label={"Remove charge " + (index + 1)} className="flex h-11 w-11 items-center justify-center rounded-xl text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"><Trash2 size={18} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 rounded-2xl border border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-4">
              <label className={labelClass}>Discount<input type="number" min="0" max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} className={inputClass} /></label>
              <label className={labelClass}>Amount received<input type="number" min="0" max={total} step="0.01" value={initialPayment} onChange={(event) => setInitialPayment(Number(event.target.value))} className={inputClass} /></label>
              <label className={labelClass}>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} className={inputClass}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select></label>
              <label className={labelClass}>Reference<input value={paymentReference} maxLength={100} onChange={(event) => setPaymentReference(event.target.value)} placeholder="UPI / card / bank reference" className={inputClass} /></label>
            </div>

            <div className="flex flex-col gap-5 rounded-2xl bg-[#233A59] p-5 text-white sm:flex-row sm:items-center sm:justify-between">
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm"><span className="text-white/65">Subtotal</span><strong className="text-right">{money(subtotal)}</strong><span className="text-white/65">Discount</span><strong className="text-right">{money(discount)}</strong><span>Total</span><strong className="text-right text-lg text-[#D4B678]">{money(total)}</strong><span className="text-white/65">Balance</span><strong className="text-right">{money(Math.max(0, total - initialPayment))}</strong></div>
              <button type="submit" disabled={saving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-[#233A59] disabled:opacity-60">{saving ? <LoaderCircle size={18} className="animate-spin" /> : <ReceiptIndianRupee size={18} />} {saving ? "Creating…" : "Create invoice"}</button>
            </div>
          </form>
        </section>
      )}

      {payingInvoice && (
        <section className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Receive payment</p><h2 className="mt-2 text-xl font-bold text-[#233A59]">{payingInvoice.invoiceNumber} · {payingInvoice.patientName}</h2><p className="mt-1 text-sm text-slate-600">Outstanding balance: {money(payingInvoice.balance)}</p></div><button type="button" onClick={() => setPayingInvoice(null)} aria-label="Close payment form" className="rounded-lg p-2 text-slate-500 hover:bg-white"><X size={19} /></button></div>
          <form onSubmit={recordPayment} className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_1.2fr_auto] md:items-end">
            <label className={labelClass}>Amount<input required type="number" min="0.01" max={payingInvoice.balance} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} className={inputClass} /></label>
            <label className={labelClass}>Manual method<select value={followupMethod} onChange={(event) => setFollowupMethod(event.target.value as PaymentMethod)} className={inputClass}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select></label>
            <label className={labelClass}>Reference<input value={followupReference} maxLength={100} onChange={(event) => setFollowupReference(event.target.value)} placeholder="Optional transaction reference" className={inputClass} /></label>
            <button type="submit" disabled={recordingPayment || gatewayPayment} className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white disabled:opacity-60">{recordingPayment ? <LoaderCircle size={17} className="animate-spin" /> : <CheckCircle2 size={17} />} Record manual</button>
          </form>
          <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-blue-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><ShieldCheck size={21} /></span>
              <div><p className="font-bold text-[#233A59]">Secure online payment</p><p className="mt-1 text-sm text-slate-600">UPI, cards and netbanking through Razorpay. Invoice and receipt update automatically.</p></div>
            </div>
            <button type="button" onClick={startRazorpayPayment} disabled={!razorpayReady || recordingPayment || gatewayPayment} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
              {gatewayPayment ? <LoaderCircle size={18} className="animate-spin" /> : <CreditCard size={18} />}
              {gatewayPayment ? "Opening Razorpay…" : razorpayReady ? `Pay ${money(paymentAmount)} online` : "Loading Razorpay…"}
            </button>
          </div>
        </section>
      )}

      {notice && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</p>}
      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="relative"><span className="sr-only">Search invoices</span><Search size={17} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice, patient, phone or patient ID" className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#233A59]" /></label>
          <label><span className="sr-only">Payment status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | PaymentStatus)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none"><option value="all">All payment statuses</option><option value="unpaid">Unpaid</option><option value="partial">Partially paid</option><option value="paid">Paid</option></select></label>
        </div>
      </section>

      {loading && <div className="mt-10 flex items-center gap-3 text-slate-600"><LoaderCircle className="animate-spin" /> Loading secure billing records…</div>}
      {!loading && filteredInvoices.length === 0 && <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center"><ReceiptIndianRupee className="mx-auto text-[#A8864A]" size={36} /><h2 className="mt-4 text-xl font-bold text-[#233A59]">No matching invoices</h2><p className="mt-2 text-slate-600">Create the first patient invoice or adjust the filters.</p></div>}

      <div className="mt-6 space-y-4">
        {filteredInvoices.map((invoice) => (
          <article key={invoice.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="grid gap-5 xl:grid-cols-[1fr_1fr_auto] xl:items-center">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-[#233A59]">{invoice.invoiceNumber}</h2><span className={"rounded-full px-2.5 py-1 text-xs font-bold capitalize " + (invoice.paymentStatus === "paid" ? "bg-emerald-50 text-emerald-800" : invoice.paymentStatus === "partial" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-800")}>{invoice.paymentStatus === "partial" ? "Partially paid" : invoice.paymentStatus}</span></div><p className="mt-2 font-semibold text-slate-700">{invoice.patientName}</p><p className="mt-1 text-sm text-slate-500">{invoice.patientNumber || "No patient ID"} · {invoice.patientPhone} · {createdDate(invoice.createdAt)}</p></div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-slate-50 p-4 text-sm"><span className="text-slate-500">Total</span><strong className="text-right text-[#233A59]">{money(invoice.total)}</strong><span className="text-slate-500">Received</span><strong className="text-right text-emerald-700">{money(invoice.amountPaid)}</strong><span className="text-slate-500">Balance</span><strong className="text-right text-red-700">{money(invoice.balance)}</strong><span className="text-slate-500">Last method</span><strong className="text-right text-slate-700">{methodLabel(invoice.paymentMethod)}</strong></div>
              <div className="flex flex-wrap gap-2 xl:max-w-[250px] xl:justify-end"><button type="button" onClick={() => void downloadReceiptPdf(invoice)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-[#233A59] hover:bg-slate-50"><Download size={15} /> Receipt PDF</button>{invoice.balance > 0 && <button type="button" onClick={() => beginPayment(invoice)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white"><IndianRupee size={15} /> Record payment</button>}</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function BillingPage() {
  return <AdminShell><BillingWorkspace /></AdminShell>;
}
