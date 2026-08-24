"use client";

import { useStaff } from "@/components/admin/StaffGuard";
import { firebaseAuth } from "@/firebase/config";
import { maskIndianStaffPhone, normalizeIndianStaffPhone } from "@/lib/staff-auth";
import {
  linkWithCredential,
  PhoneAuthProvider,
  RecaptchaVerifier,
  reload,
} from "firebase/auth";
import { CheckCircle2, KeyRound, LoaderCircle, MessageSquareText, ShieldCheck, Smartphone } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

function setupErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "auth/operation-not-allowed") return "Mobile OTP is not enabled yet for this clinic. Email sign-in remains available.";
  if (code === "auth/credential-already-in-use") return "This number is already linked to another staff account. Ask the administrator to check access before trying again.";
  if (code === "auth/too-many-requests" || code === "auth/quota-exceeded") return "Too many codes were requested. Please wait before trying again.";
  if (code === "auth/invalid-verification-code" || code === "auth/code-expired") return "That code is incorrect or expired. Request a fresh code and try again.";
  if (code === "auth/requires-recent-login") return "For security, lock the app and sign in again before linking this number.";
  return "The mobile number could not be verified. Please check it and try again.";
}

export default function StaffPhoneOtpSetup() {
  const { user } = useStaff();
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const [linkedPhone, setLinkedPhone] = useState(user.phoneNumber || "");
  const [phone, setPhone] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => verifierRef.current?.clear(), []);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseAuth) return;
    const normalizedPhone = normalizeIndianStaffPhone(phone);
    if (!normalizedPhone) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    verifierRef.current?.clear();
    try {
      verifierRef.current = new RecaptchaVerifier(firebaseAuth, "staff-phone-link-recaptcha", { size: "invisible" });
      const provider = new PhoneAuthProvider(firebaseAuth);
      const nextVerificationId = await provider.verifyPhoneNumber(normalizedPhone, verifierRef.current);
      setPhone(normalizedPhone);
      setVerificationId(nextVerificationId);
      setNotice(`A 6-digit verification code was sent to ${maskIndianStaffPhone(normalizedPhone)}.`);
    } catch (caught) {
      verifierRef.current?.clear();
      verifierRef.current = null;
      setError(setupErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/u.test(code)) {
      setError("Enter the 6-digit code sent to your mobile.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const credential = PhoneAuthProvider.credential(verificationId, code);
      await linkWithCredential(user, credential);
      await reload(user);
      setLinkedPhone(user.phoneNumber || phone);
      setVerificationId("");
      setCode("");
      setNotice("Mobile OTP is now active for this staff account. You can use it the next time you sign in.");
    } catch (caught) {
      setError(setupErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-7" aria-labelledby="mobile-otp-setup-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-[#233A59]"><KeyRound size={23} /></span>
          <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#A8864A]">Fast secure access</p><h2 id="mobile-otp-setup-title" className="mt-1 text-2xl font-bold text-[#233A59]">Mobile OTP sign-in</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Verify your own number once. It stays attached to this approved staff account and can then replace typing a password.</p></div>
        </div>
        {linkedPhone ? <span className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-full bg-emerald-50 px-4 text-xs font-bold text-emerald-800"><CheckCircle2 size={16} />Active</span> : null}
      </div>

      {linkedPhone ? (
        <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
          <div className="flex items-center gap-3"><ShieldCheck className="text-emerald-700" size={23} /><div><p className="font-bold text-emerald-900">OTP is ready</p><p className="mt-1 text-sm text-emerald-800">Linked number: {maskIndianStaffPhone(linkedPhone)}</p></div></div>
          <p className="mt-4 text-xs leading-5 text-emerald-800">For account safety, changing or removing this number requires administrator-assisted verification.</p>
        </div>
      ) : verificationId ? (
        <form onSubmit={confirmCode} className="mt-6 rounded-2xl bg-slate-50 p-5">
          <label className="block text-sm font-bold text-slate-700">6-digit verification code<input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} required className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-xl font-bold tracking-[0.35em] outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/15" /></label>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#233A59] px-5 text-sm font-bold text-white disabled:opacity-60">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <ShieldCheck size={18} />}{loading ? "Verifying…" : "Verify and enable OTP"}</button>
            <button type="button" onClick={() => { setVerificationId(""); setCode(""); setNotice(""); setError(""); }} className="min-h-12 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700">Use a different number</button>
          </div>
        </form>
      ) : (
        <form onSubmit={sendCode} className="mt-6 rounded-2xl bg-slate-50 p-5">
          <label className="block text-sm font-bold text-slate-700">Your Indian mobile number<div className="mt-2 flex rounded-xl border border-slate-200 bg-white focus-within:border-[#233A59] focus-within:ring-2 focus-within:ring-[#233A59]/15"><span className="flex items-center border-r border-slate-200 px-3 text-sm font-bold text-slate-600">+91</span><input type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="98765 43210" required className="min-w-0 flex-1 rounded-r-xl px-4 py-3 outline-none" /></div></label>
          <button disabled={loading} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#233A59] px-5 text-sm font-bold text-white sm:w-auto disabled:opacity-60">{loading ? <LoaderCircle className="animate-spin" size={18} /> : <MessageSquareText size={18} />}{loading ? "Sending…" : "Send verification code"}</button>
          <p className="mt-4 text-xs leading-5 text-slate-500"><Smartphone className="mr-1 inline" size={14} />Google Firebase uses this number for sign-in and abuse prevention. The administrator cannot see your OTP.</p>
        </form>
      )}

      <div id="staff-phone-link-recaptcha" />
      {notice ? <p role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-blue-900"><CheckCircle2 className="mt-0.5 shrink-0" size={18} />{notice}</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold leading-6 text-red-700">{error}</p> : null}
    </section>
  );
}
