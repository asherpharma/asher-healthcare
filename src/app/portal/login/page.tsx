"use client";
// Firebase's deployed password policy currently permits six-character legacy passwords.

import PatientPortalPwa from "@/components/portal/PatientPortalPwa";
import { isFirebaseConfigured, patientFirebaseAuth } from "@/firebase/config";
import { onAuthStateChanged, signInWithEmailAndPassword, type User } from "firebase/auth";
import { ArrowLeft, Eye, EyeOff, HeartHandshake, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
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
    if (!auth) return;
    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      window.sessionStorage.setItem("asher.portal.lastActivityAt", String(Date.now()));
      await signInWithEmailAndPassword(auth, String(form.get("email")), String(form.get("password")));
      // The single auth-state observer owns the invitation claim to prevent concurrent claims.
    } catch {
      await auth.signOut().catch(() => {});
      window.sessionStorage.removeItem("asher.portal.lastActivityAt");
      claimingUid.current = "";
      setMessage("The email or password is incorrect, or family access has not been approved by the clinic.");
      setLoading(false);
    }
  }

  return (
    <main id="main-content" className="min-h-dvh bg-[radial-gradient(circle_at_top_right,#eaf4f6_0,transparent_38%),linear-gradient(180deg,#f8fafc,#eef3f7)] px-4 py-6 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-lg">
        <div className="flex items-center justify-between gap-2"><Link href="/" className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl text-sm font-bold text-[#233A59] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#233A59]"><ArrowLeft aria-hidden="true" size={17} /><span className="truncate">Clinic website</span></Link><PatientPortalPwa compact /></div>
        <section className="mt-5 overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-2xl shadow-slate-300/50">
          <div className="bg-[#233A59] p-6 text-white sm:p-8"><div className="flex items-center gap-3"><Image src="/images/logo.png" alt="Asher Healthcare" width={54} height={54} className="h-14 w-14 rounded-2xl bg-white object-contain p-1" /><div><p className="text-xs font-bold uppercase tracking-[0.17em] text-[#E7C989]">Secure patient access</p><h1 className="mt-1 text-2xl font-bold">Asher Family</h1></div></div><p className="mt-5 leading-7 text-white/75">Appointments, prescriptions, reports and receipts for family members explicitly approved by the clinic.</p></div>
          <div className="p-6 sm:p-8">
            <div className="flex items-start gap-3 rounded-2xl bg-blue-50 p-4"><HeartHandshake className="mt-0.5 shrink-0 text-blue-700" size={21} /><p className="text-sm leading-6 text-blue-900">Portal access is created only after clinic verification. A matching name, phone number or email never links a medical record automatically.</p></div>
            {!isFirebaseConfigured ? <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">The secure patient connection is not configured in this deployment.</p> : (
              <form onSubmit={signIn} className="mt-6 space-y-4" aria-busy={loading}>
                <label className="block text-sm font-bold text-slate-700">Approved email address
                  <input name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(event) => { setEmail(event.target.value); setMessage(""); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10" />
                </label>
                <label className="block text-sm font-bold text-slate-700">Password
                  <span className="relative mt-2 block">
                    <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={6} className="min-h-12 w-full rounded-xl border border-slate-200 py-3 pl-4 pr-14 text-base outline-none focus:border-[#233A59] focus:ring-2 focus:ring-[#233A59]/10" />
                    <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-slate-500 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#233A59]">
                      {showPassword ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}
                    </button>
                  </span>
                </label>
                <div className="flex justify-end">
                  <a href="tel:+919019263709" className="inline-flex min-h-11 items-center justify-center rounded-xl px-2 text-sm font-bold text-[#233A59] underline-offset-4 hover:underline">Forgot password? Call reception</a>
                </div>
                {message ? <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900"><p className="break-words">{message}</p><Link href="/admin/login" className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-white px-3 text-[#233A59] shadow-sm ring-1 ring-amber-200">Open Staff Login</Link></div> : null}
                <button disabled={loading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#A8864A] px-5 text-sm font-bold text-white disabled:opacity-60">{loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> : <LockKeyhole aria-hidden="true" size={18} />}{loading ? "Verifying access…" : "Sign in securely"}</button>
              </form>
            )}
            {isFirebaseConfigured ? <p className="mt-5 border-t border-slate-200 pt-5 text-sm leading-6 text-slate-600">Need help signing in? Call reception at <a className="font-bold text-[#233A59]" href="tel:+919019263709">+91 90192 63709</a>. A clinic administrator will verify your identity and assist manually.</p> : null}
            <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 shrink-0" size={16} />This session remains only until this browser is closed. Use a private device and sign out when finished.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
