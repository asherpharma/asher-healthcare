"use client";

import { InstallAppButton } from "@/components/pwa/PwaRegister";
import {
  Apple,
  BellRing,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  Mail,
  MonitorSmartphone,
  ScanLine,
  Share2,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";
import Link from "next/link";

const appFeatures = [
  { icon: ScanLine, title: "Fast reception", text: "Register patients, collect fees, and print documents from the phone." },
  { icon: LockKeyhole, title: "Role-protected", text: "Every staff member signs in separately with only the tools allowed for their role." },
  { icon: Wifi, title: "Always current", text: "Appointments, patient records, payments, and reports stay synchronized with the clinic." },
  { icon: BellRing, title: "App-ready alerts", text: "The installed experience is prepared for reminders and staff notifications." },
];

export default function StaffAppPage() {
  return (
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="overflow-hidden rounded-[30px] bg-[#0f2c46] text-white shadow-2xl">
          <div className="relative p-6 sm:p-9">
            <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#A8864A]/20 blur-3xl" />
            <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div>
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#edcf92]">
                  <MonitorSmartphone size={17} /> Android and iPhone
                </p>
                <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Asher Staff app</h1>
                <p className="mt-4 max-w-xl leading-7 text-white/75">
                  Install the secure clinic workspace on any staff phone. It opens full-screen from the home screen and keeps the mobile controls within easy reach.
                </p>
                <div className="mt-6 max-w-sm">
                  <InstallAppButton wide />
                </div>
                <p className="mt-3 text-xs leading-5 text-white/55">No app-store download is required. The same secure release works on Android, iPhone, iPad, tablet, and desktop.</p>
              </div>

              <div className="mx-auto w-full max-w-[290px] rounded-[36px] border-[7px] border-white/15 bg-white p-3 text-slate-900 shadow-2xl">
                <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-slate-200" />
                <div className="rounded-[24px] bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#A8864A]">Asher Staff</p>
                      <p className="mt-1 text-lg font-bold text-[#233A59]">Clinic home</p>
                    </div>
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#233A59] text-white"><Smartphone size={19} /></span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold">
                    {["Register patient", "Appointments", "Consultations", "Collect payment"].map((label) => (
                      <div key={label} className="min-h-20 rounded-2xl bg-white p-3 text-[#233A59] shadow-sm ring-1 ring-slate-200">{label}</div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-around rounded-2xl bg-white p-3 text-[9px] font-bold text-slate-500 shadow-sm">
                    <span>Home</span><span>Bookings</span><span>Patients</span><span>More</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-7" aria-labelledby="staff-sign-in-title">
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-[#233A59]"><KeyRound size={23} /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#A8864A]">Simple secure access</p>
              <h2 id="staff-sign-in-title" className="mt-1 text-2xl font-bold text-[#233A59]">One setup email, then your password</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">The clinic does not use SMS OTP for routine staff sign-in, so every login remains fast and creates no SMS charge.</p>
            </div>
          </div>
          <ol className="mt-6 grid gap-3 md:grid-cols-3">
            <li className="rounded-2xl bg-slate-50 p-4"><Mail className="text-[#A8864A]" size={21} /><strong className="mt-3 block text-sm text-[#233A59]">1. Open your invitation</strong><span className="mt-1 block text-xs leading-5 text-slate-600">Use the private setup link sent to your approved email.</span></li>
            <li className="rounded-2xl bg-slate-50 p-4"><KeyRound className="text-[#A8864A]" size={21} /><strong className="mt-3 block text-sm text-[#233A59]">2. Choose your password</strong><span className="mt-1 block text-xs leading-5 text-slate-600">Create a personal password that the administrator cannot see.</span></li>
            <li className="rounded-2xl bg-slate-50 p-4"><ShieldCheck className="text-[#A8864A]" size={21} /><strong className="mt-3 block text-sm text-[#233A59]">3. Sign in normally</strong><span className="mt-1 block text-xs leading-5 text-slate-600">Use your email and password. A forgotten password is recovered by email.</span></li>
          </ol>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Smartphone size={23} /></span>
              <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-emerald-700">Android</p><h2 className="text-xl font-bold text-[#233A59]">Install with Chrome</h2></div>
            </div>
            <ol className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
              <li className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} /><span>Open the staff portal in Chrome and sign in.</span></li>
              <li className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} /><span>Tap <strong>Install staff app</strong>, or open Chrome’s menu and choose <strong>Install app</strong>.</span></li>
              <li className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} /><span>Open <strong>Asher Staff</strong> from the phone’s home screen.</span></li>
            </ol>
          </article>

          <article className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-800"><Apple size={23} /></span>
              <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">iPhone and iPad</p><h2 className="text-xl font-bold text-[#233A59]">Add with Safari</h2></div>
            </div>
            <ol className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
              <li className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-[#A8864A]" size={18} /><span>Open the staff portal in Safari and sign in.</span></li>
              <li className="flex gap-3"><Share2 className="mt-0.5 shrink-0 text-[#A8864A]" size={18} /><span>Tap Safari’s <strong>Share</strong> button, then choose <strong>Add to Home Screen</strong>.</span></li>
              <li className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-[#A8864A]" size={18} /><span>Tap <strong>Add</strong>, then launch <strong>Asher Staff</strong> from the home screen.</span></li>
            </ol>
          </article>
        </section>

        <section className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <h2 className="text-2xl font-bold text-[#233A59]">Built for clinic work on a phone</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {appFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <article key={feature.title} className="flex gap-3 rounded-2xl bg-slate-50 p-4">
                  <Icon className="mt-0.5 shrink-0 text-[#A8864A]" size={21} />
                  <div><h3 className="font-bold text-[#233A59]">{feature.title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{feature.text}</p></div>
                </article>
              );
            })}
          </div>
          <Link href="/admin" className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#233A59] px-5 text-sm font-bold text-white sm:w-auto">Open app home</Link>
        </section>
      </div>
  );
}
