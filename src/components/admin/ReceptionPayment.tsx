"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import {
  downloadBlankPrescriptionPdf,
  printBlankPrescriptionPdf,
} from "@/lib/prescription-pdf";
import {
  downloadReceiptPdf,
  printReceiptPdf,
  type ReceiptInvoice,
} from "@/lib/receipt-pdf";
import {
  CheckCircle2,
  Download,
  LoaderCircle,
  Printer,
  QrCode,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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

type PaymentQr = {
  qrId: string;
  imageUrl: string;
  amount: number;
  expiresAt: number;
};

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
  const [qr, setQr] = useState<PaymentQr | null>(null);
  const [status, setStatus] = useState<"ready" | "creating" | "pending" | "checking" | "paid" | "expired">("ready");
  const [paymentId, setPaymentId] = useState("");
  const [error, setError] = useState("");
  const [documentAction, setDocumentAction] = useState("");

  const paidInvoice = useMemo<ReceptionInvoice>(() => ({
    ...invoice,
    amountPaid: invoice.total,
    balance: 0,
    paymentStatus: "paid",
    paymentMethod: "online",
    paymentReference: paymentId,
  }), [invoice, paymentId]);

  const createQr = useCallback(async () => {
    setStatus("creating");
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/razorpay/create-qr", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      const result = await response.json() as PaymentQr & { error?: string };
      if (!response.ok || !result.qrId || !result.imageUrl) {
        throw new Error(result.error || "The payment QR could not be generated.");
      }
      setQr(result);
      setStatus("pending");
    } catch (reason) {
      setStatus("ready");
      setError(
        reason instanceof Error
          ? reason.message
          : "The payment QR could not be generated.",
      );
    }
  }, [invoice.id, user]);

  const checkQrStatus = useCallback(async (quiet = false) => {
    if (!qr || status === "paid" || status === "expired") return;
    if (!quiet) setStatus("checking");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/razorpay/qr-status", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ qrId: qr.qrId }),
      });
      const result = await response.json() as {
        error?: string;
        status?: "pending" | "paid" | "expired";
        paymentId?: string;
      };
      if (!response.ok || !result.status) {
        throw new Error(result.error || "Payment confirmation could not be checked.");
      }
      if (result.status === "paid") {
        setPaymentId(result.paymentId || "");
        setStatus("paid");
        setError("");
        return;
      }
      setStatus(result.status);
    } catch (reason) {
      if (!quiet) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Payment confirmation could not be checked.",
        );
      }
      setStatus("pending");
    }
  }, [qr, status, user]);

  useEffect(() => {
    if (!qr || status !== "pending") return;
    const timer = window.setInterval(() => {
      void checkQrStatus(true);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [checkQrStatus, qr, status]);

  async function runDocumentAction(
    key: string,
    action: () => Promise<void>,
  ) {
    setDocumentAction(key);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The document could not be prepared.",
      );
    } finally {
      setDocumentAction("");
    }
  }

  if (status === "paid") {
    return (
      <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
        <div className="flex gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-white">
            <CheckCircle2 size={25} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Server confirmed</p>
            <h3 className="mt-1 text-xl font-bold text-[#233A59]">Payment received — {money(invoice.total)}</h3>
            <p className="mt-1 text-sm text-emerald-800">
              The fee is recorded against {invoice.invoiceNumber}. The receipt and prescription are ready to print.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            disabled={Boolean(documentAction)}
            onClick={() => void runDocumentAction(
              "prescription-print",
              () => printBlankPrescriptionPdf(patient, patient.doctorName),
            )}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {documentAction === "prescription-print" ? <LoaderCircle className="animate-spin" size={18} /> : <Printer size={18} />}
            Print prescription
          </button>
          <button
            type="button"
            disabled={Boolean(documentAction)}
            onClick={() => void runDocumentAction(
              "receipt-print",
              () => printReceiptPdf(paidInvoice),
            )}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {documentAction === "receipt-print" ? <LoaderCircle className="animate-spin" size={18} /> : <ReceiptText size={18} />}
            Print receipt
          </button>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-1">
            <button
              type="button"
              disabled={Boolean(documentAction)}
              onClick={() => void runDocumentAction(
                "prescription-download",
                () => downloadBlankPrescriptionPdf(patient, patient.doctorName),
              )}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-[#233A59] disabled:opacity-60"
            >
              <Download size={16} /> Rx PDF
            </button>
            <button
              type="button"
              disabled={Boolean(documentAction)}
              onClick={() => void runDocumentAction(
                "receipt-download",
                () => downloadReceiptPdf(paidInvoice),
              )}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-[#233A59] disabled:opacity-60"
            >
              <Download size={16} /> Receipt
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      </section>
    );
  }

  return (
    <section className="mt-5 rounded-3xl border border-blue-200 bg-blue-50 p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-[#233A59] p-2.5 text-white"><QrCode size={21} /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Reception POS</p>
              <h3 className="text-xl font-bold text-[#233A59]">{consultationLabel}</h3>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 rounded-2xl bg-white p-4 text-sm ring-1 ring-blue-100">
            <span className="text-slate-500">Patient</span><strong className="text-right text-[#233A59]">{patient.fullName}</strong>
            <span className="text-slate-500">Invoice</span><strong className="text-right text-[#233A59]">{invoice.invoiceNumber}</strong>
            <span className="text-slate-500">Amount due</span><strong className="text-right text-lg text-emerald-700">{money(invoice.total)}</strong>
          </div>
        </div>

        {!qr ? (
          <button
            type="button"
            disabled={status === "creating"}
            onClick={() => void createQr()}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {status === "creating" ? <LoaderCircle className="animate-spin" size={19} /> : <QrCode size={19} />}
            {status === "creating" ? "Generating secure QR…" : `Generate ${money(invoice.total)} QR`}
          </button>
        ) : (
          <div className="w-full max-w-xs rounded-3xl bg-white p-4 text-center shadow-sm ring-1 ring-blue-200">
            {/* Razorpay returns a short image URL for the merchant's dynamic UPI QR. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.imageUrl} alt={`UPI payment QR for ${invoice.invoiceNumber}`} className="mx-auto aspect-square w-full max-w-56 rounded-2xl object-contain" />
            <p className="mt-3 font-bold text-[#233A59]">Scan and pay {money(qr.amount)}</p>
            <p className="mt-1 text-xs text-slate-500">
              Expires at {new Date(qr.expiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800">
              {status === "checking" ? <LoaderCircle className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
              {status === "expired" ? "QR expired" : "Waiting for server confirmation"}
            </div>
            <button
              type="button"
              disabled={status === "checking"}
              onClick={() => void checkQrStatus()}
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-[#233A59] disabled:opacity-60"
            >
              <RefreshCw size={15} className={status === "checking" ? "animate-spin" : ""} />
              Check payment now
            </button>
            {status === "expired" && (
              <button
                type="button"
                onClick={() => { setQr(null); setStatus("ready"); setError(""); }}
                className="mt-2 text-xs font-bold text-blue-700 underline"
              >
                Generate a new QR
              </button>
            )}
          </div>
        )}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-600">
        Receipt and prescription printing remain locked until Razorpay confirms the captured payment to the clinic server.
      </p>
      {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
    </section>
  );
}
