"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { CheckCircle2, DatabaseZap, LoaderCircle } from "lucide-react";
import { useState } from "react";

type BackfillResponse = {
  scannedCount?: number;
  indexedCount?: number;
  nextPageToken?: string;
  complete?: boolean;
  error?: string;
};

const MAX_BATCHES = 200;

export default function PatientSearchUpgradePanel() {
  const { user } = useStaff();
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState(0);
  const [scanned, setScanned] = useState(0);
  const [indexed, setIndexed] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function optimizePatientSearch() {
    setRunning(true);
    setBatch(0);
    setScanned(0);
    setIndexed(0);
    setNotice("");
    setError("");

    try {
      let pageToken = "";
      let scannedTotal = 0;
      let indexedTotal = 0;

      for (let currentBatch = 1; currentBatch <= MAX_BATCHES; currentBatch += 1) {
        setBatch(currentBatch);
        const idToken = await user.getIdToken();
        const response = await fetch("/api/admin/patients/search-backfill", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ pageToken }),
        });
        const result = await response.json() as BackfillResponse;
        if (!response.ok) throw new Error(result.error || "Patient search could not be optimized.");

        scannedTotal += Number(result.scannedCount || 0);
        indexedTotal += Number(result.indexedCount || 0);
        setScanned(scannedTotal);
        setIndexed(indexedTotal);

        if (result.complete === true) {
          setNotice(`Patient search is ready. ${scannedTotal} records checked and ${indexedTotal} updated.`);
          return;
        }
        pageToken = String(result.nextPageToken || "");
        if (!pageToken) throw new Error("The patient search upgrade stopped before completion. Run it again.");
      }
      throw new Error("The clinic has more records than this upgrade can process in one run. Contact support before continuing.");
    } catch (upgradeError) {
      setError(upgradeError instanceof Error ? upgradeError.message : "Patient search could not be optimized.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-blue-700"><DatabaseZap size={18} />Patient search upgrade</p>
          <h2 className="mt-2 text-2xl font-bold text-[#233A59]">Make reception lookup fast and complete</h2>
          <p className="mt-2 leading-7 text-slate-600">Run this once after the upgrade is deployed. It prepares older patient charts for fast name, mobile number, patient ID, and doctor-wise search without exposing medical history.</p>
        </div>
        <button
          type="button"
          onClick={() => void optimizePatientSearch()}
          disabled={running}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? <LoaderCircle size={18} className="animate-spin" /> : <DatabaseZap size={18} />}
          {running ? `Checking batch ${batch}…` : notice ? "Check again" : "Optimize patient search"}
        </button>
      </div>

      {running ? <p className="mt-4 text-sm font-semibold text-blue-800">{scanned} records checked · {indexed} updated</p> : null}
      {notice ? <p role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{notice}</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}
