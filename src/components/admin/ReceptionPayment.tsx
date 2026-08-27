"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import type { ReceiptInvoice } from "@/lib/receipt-pdf";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Download,
  Landmark,
  LoaderCircle,
  Printer,
  ReceiptText,
  Smartphone,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

export type ReceptionPatient = {
  id: string;
  patientNumber?: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  doctorName: string;
};

export type ReceptionInvoice = ReceiptInvoice & {
  id: string;
  patientId: string;
  patientNumber: string;
};

type ManualPaymentMethod = "cash" | "upi" | "card" | "bank_transfer";

type ConfirmedPayment = {
  amount: number;
  method: ManualPaymentMethod;
  reference: string;
  invoiceNumber: string;
  alreadyProcessed: boolean;
};

const methods: Array<{
  value: ManualPaymentMethod;
  label: string;
  detail: string;
  icon: typeof Banknote;
}> = [
  { value: "cash", label: "Cash", detail: "Counted at reception", icon: Banknote },
  { value: "upi", label: "UPI", detail: "Paid on an external UPI app", icon: Smartphone },
  { value: "card", label: "Card / POS", detail: "Confirmed on the clinic POS", icon: CreditCard },
  { value: "bank_transfer", label: "Bank transfer", detail: "Verified in the bank account", icon: Landmark },
];

function money(value: number) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ReceptionPayment({
  patient,
  invoice,
  consultationLabel,
}: {
  patient: ReceptionPatient;
  invoice: ReceptionInvoice;
  consultationLabel: string;
}) {
  const { user } = useStaff();
  const outstandingAmount = Math.max(0, Number(invoice.balance || invoice.total || 0));
  const [amount, setAmount] = useState(outstandingAmount);
  const [method, setMethod] = useState<ManualPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [recording, setRecording] = useState(false);
  const [confirmedPayment, setConfirmedPayment] = useState<ConfirmedPayment | null>(null);
  const [error, setError] = useState("");
  const [documentAction, setDocumentAction] = useState("");

  const confirmedInvoice = useMemo<ReceptionInvoice>(() => {
    if (!confirmedPayment) return invoice;
    const amountPaid = Number(invoice.amountPaid || 0) + confirmedPayment.amount;
    const balance = Math.max(0, Number(invoice.total || 0) - amountPaid);
    return {
      ...invoice,
      amountPaid,
      balance,
      paymentStatus: balance === 0 ? "paid" : "partial",
      paymentMethod: confirmedPayment.method,
      paymentReference: confirmedPayment.reference,
    };
  }, [confirmedPayment, invoice]);

  function startFreshAttempt() {
    setRequestId(crypto.randomUUID());
    setError("");
  }

  async function recordManualPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const received = Number(amount);
    if (!Number.isFinite(received) || received <= 0 || received > outstandingAmount) {
      setError(`Enter an amount between ₹0.01 and ${money(outstandingAmount)}.`);
      return;
    }

    setRecording(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/billing/manual-payment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          invoiceId: invoice.id,
          amount: received,
          method,
          reference: reference.trim(),
          requestId,
        }),
      });
      const result = await response.json() as {
        error?: string;
        payment?: ConfirmedPayment;
      };
      if (!response.ok || !result.payment) {
        throw new Error(result.error || "The secure payment ledger could not confirm this collection.");
      }
      setConfirmedPayment(result.payment);
    } catch (reason) {
      setError(
        `${reason instanceof Error ? reason.message : "The payment could not be recorded."} You can retry safely without creating a duplicate entry.`,
      );
    } finally {
      setRecording(false);
    }
  }

  async function runDocumentAction(key: string, action: () => Promise<void>) {
    setDocumentAction(key);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The document could not be prepared.");
    } finally {
      setDocumentAction("");
    }
  }

  if (confirmedPayment) {
    return (
      <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6" aria-live="polite">
        <div className="flex gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-white">
            <CheckCircle2 size={25} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Saved to the secure ledger</p>
            <h3 className="mt-1 text-xl font-bold text-[#233A59]">Payment received — {money(confirmedPayment.amount)}</h3>
            <p className="mt-1 text-sm text-emerald-800">
              {confirmedPayment.alreadyProcessed ? "This payment was already confirmed; no duplicate was created. " : ""}
              The receipt and prescription are ready to print.
            </p>
            {confirmedInvoice.balance > 0 ? <p className="mt-2 text-sm font-bold text-amber-800">Balance remaining: {money(confirmedInvoice.balance)}</p> : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            disabled={Boolean(documentAction)}
            onClick={() => void runDocumentAction("prescription-print", async () => {
              const { printBlankPrescriptionPdf } = await import("@/lib/prescription-pdf");
              await printBlankPrescriptionPdf(patient, patient.doctorName);
            })}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {documentAction === "prescription-print" ? <LoaderCircle className="animate-spin" size={18} /> : <Printer size={18} />}
            Print prescription
          </button>
          <button
            type="button"
            disabled={Boolean(documentAction)}
            onClick={() => void runDocumentAction("receipt-print", async () => {
              const { printReceiptPdf } = await import("@/lib/receipt-pdf");
              await printReceiptPdf(confirmedInvoice);
            })}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {documentAction === "receipt-print" ? <LoaderCircle className="animate-spin" size={18} /> : <ReceiptText size={18} />}
            Print receipt
          </button>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-1">
            <button
              type="button"
              disabled={Boolean(documentAction)}
              onClick={() => void runDocumentAction("prescription-download", async () => {
                const { downloadBlankPrescriptionPdf } = await import("@/lib/prescription-pdf");
                await downloadBlankPrescriptionPdf(patient, patient.doctorName);
              })}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-[#233A59] disabled:opacity-60"
            >
              <Download size={16} /> Rx PDF
            </button>
            <button
              type="button"
              disabled={Boolean(documentAction)}
              onClick={() => void runDocumentAction("receipt-download", async () => {
                const { downloadReceiptPdf } = await import("@/lib/receipt-pdf");
                await downloadReceiptPdf(confirmedInvoice);
              })}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-[#233A59] disabled:opacity-60"
            >
              <Download size={16} /> Receipt
            </button>
          </div>
        </div>
        {error ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-[#233A59] p-2.5 text-white"><Banknote size={21} /></span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Manual collection</p>
          <h3 className="text-xl font-bold text-[#233A59]">{consultationLabel}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">Collect the amount first, then confirm it here. No automatic QR or online checkout is used.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 rounded-2xl bg-white p-4 text-sm ring-1 ring-amber-100">
        <span className="text-slate-500">Patient</span><strong className="text-right text-[#233A59]">{patient.fullName}</strong>
        <span className="text-slate-500">Invoice</span><strong className="text-right text-[#233A59]">{invoice.invoiceNumber}</strong>
        <span className="text-slate-500">Amount due</span><strong className="text-right text-lg text-emerald-700">{money(outstandingAmount)}</strong>
      </div>

      <form onSubmit={recordManualPayment} className="mt-5 space-y-5">
        <fieldset>
          <legend className="text-sm font-bold text-slate-700">How was the payment collected?</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {methods.map(({ value, label, detail, icon: Icon }) => (
              <label key={value} className={`cursor-pointer rounded-2xl border p-3 transition ${method === value ? "border-[#233A59] bg-white ring-2 ring-[#233A59]/10" : "border-amber-200 bg-white/70 hover:bg-white"}`}>
                <input
                  type="radio"
                  name="reception-payment-method"
                  value={value}
                  checked={method === value}
                  onChange={() => { setMethod(value); startFreshAttempt(); }}
                  className="sr-only"
                />
                <span className="flex items-center gap-2 font-bold text-[#233A59]"><Icon size={18} />{label}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-slate-700">
            Amount received
            <input
              required
              type="number"
              inputMode="decimal"
              min="0.01"
              max={outstandingAmount}
              step="0.01"
              value={amount}
              onChange={(event) => { setAmount(Number(event.target.value)); startFreshAttempt(); }}
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-bold text-[#233A59] outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Reference <span className="font-normal text-slate-500">(optional)</span>
            <input
              value={reference}
              maxLength={100}
              onChange={(event) => { setReference(event.target.value); startFreshAttempt(); }}
              placeholder={method === "cash" ? "Optional counter note" : "Transaction / POS / bank reference"}
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-800 outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={recording || outstandingAmount <= 0}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {recording ? <LoaderCircle className="animate-spin" size={19} /> : <CheckCircle2 size={19} />}
          {recording ? "Saving to ledger…" : `Confirm ${money(amount)} received`}
        </button>
      </form>
      <p className="mt-4 text-xs leading-5 text-slate-600">
        Confirm only after cash is received or the external UPI, POS, or bank transaction is visible. The server will save an audit entry before documents are enabled.
      </p>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}
