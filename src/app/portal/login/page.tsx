"use client";
// Firebase's deployed password policy currently permits six-character legacy passwords.

import PatientPortalPwa from "@/components/portal/PatientPortalPwa";
import { isFirebaseConfigured, patientFirebaseAuth } from "@/firebase/config";
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, type User } from "firebase/auth";
import { ArrowLeft, Eye, EyeOff, HeartHandshake, KeyRound, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

export default function PatientPortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetNotice, setResetNotice] = useState("");
  const claimingUid = useRef("");

  const activatePortal = useCallback(async (user: User) => {
    const idToken = await user.getIdToken(true);
    const response = await fetch("/api/patient/portal", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ action: "claim" }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("No active patient or family access is linked to this email. Ask the clinic administrator to create an invitation first. Clinic staff should use Staff Login.");
      }
      throw new Error(result.error || "This portal invitation is not active.");
    }
  }, []);

  useEffect(() => {
    const auth = patientFirebaseAuth;
    if (!auth) return;
    return onAuthStateChanged(auth, (user) => {
      if (!user || claimingUid.current === user.uid) return;
      claimingUid.current = user.uid;
      setLoading(true);
      void activatePortal(user)
        .then(() => router.replace("/portal"))
        .catch(async (error) => {
          await auth.signOut().catch(() => {});
          claimingUid.current = "";
          setMessage(error instanceof Error ? error.message : "This portal invitation is not active.");
          setLoading(false);
        });
    });
  }, [activatePortal, router]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth = patientFirebaseAuth;
    if (!auth || loading) return;
    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      window.sessionStorage.setItem("asher.portal.lastActivityAt", String(Date.now()));
      await signInWithEmailAndPassword(auth, String(form.get("email")).trim().toLowerCase(), String(form.get("password")));
      // The single auth-state observer owns the invitation claim to prevent concurrent claims.
    } catch {
      await auth.signOut().catch(() => {});
      window.sessionStorage.removeItem("asher.portal.lastActivityAt");
      claimingUid.current = "";
      setMessage("The email or password is incorrect, or family access has not been approved by the clinic.");
      setLoading(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth = patientFirebaseAuth;
    const approvedEmail = email.trim().toLowerCase();
    if (!auth || !approvedEmail) return;
    setResetting(true);
    setResetNotice("");
    try {
      await sendPasswordResetEmail(auth, approvedEmail, {
        url: "https://asherhealthcare.in/portal/login?passwordReset=1",
        handleCodeInApp: false,
      });
    } catch {
      // Always return the same response so this screen cannot reveal portal accounts.
    } finally {
      setResetNotice("If an approved family portal account matches this email, a secure password-reset link has been sent.");
      setResetting(false);
    }
  }

  return (
    <main id="main-content" className="auth-page">
      <div className="auth-shell">
        <Link href="/" className="auth-back"><ArrowLeft aria-hidden="true" size={16} />Clinic website</Link>
        <section className="auth-card">
          <div className="auth-brand"><Image src="/images/asher-logo-compact-v2.webp" alt="Asher Healthcare" width={48} height={48} /><div><p>ASHER HEALTHCARE</p><strong>Asher Family</strong></div><HeartHandshake aria-hidden="true" size={20} /></div>
          <h1 className="auth-title">{resetOpen ? "Reset your password" : "Your care, in one place."}</h1>
          <p className="auth-description">{resetOpen ? "Enter your approved email to receive a secure password-reset link." : "Sign in with the email approved by the clinic to see your family's appointments and records."}</p>
          <div>
            {!isFirebaseConfigured ? <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">The secure patient connection is not configured in this deployment.</p> : !resetOpen && (
              <form onSubmit={signIn} className="auth-form" aria-busy={loading}>
                <label className="auth-label">Approved email address
                  <input name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={(event) => { setEmail(event.target.value); setMessage(""); }} className="auth-input" />
                </label>
                <label className="auth-label">Password
                  <span className="relative block">
                    <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={6} className="auth-input pr-14" />
                    <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="auth-password-toggle">
                      {showPassword ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}
                    </button>
                  </span>
                </label>
                {message ? <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900"><p className="break-words">{message}</p><Link href="/admin/login" className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-white px-3 text-[#233A59] shadow-sm ring-1 ring-amber-200">Open Staff Login</Link></div> : null}
                <button disabled={loading} className="auth-primary">{loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> : <LockKeyhole aria-hidden="true" size={18} />}{loading ? "Verifying access…" : "Sign in securely"}</button>
              </form>
            )}
            {isFirebaseConfigured ? (
              <div className="mt-5 border-t border-slate-200 pt-5">
                {!resetOpen ? (
                  <button type="button" onClick={() => { setResetOpen(true); setResetNotice(""); }} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#233A59] hover:text-[#A8864A]">
                    <KeyRound aria-hidden="true" size={17} />Forgot your password?
                  </button>
                ) : (
                  <form onSubmit={requestPasswordReset} className="rounded-2xl bg-slate-50 p-4" aria-busy={resetting}>
                    <div className="flex items-start gap-3">
                      <Mail aria-hidden="true" className="mt-0.5 shrink-0 text-[#A8864A]" size={20} />
                      <div><h2 className="font-bold text-[#233A59]">Email a reset link</h2><p className="mt-1 text-sm leading-6 text-slate-600">You can choose a new password from the secure email.</p></div>
                    </div>
                    <label className="mt-4 block text-sm font-bold text-slate-700">Approved email address
                      <input type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => { setEmail(event.target.value); setResetNotice(""); }} required className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10" />
                    </label>
                    {resetNotice ? <p role="status" aria-live="polite" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800">{resetNotice}</p> : null}
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button type="submit" disabled={resetting} className="auth-primary">{resetting ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Mail aria-hidden="true" size={17} />}{resetting ? "Sending…" : "Send reset link"}</button>
                      <button type="button" onClick={() => { setResetOpen(false); setResetNotice(""); }} className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">Back to sign in</button>
                    </div>
                  </form>
                )}
              </div>
            ) : null}
            <details className="auth-help"><summary><HeartHandshake aria-hidden="true" size={18} />New here or need help?<span aria-hidden="true">+</span></summary><div><p>Portal access is created only after clinic verification. A matching name, phone number or email never links a medical record automatically.</p><p>Call reception at <a href="tel:+919019263709">+91 90192 63709</a> for an invitation or help. Clinic staff should use <Link href="/admin/login">Staff Login</Link>.</p><PatientPortalPwa compact /></div></details>
            <p className="auth-security"><ShieldCheck aria-hidden="true" size={17} />This session remains only until this browser is closed. Use a private device and sign out when finished.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
