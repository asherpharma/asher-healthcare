"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  LoaderCircle,
  Search,
  ShieldCheck,
  ShieldOff,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type PatientSearchResult = {
  id: string;
  patientNumber: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
};

type GrantDraft = PatientSearchResult & {
  relationship: "self" | "parent" | "guardian" | "adult_proxy";
  consentRecordId: string;
  consentMethod: "signed_form" | "in_person" | "verified_guardianship";
  evidenceType: "patient_authorization" | "parent_attestation" | "guardianship_document";
  consentAttested: boolean;
  scopes: string[];
};

type PortalGrant = {
  grantId: string;
  patientId: string;
  patientName: string;
  relationship: string;
  status: string;
};

type PortalAccount = {
  uid: string;
  displayName: string;
  email: string;
  status: string;
  invitedAt: string;
  claimedAt: string;
  grants: PortalGrant[];
};

const inputClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10";

function patientSearchReady(value: string) {
  const cleaned = value.trim().slice(0, 100);
  if (!cleaned) return false;

  const patientNumber = cleaned
    .toLocaleUpperCase("en-IN")
    .replace(/[^A-Z0-9-]+/gu, "");
  const knownClinicNumber = /^(?:ASH|AHC)-[A-Z0-9-]{1,24}$/u.test(patientNumber);
  const otherNumberWithDigit = /^[A-Z]{2,8}-(?=[A-Z0-9-]*\d)[A-Z0-9-]{1,24}$/u.test(patientNumber);
  if (knownClinicNumber || otherNumberWithDigit) return true;

  const digits = cleaned.replace(/\D/gu, "");
  let national = digits;
  if (national.startsWith("0091")) national = national.slice(4);
  else if (national.length > 10 && national.startsWith("91")) national = national.slice(2);
  if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  if (/^[6-9]\d{5,9}$/u.test(national)) return true;

  const normalizedName = cleaned
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  return normalizedName.length >= 3;
}

export default function PatientPortalAccessManager() {
  const { user } = useStaff();
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const [grants, setGrants] = useState<GrantDraft[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const portalRequest = useCallback(async (body: object) => {
    const idToken = await user.getIdToken();
    const response = await fetch("/api/admin/patient-access", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Patient portal access could not be updated.");
    return result;
  }, [user]);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await portalRequest({ action: "list" });
      setAccounts(Array.isArray(result.accounts) ? result.accounts : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Patient portal access could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [portalRequest]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccounts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAccounts]);

  async function searchPatients(event: FormEvent) {
    event.preventDefault();
    if (!patientSearchReady(search)) return;
    setSearching(true);
    setSearchAttempted(false);
    setSearchError("");
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/staff/patients/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ search: search.trim(), pageSize: 8 }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Patient search could not be completed.");
      setResults(Array.isArray(result.patients) ? result.patients : []);
      setSearchAttempted(true);
    } catch (requestError) {
      setSearchError(requestError instanceof Error ? requestError.message : "Patient search could not be completed.");
    } finally {
      setSearching(false);
    }
  }

  function addPatient(patient: PatientSearchResult) {
    if (grants.some((grant) => grant.id === patient.id) || grants.length >= 5) return;
    setGrants((current) => [...current, {
      ...patient,
      relationship: "parent",
      consentRecordId: "",
      consentMethod: "signed_form",
      evidenceType: "parent_attestation",
      consentAttested: false,
      scopes: ["profile", "appointments"],
    }]);
    setResults([]);
    setSearchAttempted(false);
    setSearchError("");
    setSearch("");
  }

  function updateGrant(patientId: string, updates: Partial<GrantDraft>) {
    setGrants((current) => current.map((grant) => grant.id === patientId ? { ...grant, ...updates } : grant));
  }

  function updateRelationship(patientId: string, relationship: GrantDraft["relationship"]) {
    updateGrant(patientId, {
      relationship,
      consentMethod: relationship === "guardian" ? "verified_guardianship" : "signed_form",
      evidenceType: relationship === "parent"
        ? "parent_attestation"
        : relationship === "guardian"
          ? "guardianship_document"
          : "patient_authorization",
      consentAttested: false,
    });
  }

  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (grants.length < 1) {
      setError("Search for and link at least one exact patient record.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await portalRequest({
        action: "provision",
        displayName: String(form.get("displayName") || ""),
        email: String(form.get("email") || ""),
        confirmEmail: String(form.get("confirmEmail") || ""),
        accountEmailAttested: form.get("accountEmailAttested") === "on",
        grants: grants.map((grant) => ({
          patientId: grant.id,
          relationship: grant.relationship,
          consentRecordId: grant.consentRecordId,
          consentMethod: grant.consentMethod,
          evidenceType: grant.evidenceType,
          consentAttested: grant.consentAttested,
          scopes: grant.scopes,
        })),
      });
      const instruction = "A secure password setup email has been sent. Access stays pending until the account holder signs in and accepts it.";
      setMessage(`Family portal invitation prepared for ${result.displayName}. ${instruction}`);
      setGrants([]);
      formElement.reset();
      await loadAccounts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Patient portal access could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(accountUid: string, grantId = "") {
    if (!window.confirm(grantId ? "Revoke access to this patient record?" : "Revoke this entire family portal account?")) return;
    setSaving(true);
    setError("");
    try {
      await portalRequest({ action: "revoke", accountUid, grantId, reason: "Revoked by clinic administrator" });
      setMessage(grantId ? "Patient access revoked." : "Family portal account revoked.");
      await loadAccounts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Patient portal access could not be revoked.");
    } finally {
      setSaving(false);
    }
  }

  async function resend(accountUid: string) {
    if (!window.confirm("I verified the account holder's identity. Send a secure password setup/reset link now?")) return;
    const method = window.prompt("Verification method: in_person, registered_phone, or photo_id", "registered_phone")?.trim() || "";
    const reference = window.prompt("Enter the clinic filing/reference code (letters, numbers, dot, slash, dash only)", "VERIFY-1")?.trim() || "";
    if (!method || !reference) return;
    setSaving(true);
    setError("");
    try {
      await portalRequest({ action: "resend", accountUid, identityAttested: true, identityVerificationMethod: method, identityVerificationReference: reference });
      setMessage("A fresh password setup link was sent. Another resend is available after 10 minutes.");
      await loadAccounts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The invitation could not be resent.");
    } finally {
      setSaving(false);
    }
  }

  async function copyPortalLink() {
    await navigator.clipboard.writeText("https://asherhealthcare.in/portal/login");
    setMessage("Patient portal sign-in link copied.");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] bg-[#233A59] p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-[#E7C989]"><ShieldCheck size={17} />Administrator-only family access</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Patient & family portal access</h1>
            <p className="mt-3 leading-7 text-white/75">Verify the exact chart, relationship and consent reference. The portal never links a chart from a matching name, mobile number or email.</p>
          </div>
          <button type="button" onClick={() => void copyPortalLink()} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-[#233A59]"><Copy size={17} />Copy portal link</button>
        </div>
      </section>

      {message ? <p role="status" className="flex items-start gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18} />{message}</p> : null}
      {error ? <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p> : null}

      <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-blue-700"><UserRoundPlus size={22} /></span><div><h2 className="text-xl font-bold text-[#233A59]">Invite a family account</h2><p className="text-sm text-slate-600">Access remains pending until the intended email owner signs in and accepts it.</p></div></div>
        <div className="mt-6 rounded-2xl bg-slate-50 p-4 sm:p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#A8864A]">Step 1 · Attach a patient chart</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">Search by the patient&apos;s registered name, 10-digit mobile number or patient ID, then tap the matching result.</p>
        <form onSubmit={searchPatients} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="relative w-full min-w-0 flex-1"><span className="sr-only">Search patient</span><Search className="pointer-events-none absolute left-3 top-3.5 text-slate-400" size={18} /><input value={search} onChange={(event) => { setSearch(event.target.value); setSearchAttempted(false); setSearchError(""); setResults([]); }} placeholder="Patient name, mobile or ID" className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm font-semibold outline-none focus:border-[#233A59]" /></label>
          <button disabled={searching || !patientSearchReady(search)} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{searching ? <LoaderCircle className="animate-spin" size={17} /> : <Search size={17} />}Find</button>
        </form>
        {search && !patientSearchReady(search) ? <p className="mt-2 text-xs font-semibold text-slate-500">Enter at least 3 name letters, 6 mobile digits, or a complete patient ID.</p> : null}
        {searchError ? <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{searchError}</p> : null}
        {results.length > 0 ? <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200">{results.map((patient) => <button type="button" key={patient.id} onClick={() => addPatient(patient)} className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-slate-50"><span><strong className="block text-[#233A59]">{patient.fullName}</strong><span className="mt-1 block text-xs text-slate-500">{patient.patientNumber} · {patient.phone} · DOB {patient.dateOfBirth}</span></span><span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-[#A8864A]"><Link2 size={18} />Attach</span></button>)}</div> : null}
        {searchAttempted && !searching && results.length === 0 ? <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong className="block">No matching patient record found.</strong><span>Try the exact registered mobile number or patient ID. If this is a new patient, </span><Link href="/admin/reception" className="font-bold underline underline-offset-2">register the patient first</Link><span>, then return here.</span></div> : null}
        </div>

        <form onSubmit={provision} className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:col-span-2">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-800">Step 2 · Account holder and consent</p>
            <p className="mt-1 text-sm leading-6 text-blue-950">Use a separate patient or family email address. An email already used for an Asher Staff login cannot be reused for the patient portal.</p>
          </div>
          <label className="text-sm font-bold text-slate-700">Account holder name<input name="displayName" required minLength={2} maxLength={100} className={inputClass} /></label>
          <label className="text-sm font-bold text-slate-700">Account email<input name="email" type="email" required maxLength={254} className={inputClass} /></label>
          <label className="text-sm font-bold text-slate-700 sm:col-start-2">Re-enter account email<input name="confirmEmail" type="email" required maxLength={254} autoComplete="off" className={inputClass} /></label>
          <label className="flex items-start gap-3 rounded-2xl bg-blue-50 p-4 text-xs font-semibold leading-5 text-blue-950 sm:col-span-2"><input name="accountEmailAttested" type="checkbox" required className="mt-1" />I verified that this email belongs to the named, authorized account holder. I understand each selected permission covers current and future matching records until its review date, expiry or clinic revocation.</label>
          <div className="space-y-3 sm:col-span-2">
            {grants.map((grant) => <article key={grant.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[#233A59]">{grant.fullName}</p><p className="mt-1 text-xs text-slate-500">{grant.patientNumber} · {grant.phone} · DOB {grant.dateOfBirth}</p></div><button type="button" aria-label={`Remove ${grant.fullName}`} onClick={() => setGrants((current) => current.filter((entry) => entry.id !== grant.id))} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600"><X size={16} /></button></div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-600">Relationship<select value={grant.relationship} onChange={(event) => updateRelationship(grant.id, event.target.value as GrantDraft["relationship"])} className={inputClass}><option value="self">Patient themself</option><option value="parent">Parent of minor</option><option value="guardian">Legal guardian of minor</option><option value="adult_proxy">Adult proxy with explicit consent</option></select></label>
                <label className="text-xs font-bold text-slate-600">Consent / guardianship filing code<input value={grant.consentRecordId} onChange={(event) => updateGrant(grant.id, { consentRecordId: event.target.value })} required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._/-]{2,79}" placeholder="CONSENT-2026-001 (no names or ID numbers)" className={inputClass} /></label>
                <label className="text-xs font-bold text-slate-600">Verification method<select value={grant.consentMethod} onChange={(event) => updateGrant(grant.id, { consentMethod: event.target.value as GrantDraft["consentMethod"], consentAttested: false })} className={inputClass}>{grant.relationship === "guardian" ? <option value="verified_guardianship">Verified guardianship document</option> : <><option value="signed_form">Signed clinic form</option><option value="in_person">In-person patient verification</option></>}</select></label>
                <label className="text-xs font-bold text-slate-600">Evidence type<input readOnly value={grant.evidenceType === "patient_authorization" ? "Patient authorization" : grant.evidenceType === "parent_attestation" ? "Parent attestation for minor" : "Guardianship document"} className={inputClass + " bg-slate-50"} /></label>
              </div>
              <fieldset className="mt-4"><legend className="text-xs font-bold uppercase tracking-wide text-slate-500">Portal permissions</legend><div className="mt-2 flex flex-wrap gap-2">{[["profile", "Basic patient identity (required)"], ["appointments", "Appointments"], ["prescriptions", "Prescriptions"], ["reports", "Reports"], ["billing", "Receipts"]].map(([scope, label]) => <label key={scope} className={(grant.scopes.includes(scope) ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-600") + " inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold"}><input type="checkbox" disabled={scope === "profile"} checked={grant.scopes.includes(scope)} onChange={(event) => updateGrant(grant.id, { scopes: event.target.checked ? [...grant.scopes, scope] : grant.scopes.filter((item) => item !== scope) })} />{label}</label>)}</div></fieldset>
              <label className="mt-4 flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-950"><input type="checkbox" required checked={grant.consentAttested} onChange={(event) => updateGrant(grant.id, { consentAttested: event.target.checked })} className="mt-1" />I verified this exact patient, relationship, permission scope and evidence. The reference above identifies the clinic-held consent or guardianship record.</label>
            </article>)}
            {grants.length === 0 ? <div id="portal-invitation-requirement" className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-5 text-center text-sm font-semibold leading-6 text-amber-950"><strong className="block">Invitation locked: no patient chart attached.</strong>Complete Step 1 above and tap the correct patient result. The invitation button will then unlock.</div> : null}
          </div>
          <div className="sm:col-span-2"><button aria-describedby={grants.length < 1 ? "portal-invitation-requirement" : undefined} disabled={saving || grants.length < 1} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#A8864A] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{saving ? <LoaderCircle className="animate-spin" size={17} /> : <KeyRound size={17} />}{saving ? "Preparing secure access…" : grants.length < 1 ? "Attach a patient first" : "Create pending invitation"}</button></div>
        </form>
      </section>

      <section className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
        <div className="flex items-center gap-3"><UsersRound className="text-[#A8864A]" /><div><h2 className="text-xl font-bold text-[#233A59]">Existing family access</h2><p className="text-sm text-slate-600">Review or revoke an entire account or one linked patient.</p></div></div>
        {loading ? <p className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-600"><LoaderCircle className="animate-spin" size={18} />Loading secure access…</p> : null}
        <div className="mt-5 space-y-4">{accounts.map((account) => <article key={account.uid} className="rounded-2xl border border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-[#233A59]">{account.displayName}</p><p className="mt-1 text-sm text-slate-600">{account.email}</p><span className={(account.status === "active" ? "bg-emerald-50 text-emerald-700" : account.status === "pending" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700") + " mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold capitalize"}>{account.status}</span></div><div className="flex flex-wrap gap-2">{account.status !== "revoked" ? <button type="button" disabled={saving} onClick={() => void resend(account.uid)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-blue-200 px-3 text-xs font-bold text-blue-800"><KeyRound size={16} />{account.status === "pending" ? "Resend setup" : "Reset password"}</button> : null}{account.status !== "revoked" ? <button type="button" disabled={saving} onClick={() => void revoke(account.uid)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 px-3 text-xs font-bold text-red-700"><ShieldOff size={16} />Revoke account</button> : null}</div></div>
          <div className="mt-4 space-y-2">{account.grants.map((grant) => <div key={grant.grantId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><div><p className="text-sm font-bold text-[#233A59]">{grant.patientName}</p><p className="mt-1 text-xs capitalize text-slate-500">{grant.relationship.replaceAll("_", " ")} · {grant.status}</p></div>{grant.status !== "revoked" ? <button type="button" disabled={saving} onClick={() => void revoke(account.uid, grant.grantId)} className="rounded-lg px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50">Revoke patient</button> : null}</div>)}</div>
        </article>)}</div>
        {!loading && accounts.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-8 text-center"><ShieldCheck className="mx-auto text-[#A8864A]" size={30} /><p className="mt-3 font-bold text-[#233A59]">No family accounts created yet</p></div> : null}
      </section>
    </div>
  );
}
